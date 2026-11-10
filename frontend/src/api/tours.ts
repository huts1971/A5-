import { requestJson } from './client';
import type {
  TourRecap,
  TourRecapMovement,
  TourRecapSpot,
  TourSession,
  TourSpot,
  RoutingProfile,
  TimeEstimationStatus,
} from '../types/scenic';
import { saveTourRecovery } from '../utils/tourRecovery';

interface BackendTourSpot {
  spot_id: string;
  name: string;
  sequence: number;
  stay_minutes: number;
  reason: string;
  transition_minutes?: number | null;
  transition_note?: string;
  status: TourSpot['status'];
  arrived_at?: string | null;
  completed_at?: string | null;
}

interface BackendTour {
  id: string;
  route_draft_id: string;
  name: string;
  map_id?: 'ling-shan' | 'nianhua-bay';
  status: TourSession['status'];
  current_index: number;
  started_at: string;
  updated_at: string;
  finished_at?: string | null;
  event_count: number;
  routing_profile?: RoutingProfile;
  time_estimation_status?: TimeEstimationStatus;
  spots: BackendTourSpot[];
}

interface BackendRecapSpot {
  spot_id: string;
  name: string;
  result: TourRecapSpot['result'];
  occurred_at: string;
  planned_stay_minutes?: number;
  transition_minutes?: number | null;
}

interface BackendRecapMovement {
  estimated_walking_minutes?: number | null;
  estimated_walk_minutes?: number | null;
  planned_scenic_minutes?: number | null;
  planned_visit_minutes?: number | null;
  estimated_distance_meters?: number | null;
  estimated_steps?: number | null;
  estimated_calories_kcal?: number | null;
  estimated_calories?: number | null;
  coverage_ratio?: number;
  confidence?: TourRecapMovement['confidence'];
  formula_version?: string;
}

interface BackendRecap {
  id: string;
  name: string;
  status: TourRecap['status'];
  map_id?: TourRecap['mapId'];
  started_at: string;
  finished_at?: string | null;
  elapsed_minutes: number;
  completed_count: number;
  skipped_count: number;
  adjustment_count: number;
  deviation_count?: number;
  recommended_order?: string[];
  preference_profile?: TourRecap['preferenceProfile'];
  actual_order: BackendRecapSpot[];
  ai_topics: string[];
  movement?: BackendRecapMovement;
}

function toTour(tour: BackendTour): TourSession {
  return {
    id: tour.id,
    routeDraftId: tour.route_draft_id,
    name: tour.name,
    status: tour.status,
    currentIndex: tour.current_index,
    startedAt: tour.started_at,
    updatedAt: tour.updated_at,
    finishedAt: tour.finished_at ?? undefined,
    eventCount: tour.event_count,
    routingProfile: tour.routing_profile ?? 'fastest',
    timeEstimationStatus: tour.time_estimation_status ?? 'unavailable',
    spots: tour.spots.map((spot) => ({
      spotId: spot.spot_id,
      name: spot.name,
      sequence: spot.sequence,
      stayMinutes: spot.stay_minutes,
      reason: spot.reason,
      transitionMinutes: spot.transition_minutes,
      transitionNote: spot.transition_note,
      status: spot.status,
      arrivedAt: spot.arrived_at ?? undefined,
      completedAt: spot.completed_at ?? undefined,
    })),
  };
}

function toRecap(recap: BackendRecap): TourRecap {
  const movement = recap.movement;
  return {
    id: recap.id,
    name: recap.name,
    status: recap.status,
    mapId: recap.map_id ?? inferRecapMapId(recap.actual_order),
    startedAt: recap.started_at,
    finishedAt: recap.finished_at ?? undefined,
    elapsedMinutes: recap.elapsed_minutes,
    completedCount: recap.completed_count,
    skippedCount: recap.skipped_count,
    adjustmentCount: recap.adjustment_count,
    deviationCount: recap.deviation_count ?? 0,
    recommendedOrder: recap.recommended_order ?? [],
    preferenceProfile: recap.preference_profile ?? {},
    actualOrder: recap.actual_order.map((spot) => ({
      spotId: spot.spot_id,
      name: spot.name,
      result: spot.result,
      occurredAt: spot.occurred_at,
      plannedStayMinutes: spot.planned_stay_minutes ?? 0,
      transitionMinutes: spot.transition_minutes,
    })),
    aiTopics: recap.ai_topics,
    movement: {
      estimatedWalkingMinutes: numberOrUndefined(
        movement?.estimated_walking_minutes ?? movement?.estimated_walk_minutes,
      ),
      plannedScenicMinutes: numberOrUndefined(
        movement?.planned_scenic_minutes ?? movement?.planned_visit_minutes,
      ),
      estimatedDistanceMeters: numberOrUndefined(movement?.estimated_distance_meters),
      estimatedSteps: numberOrUndefined(movement?.estimated_steps),
      estimatedCaloriesKcal: numberOrUndefined(
        movement?.estimated_calories_kcal ?? movement?.estimated_calories,
      ),
      coverageRatio: clampRatio(movement?.coverage_ratio),
      confidence: movement?.confidence ?? 'unavailable',
      formulaVersion: movement?.formula_version ?? 'demo-v1',
    },
  };
}

export async function createTour(
  routeDraftId: string,
  mapId?: 'ling-shan' | 'nianhua-bay',
): Promise<TourSession> {
  const backendTour = await requestJson<BackendTour, unknown>('/api/tours', {
    method: 'POST',
    body: { route_draft_id: routeDraftId, map_id: mapId },
  });
  return persistTour(
    toTour(backendTour),
    backendTour.map_id ?? mapId,
  );
}

export async function getTour(tourId: string): Promise<TourSession> {
  const backendTour = await requestJson<BackendTour>(
    `/api/tours/${encodeURIComponent(tourId)}`,
  );
  return persistTour(toTour(backendTour), backendTour.map_id);
}

export async function recordTourEvent(
  tourId: string,
  eventType:
    | 'spot_arrived'
    | 'spot_completed'
    | 'spot_skipped'
    | 'route_adjusted'
    | 'ai_consulted'
    | 'tour_finished',
  spotId?: string,
  details?: { note?: string; topic?: string },
): Promise<TourSession> {
  const backendTour = await requestJson<BackendTour, unknown>(
    `/api/tours/${encodeURIComponent(tourId)}/events`,
    {
      method: 'POST',
      body: {
        event_type: eventType,
        spot_id: spotId,
        note: details?.note,
        topic: details?.topic,
      },
    },
  );
  return persistTour(toTour(backendTour), backendTour.map_id);
}

export async function getTourRecap(tourId: string): Promise<TourRecap> {
  return toRecap(
    await requestJson<BackendRecap>(
      `/api/tours/${encodeURIComponent(tourId)}/recap`,
    ),
  );
}

function persistTour(
  tour: TourSession,
  mapId?: 'ling-shan' | 'nianhua-bay',
): TourSession {
  saveTourRecovery(tour, { mapId });
  return tour;
}

function inferRecapMapId(
  spots: BackendRecapSpot[],
): TourRecap['mapId'] {
  const nianhuaCount = spots.filter((spot) => spot.spot_id.startsWith('spot_nh_')).length;
  return nianhuaCount > spots.length - nianhuaCount ? 'nianhua-bay' : 'ling-shan';
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampRatio(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
