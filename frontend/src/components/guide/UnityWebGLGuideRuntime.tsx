import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { getCurrentDigitalHumanAvatar } from '../../api';
import { avatar151Guide } from '../../config/avatar151Guide';
import type { GuideEmotionCue, UnityWebGLRuntimeConfig } from '../../config/avatar151Guide';
import { USE_MOCK_API } from '../../api/config';
import type { DigitalHumanRuntimeConfig } from '../../types/api';
import type { GuideStatus } from '../../types/scenic';
import type { AvatarAudioState } from './AvatarGuide';
import UnityWebGLGuideStage from './UnityWebGLGuideStage';

interface RuntimeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RuntimeProps {
  status: GuideStatus;
  audioState: AvatarAudioState;
  emotionCue: GuideEmotionCue;
  fallbackImageUrl: string;
  speechText: string;
  speechNonce: number;
  displayVariant: 'stage' | 'pet';
  onInteract?: () => void;
}

export interface UnityWebGLGuideTargetOptions extends RuntimeProps {
  enabled: boolean;
}

interface RuntimeContextValue {
  activate: (target: HTMLElement, props: RuntimeProps) => void;
  update: (target: HTMLElement, props: RuntimeProps) => void;
  deactivate: (target: HTMLElement) => void;
}

const inactiveRuntimeProps: RuntimeProps = {
  status: 'idle',
  audioState: 'idle',
  emotionCue: 'idle',
  fallbackImageUrl: avatar151Guide.fallbackImageUrl,
  speechText: '',
  speechNonce: 0,
  displayVariant: 'stage',
};

const preloadRect: RuntimeRect = {
  left: -10000,
  top: 0,
  width: 440,
  height: 640,
};

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

const builtinRuntimeConfig: DigitalHumanRuntimeConfig = {
  avatarId: 'builtin-avatar151',
  version: 'builtin-avatar151',
  loaderUrl: avatar151Guide.unityWebgl.loaderUrl,
  dataUrl: avatar151Guide.unityWebgl.dataUrl,
  frameworkUrl: avatar151Guide.unityWebgl.frameworkUrl,
  codeUrl: avatar151Guide.unityWebgl.codeUrl,
  streamingAssetsUrl: avatar151Guide.unityWebgl.streamingAssetsUrl,
  fallbackUrl: avatar151Guide.fallbackImageUrl,
  bridgeObjectName: avatar151Guide.unityWebgl.bridgeObjectName,
};

function rectFromElement(target: HTMLElement): RuntimeRect {
  const rect = target.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
}

function sameRect(left?: RuntimeRect, right?: RuntimeRect) {
  if (!left || !right) return false;
  return (
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  );
}

export function UnityWebGLGuideRuntimeProvider({ children }: { children: ReactNode }) {
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [activationKey, setActivationKey] = useState(0);
  const [runtimeProps, setRuntimeProps] = useState<RuntimeProps>(inactiveRuntimeProps);
  const [targetRect, setTargetRect] = useState<RuntimeRect>(preloadRect);
  const [runtimeConfig, setRuntimeConfig] = useState<DigitalHumanRuntimeConfig>(
    builtinRuntimeConfig,
  );
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeHost] = useState(() => {
    const host = document.createElement('div');
    host.className = 'unity-avatar-runtime-host';
    host.dataset.testid = 'unity-avatar-runtime-host';
    host.style.display = 'contents';
    return host;
  });

  const placeRuntimeHost = useCallback(
    (target: HTMLElement | null) => {
      const fullscreenElement = document.fullscreenElement;
      const runtimeScope = target?.closest<HTMLElement>(
        '[data-avatar-runtime-scope]',
      );
      const nextParent =
        fullscreenElement && target && fullscreenElement.contains(target)
          ? fullscreenElement
          : runtimeScope ?? document.body;
      if (runtimeHost.parentElement !== nextParent) {
        nextParent.appendChild(runtimeHost);
      }
    },
    [runtimeHost],
  );

  useEffect(() => {
    let cancelled = false;
    if (USE_MOCK_API) {
      setRuntimeReady(true);
      return undefined;
    }
    getCurrentDigitalHumanAvatar()
      .then((config) => {
        if (!cancelled) setRuntimeConfig(config);
      })
      .catch(() => {
        if (!cancelled) setRuntimeConfig(builtinRuntimeConfig);
      })
      .finally(() => {
        if (!cancelled) setRuntimeReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateRect = useCallback((target: HTMLElement) => {
    const nextRect = rectFromElement(target);
    setTargetRect((current) => (sameRect(current, nextRect) ? current : nextRect));
  }, []);

  const activate = useCallback(
    (target: HTMLElement, props: RuntimeProps) => {
      const isNewTarget = activeTargetRef.current !== target;
      activeTargetRef.current = target;
      placeRuntimeHost(target);
      setRuntimeProps(props);
      setActive(true);
      updateRect(target);
      if (isNewTarget) {
        setActivationKey((current) => current + 1);
      }
    },
    [placeRuntimeHost, updateRect],
  );

  const update = useCallback(
    (target: HTMLElement, props: RuntimeProps) => {
      if (activeTargetRef.current !== target) return;
      setRuntimeProps(props);
      updateRect(target);
    },
    [updateRect],
  );

  const deactivate = useCallback(
    (target: HTMLElement) => {
      if (activeTargetRef.current !== target) return;
      activeTargetRef.current = null;
      placeRuntimeHost(null);
      setActive(false);
      setRuntimeProps(inactiveRuntimeProps);
      setTargetRect(preloadRect);
    },
    [placeRuntimeHost],
  );

  useLayoutEffect(() => {
    const syncRuntimeHost = () => {
      const target = activeTargetRef.current;
      placeRuntimeHost(target);
      if (target) updateRect(target);
    };

    syncRuntimeHost();
    document.addEventListener('fullscreenchange', syncRuntimeHost);
    return () => {
      document.removeEventListener('fullscreenchange', syncRuntimeHost);
      runtimeHost.remove();
    };
  }, [placeRuntimeHost, runtimeHost, updateRect]);

  useLayoutEffect(() => {
    if (!active || !activeTargetRef.current) return undefined;

    const target = activeTargetRef.current;
    let frame = 0;
    let resizeObserver: ResizeObserver | undefined;

    const scheduleUpdate = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (activeTargetRef.current === target) updateRect(target);
      });
    };

    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(target);
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      resizeObserver?.disconnect();
    };
  }, [active, updateRect]);

  const contextValue = useMemo(
    () => ({
      activate,
      update,
      deactivate,
    }),
    [activate, deactivate, update],
  );

  const rect = active ? targetRect : preloadRect;
  const runtimeStyle = {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  } satisfies CSSProperties;
  const handleRuntimeFailure = useCallback(() => {
    setRuntimeConfig((current) =>
      current.avatarId === builtinRuntimeConfig.avatarId
        ? current
        : builtinRuntimeConfig,
    );
  }, []);
  const unityRuntimeConfig: UnityWebGLRuntimeConfig = {
    loaderUrl: runtimeConfig.loaderUrl,
    dataUrl: runtimeConfig.dataUrl,
    frameworkUrl: runtimeConfig.frameworkUrl,
    codeUrl: runtimeConfig.codeUrl,
    streamingAssetsUrl: runtimeConfig.streamingAssetsUrl,
    bridgeObjectName: runtimeConfig.bridgeObjectName,
    loadTimeoutMs: avatar151Guide.unityWebgl.loadTimeoutMs,
  };

  const runtimeNode = runtimeReady ? (
    <div
      className={`unity-avatar-runtime luxury-avatar-stage unity-avatar-runtime--${runtimeProps.displayVariant} ${
        active ? 'is-active' : 'is-preloading'
      }`}
      style={runtimeStyle}
      aria-hidden={!active}
    >
      <UnityWebGLGuideStage
        key={runtimeConfig.version}
        status={runtimeProps.status}
        audioState={runtimeProps.audioState}
        emotionCue={runtimeProps.emotionCue}
        fallbackImageUrl={
          runtimeProps.displayVariant === 'pet'
            ? runtimeProps.fallbackImageUrl
            : runtimeConfig.fallbackUrl || runtimeProps.fallbackImageUrl
        }
        speechText={runtimeProps.speechText}
        speechNonce={runtimeProps.speechNonce}
        showLoadingHint={runtimeProps.displayVariant === 'pet'}
        active={active}
        activationKey={activationKey}
        onInteract={runtimeProps.onInteract}
        runtimeConfig={unityRuntimeConfig}
        onLoadFailure={handleRuntimeFailure}
      />
    </div>
  ) : null;

  return (
    <RuntimeContext.Provider value={contextValue}>
      {children}
      {runtimeNode ? createPortal(runtimeNode, runtimeHost) : null}
    </RuntimeContext.Provider>
  );
}

export function useUnityWebGLGuideTarget(options: UnityWebGLGuideTargetOptions): {
  targetRef: RefObject<HTMLDivElement>;
  available: boolean;
} {
  const runtime = useContext(RuntimeContext);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const available = Boolean(runtime);

  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!runtime || !options.enabled || !target) return undefined;
    runtime.activate(target, options);
    return () => runtime.deactivate(target);
  }, [runtime, options.enabled]);

  useEffect(() => {
    const target = targetRef.current;
    if (!runtime || !options.enabled || !target) return;
    runtime.update(target, options);
  }, [
    runtime,
    options.audioState,
    options.emotionCue,
    options.enabled,
    options.fallbackImageUrl,
    options.displayVariant,
    options.onInteract,
    options.speechNonce,
    options.speechText,
    options.status,
  ]);

  return { targetRef, available };
}
