import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { GuideEmotionCue } from '../../config/live2dGuide';
import type { GuideStatus } from '../../types/scenic';
import { OfficialCubismRenderer } from '../../live2d/officialCubismRenderer';
import type { AvatarAudioState } from './AvatarGuide';

declare global {
  interface Window {
    __live2dGuideDebug?: {
      previewMotion: (groupName: string, index?: number, durationMs?: number) => boolean;
      getMotionGroupSize: (groupName: string) => number;
    };
  }
}

export interface Live2DGuideStageProps {
  status: GuideStatus;
  audioState: AvatarAudioState;
  emotionCue?: GuideEmotionCue;
  modelUrl: string;
  coreScriptUrl?: string;
  showLoadingHint?: boolean;
  onReady?: () => void;
  onError?: (message: string) => void;
  onInteract?: () => void;
}

export default function Live2DGuideStage({
  status,
  audioState,
  emotionCue,
  modelUrl,
  coreScriptUrl = '/live2d/core/live2dcubismcore.min.js',
  showLoadingHint = true,
  onReady,
  onError,
  onInteract,
}: Live2DGuideStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<OfficialCubismRenderer | null>(null);
  const tapTimerRef = useRef<number | undefined>(undefined);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [tapFeedback, setTapFeedback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let cancelled = false;
    setPhase('loading');
    const renderer = new OfficialCubismRenderer({ canvas, modelUrl, coreScriptUrl });
    rendererRef.current = renderer;

    void renderer
      .initialize()
      .then(() => {
        if (cancelled) return;
        renderer.setGuideState(status, audioState);
        renderer.setEmotionCue(emotionCue);
        window.__live2dGuideDebug = {
          previewMotion: (groupName, index, durationMs) => renderer.previewMotion(groupName, index, durationMs),
          getMotionGroupSize: (groupName) => renderer.getMotionGroupSize(groupName),
        };
        setPhase('ready');
        onReady?.();
      })
      .catch((error: Error) => {
        if (cancelled) return;
        console.warn('[Live2DGuideStage] fallback to static avatar:', error.stack ?? error.message);
        setPhase('failed');
        onError?.(error.message);
      });

    return () => {
      cancelled = true;
      if (tapTimerRef.current) {
        window.clearTimeout(tapTimerRef.current);
      }
      renderer.destroy();
      if (rendererRef.current === renderer) {
        window.__live2dGuideDebug = undefined;
      }
      rendererRef.current = null;
    };
  }, [modelUrl, coreScriptUrl]);

  useEffect(() => {
    rendererRef.current?.setGuideState(status, audioState);
  }, [status, audioState]);

  useEffect(() => {
    rendererRef.current?.setEmotionCue(emotionCue);
  }, [emotionCue]);

  const updatePointerTarget = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    rendererRef.current?.setPointerTarget(x, y);
    onInteract?.();
  };

  const resetPointerTarget = () => {
    rendererRef.current?.setPointerTarget(0, 0);
  };

  const triggerTap = () => {
    rendererRef.current?.setEmotionCue('tap');
    setTapFeedback(true);
    if (tapTimerRef.current) {
      window.clearTimeout(tapTimerRef.current);
    }
    tapTimerRef.current = window.setTimeout(() => setTapFeedback(false), 1550);
    onInteract?.();
  };

  return (
    <div
      className={`live2d-stage live2d-stage-${phase}${tapFeedback ? ' is-tapped' : ''}`}
      onPointerMove={updatePointerTarget}
      onPointerLeave={resetPointerTarget}
      onPointerDown={triggerTap}
    >
      <canvas ref={canvasRef} className="live2d-canvas" aria-label="Live2D AI guide" />
      {phase === 'loading' && showLoadingHint ? <div className="live2d-stage-hint">Live2D loading</div> : null}
    </div>
  );
}
