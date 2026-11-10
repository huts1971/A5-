import type {
  GuideRouteContext,
  GuideRouteContextSpot,
  RouteDraft,
  RoutePlan,
  RoutePreferenceInput,
  RouteSpot,
  TourSession,
  TourSpot,
} from '../types/scenic';
import { defaultVisitorPreference } from './visitorProfile';

const scenicNames: Record<RoutePreferenceInput['mapId'], string> = {
  'ling-shan': '灵山胜境',
  'nianhua-bay': '拈花湾',
};

export function scenicNameFromMapId(mapId: RoutePreferenceInput['mapId']) {
  return scenicNames[mapId];
}

export function normalizeGuidePreference(
  value: Partial<RoutePreferenceInput> | undefined,
  fallbackMapId: RoutePreferenceInput['mapId'] = defaultVisitorPreference.mapId,
): RoutePreferenceInput {
  return {
    mapId: value?.mapId ?? fallbackMapId,
    durationMinutes: Number.isFinite(Number(value?.durationMinutes))
      ? Number(value?.durationMinutes)
      : defaultVisitorPreference.durationMinutes,
    physicalLevel: value?.physicalLevel ?? defaultVisitorPreference.physicalLevel,
    interestTags: Array.isArray(value?.interestTags)
      ? value.interestTags
      : defaultVisitorPreference.interestTags,
  };
}

export function buildGuideRouteContextFromRoutePlan(
  route: RoutePlan,
  preference: RoutePreferenceInput,
  activeSpotId?: string,
): GuideRouteContext {
  const orderedSpots = route.spots.map(toGuideRouteContextSpot);
  const currentIndex = resolveCurrentIndex(orderedSpots, activeSpotId, 0);
  return {
    mapId: route.mapId,
    scenicName: scenicNameFromMapId(route.mapId),
    routeId: route.id,
    routeName: route.name,
    totalMinutes: route.durationMinutes,
    currentIndex,
    currentSpot: orderedSpots[currentIndex],
    nextSpot: orderedSpots[currentIndex + 1],
    orderedSpots,
    preference: {
      ...preference,
      mapId: route.mapId,
    },
    status: 'recommendation',
  };
}

export function buildGuideRouteContextFromDraft(
  draft: RouteDraft,
  mapId?: RoutePreferenceInput['mapId'],
  activeSpotId?: string,
): GuideRouteContext {
  const inferredMapId = mapId ?? inferMapIdFromSpotIds(draft.spots.map((spot) => spot.spotId));
  const orderedSpots = draft.spots.map(toGuideRouteContextSpot);
  const currentIndex = resolveCurrentIndex(orderedSpots, activeSpotId, 0);
  return {
    mapId: inferredMapId,
    scenicName: scenicNameFromMapId(inferredMapId),
    routeId: draft.sourceRouteId,
    draftId: draft.id,
    routeName: draft.name,
    totalMinutes: draft.totalMinutes,
    currentIndex,
    currentSpot: orderedSpots[currentIndex],
    nextSpot: orderedSpots[currentIndex + 1],
    orderedSpots,
    preference: normalizeGuidePreference(draft.preferenceProfile, inferredMapId),
    status: 'draft',
  };
}

export function buildGuideRouteContextFromTour(
  tour: TourSession,
  mapId?: RoutePreferenceInput['mapId'],
): GuideRouteContext {
  const inferredMapId = mapId ?? inferMapIdFromSpotIds(tour.spots.map((spot) => spot.spotId));
  const orderedSpots = tour.spots.map(toGuideRouteContextSpot);
  const currentIndex = resolveCurrentIndex(orderedSpots, undefined, tour.currentIndex);
  return {
    mapId: inferredMapId,
    scenicName: scenicNameFromMapId(inferredMapId),
    draftId: tour.routeDraftId,
    tourId: tour.id,
    routeName: tour.name,
    totalMinutes: sumTourMinutes(tour),
    currentIndex,
    currentSpot: orderedSpots[currentIndex],
    nextSpot: orderedSpots[currentIndex + 1],
    orderedSpots,
    status: tour.status === 'active' ? 'tour' : 'expired',
  };
}

export function guidePreferenceFromContext(context?: GuideRouteContext): RoutePreferenceInput {
  const preference = normalizeGuidePreference(context?.preference, context?.mapId ?? defaultVisitorPreference.mapId);
  if (!context?.preference?.durationMinutes && context?.totalMinutes) {
    preference.durationMinutes = context.totalMinutes;
  }
  return preference;
}

function toGuideRouteContextSpot(
  spot: RouteSpot | TourSpot,
  index: number,
): GuideRouteContextSpot {
  const sequence = 'sequence' in spot ? spot.sequence : index;
  return {
    spotId: spot.spotId,
    name: spot.name,
    stayMinutes: spot.stayMinutes,
    transitionMinutes: spot.transitionMinutes,
    transitionNote: spot.transitionNote,
    sequence,
    status: 'status' in spot ? spot.status : undefined,
    reason: spot.reason,
  };
}

function resolveCurrentIndex(
  spots: GuideRouteContextSpot[],
  activeSpotId: string | undefined,
  fallbackIndex: number,
) {
  if (activeSpotId) {
    const activeIndex = spots.findIndex((spot) => spot.spotId === activeSpotId);
    if (activeIndex >= 0) return activeIndex;
  }
  if (spots.length === 0) return 0;
  return Math.min(Math.max(fallbackIndex, 0), spots.length - 1);
}

function inferMapIdFromSpotIds(spotIds: string[]): RoutePreferenceInput['mapId'] {
  const nianhuaCount = spotIds.filter((spotId) => spotId.startsWith('spot_nh_')).length;
  return nianhuaCount > spotIds.length - nianhuaCount ? 'nianhua-bay' : 'ling-shan';
}

function sumTourMinutes(tour: TourSession) {
  return tour.spots.reduce(
    (total, spot, index) =>
      total + spot.stayMinutes + (index === 0 ? 0 : spot.transitionMinutes ?? 0),
    0,
  );
}
