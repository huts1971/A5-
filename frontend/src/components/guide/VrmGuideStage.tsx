import { useEffect, useRef, useState } from 'react';
import { Avatar151Renderer } from '../../avatar151/avatar151Renderer';
import type { Avatar151DebugApi } from '../../avatar151/avatar151Renderer';
import type { GuideEmotionCue } from '../../config/avatar151Guide';
import type { GuideStatus } from '../../types/scenic';
import type { AvatarAudioState } from './AvatarGuide';

declare global {
  interface Window {
    __avatar151VrmDebug?: Avatar151DebugApi;
  }
}

export interface VrmGuideStageProps {
  status: GuideStatus;
  audioState: AvatarAudioState;
  emotionCue?: GuideEmotionCue;
  modelUrl?: string;
  speechText?: string;
  speechNonce?: number;
  showLoadingHint?: boolean;
  onInteract?: () => void;
  onError?: (message: string) => void;
}

export default function VrmGuideStage({
  status,
  audioState,
  emotionCue = 'idle',
  modelUrl,
  speechText = '',
  speechNonce = 0,
  showLoadingHint = true,
  onInteract,
  onError,
}: VrmGuideStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<Avatar151Renderer | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tapFeedback, setTapFeedback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;
    const renderer = new Avatar151Renderer({
      canvas,
      onReady: () => {
        if (cancelled) return;
        setPhase('ready');
        renderer.setGuideState(status, audioState);
        renderer.setEmotionCue(emotionCue);
        renderer.speakText(speechText);
        window.__avatar151VrmDebug = renderer.getDebugApi();
      },
      onError: (message) => {
        if (cancelled) return;
        setPhase('error');
        onError?.(message);
      },
    });
    rendererRef.current = renderer;
    void renderer.initialize(modelUrl);
    return () => {
      cancelled = true;
      window.__avatar151VrmDebug = undefined;
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [modelUrl]);

  useEffect(() => {
    rendererRef.current?.setGuideState(status, audioState);
  }, [audioState, status]);

  useEffect(() => {
    rendererRef.current?.setEmotionCue(emotionCue);
  }, [emotionCue]);

  useEffect(() => {
    rendererRef.current?.speakText(speechText);
  }, [speechNonce, speechText]);

  const handlePointerDown = () => {
    onInteract?.();
    rendererRef.current?.setEmotionCue('wake');
    setTapFeedback(true);
    window.setTimeout(() => setTapFeedback(false), 700);
  };

  return (
    <div
      className={`vrm-stage vrm-stage-${phase}${tapFeedback ? ' is-tapped' : ''}`}
      data-testid="avatar151-stage"
      onPointerDown={handlePointerDown}
    >
      <canvas ref={canvasRef} className="vrm-canvas" aria-label="151 VRM AI guide" />
      {phase === 'loading' && showLoadingHint ? <div className="vrm-stage-hint">数字人加载中</div> : null}
    </div>
  );
}
