import type {
  GuideRouteContext,
  GuideRouteContextSpot,
  RoutePreferenceInput,
} from '../types/scenic';
import { buildGuideRouteContextFromRoutePlan } from './guideRouteContext';
import {
  loadGuideRouteContext,
  loadRouteMapSession,
  loadRouteRecommendationSession,
} from './visitorSessionState';
import { defaultVisitorPreference } from './visitorProfile';

const sceneGuideEntrySpotIds = new Set([
  'spot_ls_entrance',
  'spot_nh_entrance',
]);

export interface SceneGuideRouteProjection {
  context: GuideRouteContext;
  sourceIndexes: number[];
  realCurrentIndex: number;
  defaultDisplayIndex: number;
}

export function isSceneGuideEntrySpot(spot: GuideRouteContextSpot) {
  return (
    sceneGuideEntrySpotIds.has(spot.spotId) ||
    spot.name.trim() === '景区入口'
  );
}

export function projectSceneGuideRoute(
  context: GuideRouteContext,
): SceneGuideRouteProjection {
  const visibleStops = context.orderedSpots
    .map((spot, sourceIndex) => ({ spot, sourceIndex }))
    .filter(({ spot }) => !isSceneGuideEntrySpot(spot));
  const sourceIndexes = visibleStops.map(({ sourceIndex }) => sourceIndex);
  const orderedSpots = visibleStops.map(({ spot }, index) => ({
    ...spot,
    sequence: index,
  }));
  const realCurrentIndex = sourceIndexes.indexOf(context.currentIndex);
  let defaultDisplayIndex = realCurrentIndex;

  if (defaultDisplayIndex < 0 && orderedSpots.length > 0) {
    const nextVisibleIndex = sourceIndexes.findIndex(
      (sourceIndex) => sourceIndex > context.currentIndex,
    );
    defaultDisplayIndex =
      nextVisibleIndex >= 0 ? nextVisibleIndex : orderedSpots.length - 1;
  }
  if (defaultDisplayIndex < 0) defaultDisplayIndex = 0;

  return {
    context: {
      ...context,
      currentIndex: defaultDisplayIndex,
      currentSpot: orderedSpots[defaultDisplayIndex],
      nextSpot: orderedSpots[defaultDisplayIndex + 1],
      orderedSpots,
    },
    sourceIndexes,
    realCurrentIndex,
    defaultDisplayIndex,
  };
}

export function guideContextAtIndex(
  context: GuideRouteContext,
  requestedIndex: number,
): GuideRouteContext {
  const index = clampGuideIndex(context.orderedSpots, requestedIndex);
  return {
    ...context,
    currentIndex: index,
    currentSpot: context.orderedSpots[index],
    nextSpot: context.orderedSpots[index + 1],
  };
}

export function clampGuideIndex(
  spots: GuideRouteContextSpot[],
  requestedIndex: number,
) {
  if (spots.length === 0) return 0;
  return Math.min(Math.max(requestedIndex, 0), spots.length - 1);
}

export function loadCachedSceneGuideContext(
  fallbackPreference: RoutePreferenceInput = defaultVisitorPreference,
): GuideRouteContext | undefined {
  const storedContext = loadGuideRouteContext();
  if (storedContext) return storedContext;

  const recommendationSession = loadRouteRecommendationSession();
  if (!recommendationSession?.routes.length) return undefined;

  const mapSession = loadRouteMapSession();
  const route =
    recommendationSession.routes.find(
      (item) => item.id === mapSession?.activeRouteId,
    ) ??
    recommendationSession.routes.find(
      (item) => item.mapId === fallbackPreference.mapId,
    ) ??
    recommendationSession.routes[0];

  return buildGuideRouteContextFromRoutePlan(
    route,
    recommendationSession.preference ?? fallbackPreference,
    mapSession?.activeSpotId,
  );
}
