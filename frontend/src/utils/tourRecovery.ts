import type { TourSession } from '../types/scenic';

const key = (tourId: string) => `ling-shan-tour:${tourId}`;

export function saveTourRecovery(tour: TourSession): void {
  window.localStorage.setItem(key(tour.id), JSON.stringify(tour));
}

export function loadTourRecovery(tourId: string): TourSession | undefined {
  try {
    const raw = window.localStorage.getItem(key(tourId));
    return raw ? (JSON.parse(raw) as TourSession) : undefined;
  } catch {
    return undefined;
  }
}
