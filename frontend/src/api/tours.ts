import { requestJson } from './client';
import type {
  TourRecap,
  TourRecapSpot,
  TourSession,
  TourSpot,
  RoutingProfile,
  TimeEstimationStatus,
} from '../types/scenic';

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
}

interface BackendRecap {
  id: string;
  name: string;
  status: TourRecap['status'];
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
  return {
    id: recap.id,
    name: recap.name,
    status: recap.status,
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
    })),
    aiTopics: recap.ai_topics,
  };
}

export async function createTour(
  routeDraftId: string,
  mapId?: 'ling-shan' | 'nianhua-bay',
): Promise<TourSession> {
  return toTour(
    await requestJson<BackendTour, unknown>('/api/tours', {
      method: 'POST',
      body: { route_draft_id: routeDraftId, map_id: mapId },
    }),
  );
}

export async function getTour(tourId: string): Promise<TourSession> {
  return toTour(
    await requestJson<BackendTour>(`/api/tours/${encodeURIComponent(tourId)}`),
  );
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
  return toTour(
    await requestJson<BackendTour, unknown>(
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
    ),
  );
}

export async function getTourRecap(tourId: string): Promise<TourRecap> {
  return toRecap(
    await requestJson<BackendRecap>(
      `/api/tours/${encodeURIComponent(tourId)}/recap`,
    ),
  );
}
