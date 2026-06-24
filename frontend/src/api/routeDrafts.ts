import { requestJson } from './client';
import type {
  RouteDraft,
  RouteDraftSpot,
  RoutePlan,
  RoutePreferenceInput,
  RoutingProfile,
  TimeEstimationStatus,
} from '../types/scenic';

interface BackendDraftSpot {
  spot_id: string;
  name: string;
  sequence: number;
  stay_minutes: number;
  reason: string;
  transition_minutes?: number | null;
  transition_note?: string;
}

interface BackendDraft {
  id: string;
  source_route_id?: string | null;
  name: string;
  theme: string;
  duration_budget: number;
  preference_profile?: Partial<RoutePreferenceInput>;
  stay_minutes: number;
  estimated_walk_minutes: number;
  total_minutes: number;
  time_data_complete: boolean;
  routing_profile?: RoutingProfile;
  time_estimation_status?: TimeEstimationStatus;
  budget_exceeded: boolean;
  revision_count: number;
  spots: BackendDraftSpot[];
  created_at: string;
  updated_at: string;
}

function toDraftSpot(spot: BackendDraftSpot): RouteDraftSpot {
  return {
    spotId: spot.spot_id,
    name: spot.name,
    sequence: spot.sequence,
    stayMinutes: spot.stay_minutes,
    reason: spot.reason,
    transitionMinutes: spot.transition_minutes,
    transitionNote: spot.transition_note,
  };
}

function toDraft(draft: BackendDraft): RouteDraft {
  return {
    id: draft.id,
    sourceRouteId: draft.source_route_id ?? undefined,
    name: draft.name,
    theme: draft.theme,
    durationBudget: draft.duration_budget,
    preferenceProfile: draft.preference_profile ?? {},
    stayMinutes: draft.stay_minutes,
    estimatedWalkMinutes: draft.estimated_walk_minutes,
    totalMinutes: draft.total_minutes,
    timeDataComplete: draft.time_data_complete,
    routingProfile: draft.routing_profile ?? 'fastest',
    timeEstimationStatus: draft.time_estimation_status ?? 'unavailable',
    budgetExceeded: draft.budget_exceeded,
    revisionCount: draft.revision_count,
    spots: draft.spots.map(toDraftSpot),
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
  };
}

export async function createRouteDraft(
  route: RoutePlan,
  preference: RoutePreferenceInput,
): Promise<RouteDraft> {
  const draft = await requestJson<BackendDraft, unknown>('/api/route-drafts', {
    method: 'POST',
    body: {
      source_route_id:
        route.generationMode === 'template_fallback' ? route.id : undefined,
      name: route.name,
      theme: route.theme,
      duration_budget: preference.durationMinutes,
      preference_profile: preference,
      spots: route.spots.map((spot) => ({
        spot_id: spot.spotId,
        stay_minutes: spot.stayMinutes,
        reason: spot.reason,
      })),
    },
  });
  return toDraft(draft);
}

export async function getRouteDraft(draftId: string): Promise<RouteDraft> {
  return toDraft(
    await requestJson<BackendDraft>(
      `/api/route-drafts/${encodeURIComponent(draftId)}`,
    ),
  );
}

export async function addRouteDraftSpot(
  draftId: string,
  input: {
    spotId: string;
    position: number;
    stayMinutes?: number;
    allowBudgetExceeded?: boolean;
    replaceOtherArea?: boolean;
  },
): Promise<RouteDraft> {
  return toDraft(
    await requestJson<BackendDraft, unknown>(
      `/api/route-drafts/${encodeURIComponent(draftId)}/spots`,
      {
        method: 'POST',
        body: {
          spot_id: input.spotId,
          position: input.position,
          stay_minutes: input.stayMinutes,
          allow_budget_exceeded: input.allowBudgetExceeded ?? false,
          replace_other_area: input.replaceOtherArea ?? false,
        },
      },
    ),
  );
}

export async function deleteRouteDraftSpot(
  draftId: string,
  spotId: string,
): Promise<RouteDraft> {
  return toDraft(
    await requestJson<BackendDraft>(
      `/api/route-drafts/${encodeURIComponent(draftId)}/spots/${encodeURIComponent(spotId)}`,
      { method: 'DELETE' },
    ),
  );
}

export async function reorderRouteDraftSpots(
  draftId: string,
  spotIds: string[],
  allowBudgetExceeded = false,
): Promise<RouteDraft> {
  return toDraft(
    await requestJson<BackendDraft, unknown>(
      `/api/route-drafts/${encodeURIComponent(draftId)}/spots/reorder`,
      {
        method: 'POST',
        body: {
          spot_ids: spotIds,
          allow_budget_exceeded: allowBudgetExceeded,
        },
      },
    ),
  );
}

export async function scopeRouteDraft(
  draftId: string,
  mapId: 'ling-shan' | 'nianhua-bay',
): Promise<RouteDraft> {
  return toDraft(
    await requestJson<BackendDraft, unknown>(
      `/api/route-drafts/${encodeURIComponent(draftId)}/scope`,
      {
        method: 'POST',
        body: { map_id: mapId },
      },
    ),
  );
}

export async function undoRouteDraft(draftId: string): Promise<RouteDraft> {
  return toDraft(
    await requestJson<BackendDraft, unknown>(
      `/api/route-drafts/${encodeURIComponent(draftId)}/undo`,
      { method: 'POST' },
    ),
  );
}
