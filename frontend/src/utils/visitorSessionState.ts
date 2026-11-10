import type { ChatMessage, GuideRouteContext, RoutePlan, RoutePreferenceInput } from '../types/scenic';

const STORAGE_PREFIX = 'a5-visitor-login-session:';
const GUIDE_CHAT_KEY = `${STORAGE_PREFIX}guide-chat`;
const GUIDE_ROUTE_CONTEXT_KEY = `${STORAGE_PREFIX}guide-route-context`;
const GUIDE_ROUTE_DRAWER_KEY = `${STORAGE_PREFIX}guide-route-drawer-open`;
const ROUTE_RECOMMENDATION_KEY = `${STORAGE_PREFIX}route-recommendation`;
const ROUTE_MAP_KEY = `${STORAGE_PREFIX}route-map`;
const ROUTE_ENTRY_KEY = `${STORAGE_PREFIX}route-entry`;
const SESSION_VERSION_KEY = `${STORAGE_PREFIX}session-version`;
const GUIDE_ROUTE_CONTEXT_TTL_MS = 12 * 60 * 60 * 1000;
const VISITOR_SESSION_VERSION = 'route-aware-guide-v3-lingshiyin';

let pageOpenPrepared = false;

export interface GuideChatSessionState {
  messages: ChatMessage[];
  sessionId: string;
  introReady: boolean;
  handledInitialQuestionKey?: string;
}

export interface RouteRecommendationSessionState {
  preference: RoutePreferenceInput;
  routes: RoutePlan[];
  savedAt: number;
}

export interface RouteMapSessionState {
  activeMapId?: RoutePreferenceInput['mapId'];
  activeRouteId?: string;
  activeSpotId?: string;
  savedAt: number;
}

export interface RouteEntrySessionState {
  mode: 'recommendation' | 'draft' | 'tour';
  path: string;
  skipHydraLoader?: boolean;
  savedAt: number;
}

export function loadGuideChatSession(): GuideChatSessionState | undefined {
  return readSessionValue<GuideChatSessionState>(GUIDE_CHAT_KEY, isGuideChatSessionState);
}

export function saveGuideChatSession(state: GuideChatSessionState): void {
  const messages = sanitizeMessages(state.messages);
  if (messages.length === 0 && !state.introReady) return;
  writeSessionValue(GUIDE_CHAT_KEY, {
    ...state,
    messages,
  });
}

export function loadGuideRouteContext(): GuideRouteContext | undefined {
  const context = readSessionValue<GuideRouteContext>(
    GUIDE_ROUTE_CONTEXT_KEY,
    isGuideRouteContext,
  );
  if (!context) return undefined;
  if (
    context.savedAt &&
    Date.now() - context.savedAt > GUIDE_ROUTE_CONTEXT_TTL_MS &&
    context.status !== 'expired'
  ) {
    return {
      ...context,
      status: 'expired',
    };
  }
  return context;
}

export function saveGuideRouteContext(context: GuideRouteContext): void {
  writeSessionValue(GUIDE_ROUTE_CONTEXT_KEY, {
    ...context,
    savedAt: Date.now(),
  });
}

export function clearGuideRouteContext(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(GUIDE_ROUTE_CONTEXT_KEY);
  } catch {
    // Route context is optional demo state; failures should not block normal chat.
  }
}

export function loadGuideRouteDrawerOpen(): boolean {
  return readSessionValue<boolean>(
    GUIDE_ROUTE_DRAWER_KEY,
    (value): value is boolean => typeof value === 'boolean',
  ) ?? false;
}

export function saveGuideRouteDrawerOpen(open: boolean): void {
  writeSessionValue(GUIDE_ROUTE_DRAWER_KEY, open);
}

export function loadRouteRecommendationSession(): RouteRecommendationSessionState | undefined {
  return readSessionValue<RouteRecommendationSessionState>(
    ROUTE_RECOMMENDATION_KEY,
    isRouteRecommendationSessionState,
  );
}

export function saveRouteRecommendationSession(
  state: Omit<RouteRecommendationSessionState, 'savedAt'>,
): void {
  writeSessionValue(ROUTE_RECOMMENDATION_KEY, {
    ...state,
    savedAt: Date.now(),
  });
}

export function loadRouteMapSession(): RouteMapSessionState | undefined {
  return readSessionValue<RouteMapSessionState>(ROUTE_MAP_KEY, isRouteMapSessionState);
}

export function saveRouteMapSession(state: Omit<RouteMapSessionState, 'savedAt'>): void {
  writeSessionValue(ROUTE_MAP_KEY, {
    ...state,
    savedAt: Date.now(),
  });
}

export function loadRouteEntrySession(): RouteEntrySessionState | undefined {
  return readSessionValue<RouteEntrySessionState>(ROUTE_ENTRY_KEY, isRouteEntrySessionState);
}

export function saveRouteEntrySession(state: Omit<RouteEntrySessionState, 'savedAt'>): void {
  writeSessionValue(ROUTE_ENTRY_KEY, {
    ...state,
    savedAt: Date.now(),
  });
}

export function clearVisitorSessionState(): void {
  if (typeof window === 'undefined') return;
  try {
    Object.keys(window.sessionStorage)
      .filter((key) => key.startsWith(STORAGE_PREFIX))
      .forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Session memory is a convenience only; auth and API behavior must keep working.
  }
}

export function prepareVisitorSessionStateForPageOpen(): void {
  if (typeof window === 'undefined' || pageOpenPrepared) return;
  pageOpenPrepared = true;
  try {
    const navigationType = getNavigationType();
    const storedVersion = window.sessionStorage.getItem(SESSION_VERSION_KEY);
    const shouldReset =
      storedVersion !== VISITOR_SESSION_VERSION || navigationType === 'navigate';
    if (shouldReset) {
      clearVisitorSessionState();
    }
    window.sessionStorage.setItem(SESSION_VERSION_KEY, VISITOR_SESSION_VERSION);
  } catch {
    // If the browser blocks storage/performance APIs, keep the normal app flow alive.
  }
}

function readSessionValue<T>(key: string, guard: (value: unknown) => value is T): T | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeSessionValue(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage quota or browser privacy settings should not break the demo flow.
  }
}

function getNavigationType(): PerformanceNavigationTiming['type'] | 'unknown' {
  const [navigation] = window.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return navigation?.type ?? 'unknown';
}

function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role !== 'assistant' || message.content.trim())
    .map(stripEphemeralMessageState)
    .slice(-80);
}

function stripEphemeralMessageState(message: ChatMessage): ChatMessage {
  if (!message.voice && !message.image) return message;
  const { inputMode: _inputMode, voice: _voice, image: _image, ...textMessage } = message;
  return textMessage;
}

function isGuideChatSessionState(value: unknown): value is GuideChatSessionState {
  const candidate = value as GuideChatSessionState;
  return (
    Boolean(candidate) &&
    Array.isArray(candidate.messages) &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.introReady === 'boolean'
  );
}

function isRouteRecommendationSessionState(value: unknown): value is RouteRecommendationSessionState {
  const candidate = value as RouteRecommendationSessionState;
  return (
    Boolean(candidate) &&
    Boolean(candidate.preference) &&
    Array.isArray(candidate.routes) &&
    typeof candidate.savedAt === 'number'
  );
}

function isGuideRouteContext(value: unknown): value is GuideRouteContext {
  const candidate = value as GuideRouteContext;
  return (
    Boolean(candidate) &&
    (candidate.status === 'recommendation' ||
      candidate.status === 'draft' ||
      candidate.status === 'tour' ||
      candidate.status === 'expired') &&
    (candidate.mapId === 'ling-shan' || candidate.mapId === 'nianhua-bay') &&
    typeof candidate.scenicName === 'string' &&
    typeof candidate.routeName === 'string' &&
    typeof candidate.currentIndex === 'number' &&
    Array.isArray(candidate.orderedSpots) &&
    candidate.orderedSpots.every(
      (spot) =>
        spot &&
        typeof spot.spotId === 'string' &&
        typeof spot.name === 'string' &&
        typeof spot.stayMinutes === 'number',
    )
  );
}

function isRouteMapSessionState(value: unknown): value is RouteMapSessionState {
  const candidate = value as RouteMapSessionState;
  return Boolean(candidate) && typeof candidate.savedAt === 'number';
}

function isRouteEntrySessionState(value: unknown): value is RouteEntrySessionState {
  const candidate = value as RouteEntrySessionState;
  const isRecommendationPath = candidate?.mode === 'recommendation' && candidate.path.startsWith('/routes');
  const isDraftPath = candidate?.mode === 'draft' && candidate.path.startsWith('/route-drafts/');
  const isTourPath = candidate?.mode === 'tour' && candidate.path.startsWith('/tour/');
  return (
    Boolean(candidate) &&
    (candidate.mode === 'recommendation' || candidate.mode === 'draft' || candidate.mode === 'tour') &&
    typeof candidate.path === 'string' &&
    (isRecommendationPath || isDraftPath || isTourPath) &&
    typeof candidate.savedAt === 'number'
  );
}
