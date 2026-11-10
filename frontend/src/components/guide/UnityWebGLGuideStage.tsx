import { useEffect, useRef, useState } from 'react';
import { avatar151Guide } from '../../config/avatar151Guide';
import type { GuideEmotionCue, UnityWebGLRuntimeConfig } from '../../config/avatar151Guide';
import type { GuideStatus } from '../../types/scenic';
import type { AvatarAudioState } from './AvatarGuide';

type UnityAvatarState = 'welcome' | 'idle' | 'thinking' | 'speaking' | 'fallback';

interface UnityInstance {
  SendMessage: (objectName: string, methodName: string, value?: string) => void;
  Quit?: () => Promise<void>;
}

declare global {
  interface Window {
    createUnityInstance?: (
      canvas: HTMLCanvasElement,
      config: Record<string, unknown>,
      onProgress?: (progress: number) => void,
    ) => Promise<UnityInstance>;
    __unityLoaderUrl?: string;
    __avatar151Debug?: {
      playMotion: (group: UnityAvatarState) => void;
      speakText: (text: string) => void;
      setEmotionCue: (cue: GuideEmotionCue) => void;
      setExpressionCue: (cue: GuideEmotionCue) => void;
      getCurrentState: () => { phase: string; state: UnityAvatarState; progress: number };
    };
  }
}

export interface UnityWebGLGuideStageProps {
  status: GuideStatus;
  audioState: AvatarAudioState;
  emotionCue?: GuideEmotionCue;
  speechText?: string;
  speechNonce?: number;
  fallbackImageUrl?: string;
  showLoadingHint?: boolean;
  active?: boolean;
  activationKey?: number;
  className?: string;
  onInteract?: () => void;
  runtimeConfig?: UnityWebGLRuntimeConfig;
  ariaLabel?: string;
  onLoadFailure?: () => void;
  onPhaseChange?: (phase: 'loading' | 'ready' | 'fallback') => void;
  onProgressChange?: (progress: number) => void;
}

function resolveAvatarState(status: GuideStatus, audioState: AvatarAudioState, emotionCue?: GuideEmotionCue): UnityAvatarState {
  if (emotionCue === 'fallback') return 'fallback';
  if (audioState === 'playing' || status === 'speaking' || emotionCue === 'speaking') return 'speaking';
  if (status === 'thinking' || emotionCue === 'thinking') return 'thinking';
  if (emotionCue === 'welcome' || emotionCue === 'wake') return 'welcome';
  return 'idle';
}

function loadUnityLoader(loaderUrl: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (window.createUnityInstance && window.__unityLoaderUrl === loaderUrl) {
      resolve();
      return;
    }
    if (window.__unityLoaderUrl !== loaderUrl) {
      window.createUnityInstance = undefined;
      document.querySelectorAll('script[data-unity-loader]').forEach((element) => element.remove());
    }

    const script = document.createElement('script');
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      script.remove();
      reject(new Error('Unity WebGL loader timed out.'));
    }, timeoutMs);

    script.src = loaderUrl;
    script.dataset.unityLoader = loaderUrl;
    script.async = true;
    script.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (!window.createUnityInstance) {
        reject(new Error('Unity WebGL loader did not expose createUnityInstance.'));
        return;
      }
      window.__unityLoaderUrl = loaderUrl;
      resolve();
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error('Unity WebGL build is not available yet.'));
    };
    document.head.appendChild(script);
  });
}

const AVATAR_VISIBLE_PIXEL_THRESHOLD = 900;
const WELCOME_SETTLE_MS = 2600;
const AVATAR_CANVAS_DPR_CAP = 1.25;

function resolveCanvasBackingSize(source: HTMLCanvasElement) {
  const rect = source.getBoundingClientRect();
  // getImageData 每帧读回 WebGL 画面会比较吃性能；限制 DPR 可以明显降低讲解动作时的卡顿。
  const dpr = Math.min(window.devicePixelRatio || 1, AVATAR_CANVAS_DPR_CAP);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  return { width, height };
}

function syncUnityCanvasBackingSize(source: HTMLCanvasElement) {
  const { width, height } = resolveCanvasBackingSize(source);
  if (source.width !== width) source.width = width;
  if (source.height !== height) source.height = height;
}

function syncCompositeSize(source: HTMLCanvasElement, target: HTMLCanvasElement) {
  const { width, height } = resolveCanvasBackingSize(source);
  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
  }
}

function drawTransparentAvatarFrame(source: HTMLCanvasElement, target: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  syncUnityCanvasBackingSize(source);
  syncCompositeSize(source, target);
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0, target.width, target.height);

  const frame = context.getImageData(0, 0, target.width, target.height);
  const data = frame.data;
  let visiblePixels = 0;
  let chromaMattePixels = 0;

  const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

  // Unity WebGL 透明背景在部分浏览器里会被混成背景色。
  // 加载 Logo 阶段是黑底白字；正式场景是绿色键控背景。
  // 所以这里同时返回 chromaMattePixels，外层必须确认“绿色键控背景已出现”才允许显示。
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];

    const maxRB = Math.max(r, b);
    const greenExcess = g - maxRB;
    const isOldBlackMatte = r <= 6 && g <= 6 && b <= 6;
    const isCoreGreenMatte = g >= 150 && greenExcess >= 76 && r <= 132 && b <= 132 && g > r * 1.52 && g > b * 1.52;
    const isSoftGreenEdge = g >= 96 && greenExcess >= 34 && g > r * 1.28 && g > b * 1.28;
    const isGreenMatte = isCoreGreenMatte || isSoftGreenEdge;

    if (isGreenMatte) chromaMattePixels += 1;

    if (isOldBlackMatte || isCoreGreenMatte) {
      data[index + 3] = 0;
      continue;
    }

    if (isSoftGreenEdge) {
      const matteStrength = clampUnit((greenExcess - 30) / 86);
      const edgeAlpha = clampUnit(1 - matteStrength * 0.76);

      // Keep edge cleanup local to the green channel. Pulling these pixels
      // toward white made skin-adjacent frames look like a face flash.
      data[index + 1] = clampByte(g - Math.min(g - maxRB, 64) * matteStrength);
      data[index + 3] = Math.round(a * edgeAlpha);

      if (data[index + 3] > 8) visiblePixels += 1;
      continue;
    }

    if (a > 8) visiblePixels += 1;
  }

  context.putImageData(frame, 0, 0);
  return {
    visiblePixels,
    chromaMattePixels,
    hasSceneChroma: chromaMattePixels > target.width * target.height * 0.18,
  };
}

export default function UnityWebGLGuideStage({
  status,
  audioState,
  emotionCue = 'idle',
  speechText = '',
  speechNonce = 0,
  fallbackImageUrl = avatar151Guide.fallbackImageUrl,
  showLoadingHint = true,
  active = true,
  activationKey = 0,
  className = '',
  onInteract,
  runtimeConfig = avatar151Guide.unityWebgl,
  ariaLabel = '151 Unity WebGL AI guide',
  onLoadFailure,
  onPhaseChange,
  onProgressChange,
}: UnityWebGLGuideStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const unityRef = useRef<UnityInstance | null>(null);
  const stateRef = useRef<UnityAvatarState>('idle');
  const welcomeResetTimerRef = useRef<number | undefined>(undefined);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [progress, setProgress] = useState(0);
  const desiredState = active ? resolveAvatarState(status, audioState, emotionCue) : 'idle';
  const desiredEmotionCue = active ? emotionCue : 'idle';
  const latestDesiredStateRef = useRef<UnityAvatarState>(desiredState);
  const latestDesiredEmotionCueRef = useRef<GuideEmotionCue>(desiredEmotionCue);
  latestDesiredStateRef.current = desiredState;
  latestDesiredEmotionCueRef.current = desiredEmotionCue;

  const clearWelcomeReset = () => {
    if (welcomeResetTimerRef.current === undefined) return;
    window.clearTimeout(welcomeResetTimerRef.current);
    welcomeResetTimerRef.current = undefined;
  };

  const playWelcomeThenSettle = () => {
    clearWelcomeReset();
    sendEmotionCue('welcome');
    sendState('welcome');
    welcomeResetTimerRef.current = window.setTimeout(() => {
      welcomeResetTimerRef.current = undefined;
      if (stateRef.current !== 'welcome') return;
      sendEmotionCue(latestDesiredEmotionCueRef.current);
      sendState(latestDesiredStateRef.current);
    }, WELCOME_SETTLE_MS);
  };

  useEffect(() => () => clearWelcomeReset(), []);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [onPhaseChange, phase]);

  useEffect(() => {
    onProgressChange?.(progress);
  }, [onProgressChange, progress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let frame = 0;
    let resizeObserver: ResizeObserver | undefined;
    const syncSize = () => {
      frame = 0;
      syncUnityCanvasBackingSize(canvas);
    };
    const scheduleSync = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncSize);
    };

    syncSize();
    window.addEventListener('resize', scheduleSync);
    document.addEventListener('fullscreenchange', scheduleSync);
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(scheduleSync);
      resizeObserver.observe(canvas);
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleSync);
      document.removeEventListener('fullscreenchange', scheduleSync);
      resizeObserver?.disconnect();
    };
  }, []);

  const sendState = (state: UnityAvatarState) => {
    stateRef.current = state;
    unityRef.current?.SendMessage(runtimeConfig.bridgeObjectName, 'SetGuideState', state);
  };

  const sendSpeech = (text: string) => {
    unityRef.current?.SendMessage(runtimeConfig.bridgeObjectName, 'SetSpeechText', text ?? '');
  };

  const sendEmotionCue = (cue: GuideEmotionCue = 'idle') => {
    unityRef.current?.SendMessage(runtimeConfig.bridgeObjectName, 'SetEmotionCue', cue);
  };

  const sendExpressionCue = (cue: GuideEmotionCue = 'idle') => {
    unityRef.current?.SendMessage(runtimeConfig.bridgeObjectName, 'SetExpressionCue', cue);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const compositeCanvas = compositeCanvasRef.current;
    if (!canvas || !compositeCanvas) return undefined;

    let disposed = false;
    let fallbackTimer: number | undefined;
    let compositeFrame: number | undefined;
    let compositeFailureCount = 0;
    let hasRevealed = false;
    let failureReported = false;

    const reportFailure = () => {
      if (disposed || failureReported) return;
      failureReported = true;
      setPhase('fallback');
      onLoadFailure?.();
    };

    const startCompositeLoop = () => {
      const context = compositeCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!context) {
        reportFailure();
        return;
      }

      const tick = () => {
        if (disposed) return;
        try {
          const frameMetrics = drawTransparentAvatarFrame(canvas, compositeCanvas, context);
          compositeFailureCount = 0;
          if (!hasRevealed && frameMetrics.hasSceneChroma && frameMetrics.visiblePixels > AVATAR_VISIBLE_PIXEL_THRESHOLD) {
            hasRevealed = true;
            setPhase('ready');
          }
        } catch (error) {
          compositeFailureCount += 1;
          if (compositeFailureCount === 1) {
            console.warn('[Avatar151] Failed to composite transparent Unity frame.', error);
          }
          if (compositeFailureCount > 12) {
            reportFailure();
            return;
          }
        }
        compositeFrame = window.requestAnimationFrame(tick);
      };

      compositeFrame = window.requestAnimationFrame(tick);
    };

    const boot = async () => {
      try {
        await loadUnityLoader(runtimeConfig.loaderUrl, runtimeConfig.loadTimeoutMs ?? 10_000);
        if (disposed || !window.createUnityInstance) return;
        syncUnityCanvasBackingSize(canvas);
        const instance = await window.createUnityInstance(
          canvas,
          {
            dataUrl: runtimeConfig.dataUrl,
            frameworkUrl: runtimeConfig.frameworkUrl,
            codeUrl: runtimeConfig.codeUrl,
            streamingAssetsUrl: runtimeConfig.streamingAssetsUrl,
            companyName: 'A5',
            productName: 'LingShan Avatar151 Guide',
            productVersion: '1.0.0',
            matchWebGLToCanvasSize: false,
            devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
            webglContextAttributes: {
              alpha: true,
              premultipliedAlpha: false,
              preserveDrawingBuffer: true,
            },
          },
          (nextProgress) => {
            if (!disposed) setProgress(nextProgress);
          },
        );
        if (disposed) {
          void instance.Quit?.();
          return;
        }
        unityRef.current = instance;
        sendState(active ? resolveAvatarState(status, audioState, emotionCue) : 'idle');
        sendEmotionCue(active ? emotionCue : 'idle');
        sendSpeech(active ? speechText : '');
        startCompositeLoop();
        fallbackTimer = window.setTimeout(() => {
          if (!disposed && !hasRevealed) {
            reportFailure();
          }
        }, 15000);
        window.__avatar151Debug = {
          playMotion: (group) => sendState(group),
          speakText: (text) => sendSpeech(text),
          setEmotionCue: (cue) => sendEmotionCue(cue),
          setExpressionCue: (cue) => sendExpressionCue(cue),
          getCurrentState: () => ({ phase: phase === 'ready' ? 'ready' : 'loading', state: stateRef.current, progress }),
        };
      } catch (error) {
        console.warn('[Avatar151] Unity WebGL unavailable, using static fallback.', error);
        reportFailure();
      }
    };

    void boot();

    return () => {
      disposed = true;
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      if (compositeFrame !== undefined) window.cancelAnimationFrame(compositeFrame);
      window.__avatar151Debug = undefined;
      const unity = unityRef.current;
      unityRef.current = null;
      if (unity?.Quit) void unity.Quit();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'ready') return;
    if (!active) {
      clearWelcomeReset();
      sendEmotionCue('idle');
      sendSpeech('');
      sendState('idle');
      return;
    }
    sendEmotionCue(desiredEmotionCue);
    sendState(desiredState);
  }, [active, audioState, emotionCue, phase, status]);

  useEffect(() => {
    if (phase !== 'ready' || !active) return;
    sendSpeech(speechText);
  }, [active, phase, speechNonce, speechText]);

  useEffect(() => {
    if (phase !== 'ready' || !active) return;
    if (desiredState !== 'idle') return;
    playWelcomeThenSettle();
  }, [activationKey, active, phase]);

  const handlePointerDown = () => {
    if (!active) return;
    onInteract?.();
    if (phase === 'ready') {
      playWelcomeThenSettle();
    }
  };

  return (
    <div
      className={`unity-avatar-stage unity-avatar-stage-${phase} ${
        active ? 'unity-avatar-stage-active' : 'unity-avatar-stage-inactive'
      } ${className}`.trim()}
      data-testid="avatar151-stage"
      onPointerDown={handlePointerDown}
      data-progress={Math.round(progress * 100)}
    >
      {phase !== 'fallback' ? (
        <>
          {phase === 'loading' && showLoadingHint ? (
            <div
              className="unity-avatar-loading-fallback"
              aria-label="灵诗音数字人加载中"
            >
              <img
                src={fallbackImageUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            </div>
          ) : null}
          <canvas ref={canvasRef} className="unity-avatar-canvas unity-avatar-canvas-source" aria-hidden="true" />
          <canvas
            ref={compositeCanvasRef}
            className="unity-avatar-composite-canvas"
            aria-label={ariaLabel}
          />
        </>
      ) : (
        <div className="unity-avatar-static-fallback" aria-label="151 AI guide static fallback">
          <img src={fallbackImageUrl} alt="灵诗音 AI 数字人导游" draggable={false} />
          <span>数字人加载失败，当前使用静态兜底。</span>
        </div>
      )}
    </div>
  );
}
