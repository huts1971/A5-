export interface TourRecapJournalHandoff {
  routeName: string;
  completedSpotNames: string[];
  interestTags: string[];
  recapSummary: string;
}

export interface TourRecapPhotoHandoff {
  coverImageUrl?: string;
  spotName?: string;
  prompt: string;
}

const JOURNAL_HANDOFF_KEY = 'ling-shan-tour-recap:journal:v1';
const PHOTO_HANDOFF_KEY = 'ling-shan-tour-recap:photo:v1';

export function writeTourRecapJournalHandoff(
  payload: TourRecapJournalHandoff,
): void {
  writeHandoff(JOURNAL_HANDOFF_KEY, payload);
}

export function consumeTourRecapJournalHandoff():
  TourRecapJournalHandoff | undefined {
  const value = consumeHandoff(JOURNAL_HANDOFF_KEY);
  return isJournalHandoff(value) ? value : undefined;
}

export function writeTourRecapPhotoHandoff(
  payload: TourRecapPhotoHandoff,
): void {
  writeHandoff(PHOTO_HANDOFF_KEY, payload);
}

export function consumeTourRecapPhotoHandoff():
  TourRecapPhotoHandoff | undefined {
  const value = consumeHandoff(PHOTO_HANDOFF_KEY);
  return isPhotoHandoff(value) ? value : undefined;
}

function writeHandoff(key: string, value: unknown): void {
  if (!canUseSessionStorage()) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cross-page prefill is optional; navigation must keep working without it.
  }
}

function consumeHandoff(key: string): unknown {
  if (!canUseSessionStorage()) return undefined;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isJournalHandoff(value: unknown): value is TourRecapJournalHandoff {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TourRecapJournalHandoff>;
  return (
    typeof candidate.routeName === 'string'
    && Array.isArray(candidate.completedSpotNames)
    && candidate.completedSpotNames.every((name) => typeof name === 'string')
    && Array.isArray(candidate.interestTags)
    && candidate.interestTags.every((tag) => typeof tag === 'string')
    && typeof candidate.recapSummary === 'string'
  );
}

function isPhotoHandoff(value: unknown): value is TourRecapPhotoHandoff {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TourRecapPhotoHandoff>;
  return (
    typeof candidate.prompt === 'string'
    && candidate.prompt.trim().length > 0
    && (candidate.coverImageUrl === undefined || typeof candidate.coverImageUrl === 'string')
    && (candidate.spotName === undefined || typeof candidate.spotName === 'string')
  );
}

function canUseSessionStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.sessionStorage);
  } catch {
    return false;
  }
}
