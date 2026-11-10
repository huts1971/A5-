import { requestJson } from './client';
import { USE_MOCK_API } from './config';
import { routePlans } from './mock/visitorData';
import type {
  RoutePlan,
  RoutePreferenceInput,
  RoutingProfile,
  TimeEstimationStatus,
} from '../types/scenic';

const wait = (ms = 260) => new Promise((resolve) => window.setTimeout(resolve, ms));

interface BackendRouteSpot {
  id: string;
  name: string;
  stay_minutes: number;
  reason: string;
  transition_minutes?: number | null;
  transition_note?: string;
}

interface BackendRoute {
  id: string;
  map_id?: 'ling-shan' | 'nianhua-bay';
  name: string;
  theme: string;
  stay_minutes?: number;
  estimated_walk_minutes?: number;
  total_minutes: number;
  time_data_complete?: boolean;
  generation_mode?: 'dynamic' | 'template_fallback';
  preference_match?: number;
  constraint_summary?: string;
  path_complete?: boolean;
  routing_profile?: RoutingProfile;
  time_estimation_status?: TimeEstimationStatus;
  spots: BackendRouteSpot[];
  recommendation_reason: string;
}

interface BackendRouteResponse {
  items: BackendRoute[];
}

export function toRoutePlan(route: BackendRoute): RoutePlan {
  return {
    id: route.id,
    mapId: route.map_id ?? 'ling-shan',
    name: route.name,
    theme: route.theme,
    durationMinutes: route.total_minutes,
    suitableCrowd: [route.theme],
    description: route.recommendation_reason,
    reason: route.recommendation_reason,
    stayMinutes:
      route.stay_minutes ??
      route.spots.reduce((total, spot) => total + spot.stay_minutes, 0),
    estimatedWalkMinutes: route.estimated_walk_minutes ?? 0,
    timeDataComplete: route.time_data_complete ?? false,
    generationMode: route.generation_mode ?? 'template_fallback',
    preferenceMatch: route.preference_match ?? 0,
    constraintSummary: route.constraint_summary ?? '',
    pathComplete: route.path_complete ?? false,
    routingProfile: route.routing_profile ?? 'fastest',
    timeEstimationStatus: route.time_estimation_status ?? 'unavailable',
    spots: route.spots.map((spot) => ({
      spotId: spot.id,
      name: spot.name,
      stayMinutes: spot.stay_minutes,
      reason: spot.reason,
      transitionMinutes: spot.transition_minutes,
      transitionNote: spot.transition_note,
    })),
  };
}

export async function recommendRoutes(input: RoutePreferenceInput): Promise<RoutePlan[]> {
  if (!USE_MOCK_API) {
    const response = await requestJson<BackendRouteResponse, unknown>('/api/routes/recommend', {
      method: 'POST',
      body: {
        map_id: input.mapId,
        duration_minutes: input.durationMinutes,
        physical_level: input.physicalLevel,
        interest_tags: input.interestTags,
      },
    });
    return response.items.map(toRoutePlan);
  }

  await wait();

  const filtered = routePlans.filter(
    (route) =>
      route.mapId === input.mapId &&
      route.durationMinutes <= input.durationMinutes + 20,
  );

  return filtered.length > 0
    ? filtered.slice(0, 1)
    : routePlans.filter((route) => route.mapId === input.mapId).slice(0, 1);
}
