import type {
  RoutePreferenceInput,
  TourHistoryEntry,
  TourSession,
} from '../types/scenic';

const key = (tourId: string) => `ling-shan-tour:${tourId}`;
const TOUR_HISTORY_KEY = 'ling-shan-tour-history:v1';
const TOUR_HISTORY_LIMIT = 5;

interface SaveTourRecoveryOptions {
  mapId?: RoutePreferenceInput['mapId'];
  coverSpotId?: string;
}

export function saveTourRecovery(
  tour: TourSession,
  options: SaveTourRecoveryOptions = {},
): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(key(tour.id), JSON.stringify(tour));
  } catch {
    // The Tour can continue even if the browser refuses local persistence.
  }
  upsertTourHistory(tour, options);
}

export function loadTourRecovery(tourId: string): TourSession | undefined {
  if (!canUseLocalStorage()) return undefined;
  try {
    const raw = window.localStorage.getItem(key(tourId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return isTourSession(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function loadTourHistory(): TourHistoryEntry[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(TOUR_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isTourHistoryEntry)
      .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
      .filter((entry, index, entries) => (
        entries.findIndex((candidate) => candidate.tourId === entry.tourId) === index
      ))
      .slice(0, TOUR_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function upsertTourHistory(
  tour: TourSession,
  options: SaveTourRecoveryOptions = {},
): TourHistoryEntry[] {
  if (!canUseLocalStorage()) return [];
  const existing = loadTourHistory();
  const previous = existing.find((entry) => entry.tourId === tour.id);
  const nextEntry: TourHistoryEntry = {
    tourId: tour.id,
    name: tour.name,
    mapId: options.mapId ?? previous?.mapId ?? inferMapId(tour),
    status: tour.status,
    startedAt: tour.startedAt,
    finishedAt: tour.finishedAt,
    coverSpotId:
      options.coverSpotId
      ?? pickCoverSpotId(tour)
      ?? previous?.coverSpotId,
    updatedAt: tour.updatedAt,
  };
  const next = [
    nextEntry,
    ...existing.filter((entry) => entry.tourId !== tour.id),
  ]
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
    .slice(0, TOUR_HISTORY_LIMIT);

  try {
    window.localStorage.setItem(TOUR_HISTORY_KEY, JSON.stringify(next));
  } catch {
    return existing;
  }
  return next;
}

export function removeTourHistoryEntry(tourId: string): TourHistoryEntry[] {
  if (!canUseLocalStorage()) return [];
  const next = loadTourHistory().filter((entry) => entry.tourId !== tourId);
  try {
    window.localStorage.setItem(TOUR_HISTORY_KEY, JSON.stringify(next));
  } catch {
    return loadTourHistory();
  }
  return next;
}

function inferMapId(tour: TourSession): RoutePreferenceInput['mapId'] {
  const nianhuaCount = tour.spots.filter((spot) => spot.spotId.startsWith('spot_nh_')).length;
  return nianhuaCount > tour.spots.length - nianhuaCount ? 'nianhua-bay' : 'ling-shan';
}

function pickCoverSpotId(tour: TourSession): string | undefined {
  const meaningfulSpots = tour.spots.filter((spot) => !isEntranceSpot(spot.spotId, spot.name));
  return (
    [...meaningfulSpots].reverse().find((spot) => spot.status === 'completed')?.spotId
    ?? meaningfulSpots.find((spot) => spot.status === 'current')?.spotId
    ?? meaningfulSpots[0]?.spotId
  );
}

function isEntranceSpot(spotId: string, name: string): boolean {
  return spotId.endsWith('_entrance') || name.trim() === '景区入口';
}

function isTourHistoryEntry(value: unknown): value is TourHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TourHistoryEntry>;
  return (
    typeof candidate.tourId === 'string'
    && candidate.tourId.length > 0
    && typeof candidate.name === 'string'
    && (candidate.mapId === 'ling-shan' || candidate.mapId === 'nianhua-bay')
    && (candidate.status === 'active' || candidate.status === 'finished')
    && typeof candidate.startedAt === 'string'
    && typeof candidate.updatedAt === 'string'
    && (candidate.finishedAt === undefined || typeof candidate.finishedAt === 'string')
    && (candidate.coverSpotId === undefined || typeof candidate.coverSpotId === 'string')
  );
}

function isTourSession(value: unknown): value is TourSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TourSession>;
  return (
    typeof candidate.id === 'string'
    && candidate.id.length > 0
    && typeof candidate.name === 'string'
    && (candidate.status === 'active' || candidate.status === 'finished')
    && typeof candidate.startedAt === 'string'
    && typeof candidate.updatedAt === 'string'
    && Array.isArray(candidate.spots)
  );
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canUseLocalStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage);
  } catch {
    return false;
  }
}
