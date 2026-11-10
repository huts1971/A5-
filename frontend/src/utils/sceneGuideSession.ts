interface SceneGuideSessionState {
  routeKey: string;
  displaySpotId?: string;
  sessionId: string;
  muted: boolean;
  savedAt: number;
}

const SCENE_GUIDE_SESSION_KEY = 'a5-visitor-login-session:scene-guide';
const SCENE_GUIDE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createSceneGuideSessionId() {
  return `scene-guide-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadSceneGuideSession(): SceneGuideSessionState | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(SCENE_GUIDE_SESSION_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<SceneGuideSessionState>;
    if (
      typeof value.routeKey !== 'string' ||
      typeof value.sessionId !== 'string' ||
      typeof value.muted !== 'boolean' ||
      typeof value.savedAt !== 'number'
    ) {
      return undefined;
    }
    if (Date.now() - value.savedAt > SCENE_GUIDE_SESSION_TTL_MS) {
      window.sessionStorage.removeItem(SCENE_GUIDE_SESSION_KEY);
      return undefined;
    }
    return {
      routeKey: value.routeKey,
      displaySpotId:
        typeof value.displaySpotId === 'string' ? value.displaySpotId : undefined,
      sessionId: value.sessionId,
      muted: value.muted,
      savedAt: value.savedAt,
    };
  } catch {
    return undefined;
  }
}

export function saveSceneGuideSession(
  state: Omit<SceneGuideSessionState, 'savedAt'>,
) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      SCENE_GUIDE_SESSION_KEY,
      JSON.stringify({ ...state, savedAt: Date.now() }),
    );
  } catch {
    // Scene state is a convenience only. Storage failures must not block the guide.
  }
}

export function sceneGuideRouteKey(input: {
  tourId?: string;
  draftId?: string;
  routeId?: string;
  routeName: string;
}) {
  if (input.tourId) return `tour:${input.tourId}`;
  if (input.draftId) return `draft:${input.draftId}`;
  if (input.routeId) return `route:${input.routeId}`;
  return `route-name:${input.routeName}`;
}

