import { Alert, Badge, Skeleton, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { avatar151Guide } from '../../config/avatar151Guide';
import type { GuideEmotionCue, GuideStageMode } from '../../config/avatar151Guide';
import type { GuideStatus } from '../../types/scenic';
import { useUnityWebGLGuideTarget } from './UnityWebGLGuideRuntime';

export type AvatarAudioState = 'idle' | 'pending' | 'ready' | 'playing' | 'failed';
export type AvatarGuideVariant = 'compact' | 'stage' | 'pet';
export type AvatarGuidePresentation = 'panel' | 'bare';

export interface AvatarGuideProps {
  status: GuideStatus;
  loading?: boolean;
  error?: string;
  title?: string;
  detail?: string;
  profileText?: string;
  audioState?: AvatarAudioState;
  emotionCue?: GuideEmotionCue;
  stageMode?: GuideStageMode;
  variant?: AvatarGuideVariant;
  modelUrl?: string;
  fallbackImageUrl?: string;
  enableAvatar?: boolean;
  suppressInitialFallbackImage?: boolean;
  presentation?: AvatarGuidePresentation;
  showStatus?: boolean;
  showStateBadge?: boolean;
  speechText?: string;
  speechNonce?: number;
}

type AvatarVisualState = 'idle' | 'thinking' | 'speaking';

const statusText: Record<GuideStatus, { label: string; detail: string; badge: 'default' | 'processing' | 'success' }> = {
  idle: {
    label: '待命中',
    detail: '可以询问景点故事、路线建议和游览提醒。',
    badge: 'default',
  },
  thinking: {
    label: '正在思考',
    detail: '正在结合景区资料为你组织回答。',
    badge: 'processing',
  },
  speaking: {
    label: '正在讲解',
    detail: '我正在为你讲解，语音也可以同步播放。',
    badge: 'success',
  },
};

const audioStateText: Record<AvatarAudioState, { label: string; color: 'default' | 'processing' | 'success' | 'warning' }> = {
  idle: { label: '语音待命', color: 'default' },
  pending: { label: '语音生成中', color: 'processing' },
  ready: { label: '语音可播放', color: 'success' },
  playing: { label: '正在播报', color: 'success' },
  failed: { label: '语音兜底', color: 'warning' },
};

const stateBadgeText: Record<AvatarVisualState, string> = {
  idle: '空闲中',
  thinking: '思考中',
  speaking: '讲解中',
};

const defaultModelUrl = avatar151Guide.modelUrl;
const defaultFallbackImageUrl = avatar151Guide.fallbackImageUrl;

export default function AvatarGuide({
  status,
  loading = false,
  error,
  title,
  detail,
  profileText,
  audioState = 'idle',
  emotionCue,
  stageMode = 'guide',
  variant = 'compact',
  modelUrl = defaultModelUrl,
  fallbackImageUrl = defaultFallbackImageUrl,
  enableAvatar = true,
  suppressInitialFallbackImage = false,
  presentation = 'panel',
  showStatus = true,
  showStateBadge = false,
  speechText = '',
  speechNonce = 0,
}: AvatarGuideProps) {
  const isBarePresentation = presentation === 'bare';
  const current = statusText[status];
  const audio = audioStateText[audioState];
  const statusDetail = detail ?? current.detail;
  const [imageFailed, setImageFailed] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarCanLoad, setAvatarCanLoad] = useState(stageMode === 'guide');
  const [sleeping, setSleeping] = useState(false);
  const [ambientCue, setAmbientCue] = useState<GuideEmotionCue>('idle');
  const lastActivityAtRef = useRef(Date.now());
  const usesUnityAvatar = variant === 'stage' || variant === 'pet';
  const canAutoSleep = variant === 'stage';
  const wantsUnityAvatar = usesUnityAvatar && enableAvatar && !avatarError && avatarCanLoad;
  const shouldSuppressImage =
    suppressInitialFallbackImage && usesUnityAvatar && enableAvatar && !avatarError && !avatarCanLoad;
  const visualState: AvatarVisualState =
    status === 'speaking' || audioState === 'playing' ? 'speaking' : status === 'thinking' ? 'thinking' : 'idle';
  const explicitEmotionCue = emotionCue && emotionCue !== 'idle' ? emotionCue : undefined;
  const resolvedEmotionCue = useMemo<GuideEmotionCue>(() => {
    if (
      sleeping &&
      canAutoSleep &&
      status === 'idle' &&
      audioState !== 'playing' &&
      audioState !== 'pending' &&
      !explicitEmotionCue
    ) return 'sleep';
    if (explicitEmotionCue) return explicitEmotionCue;
    if (ambientCue !== 'idle') return ambientCue;
    if (status === 'thinking') return 'thinking';
    if (status === 'speaking' || audioState === 'playing') return 'speaking';
    return 'idle';
  }, [ambientCue, audioState, canAutoSleep, explicitEmotionCue, sleeping, status]);

  useEffect(() => {
    if (!usesUnityAvatar || !enableAvatar) return undefined;
    setAvatarCanLoad(false);
    const delay = avatar151Guide.stages[stageMode].avatarDelayMs;
    const timer = window.setTimeout(() => setAvatarCanLoad(true), delay);
    return () => window.clearTimeout(timer);
  }, [enableAvatar, stageMode, usesUnityAvatar]);

  const registerActivity = () => {
    lastActivityAtRef.current = Date.now();
    if (sleeping) {
      setSleeping(false);
      setAmbientCue('wake');
      window.setTimeout(() => setAmbientCue('idle'), 2200);
    }
  };

  const unityTarget = useUnityWebGLGuideTarget({
    enabled: wantsUnityAvatar,
    status,
    audioState,
    emotionCue: resolvedEmotionCue,
    fallbackImageUrl,
    speechText,
    speechNonce,
    displayVariant: variant === 'pet' ? 'pet' : 'stage',
    onInteract: registerActivity,
  });
  const shouldUseAvatar = wantsUnityAvatar && unityTarget.available;

  useEffect(() => {
    registerActivity();
    if (status !== 'idle' || audioState === 'playing' || audioState === 'pending' || explicitEmotionCue) {
      setSleeping(false);
    }
  }, [audioState, explicitEmotionCue, status]);

  useEffect(() => {
    if (!canAutoSleep) return undefined;
    const onActivity = () => registerActivity();
    window.addEventListener('pointermove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    const timer = window.setInterval(() => {
      if (status !== 'idle' || audioState === 'playing' || audioState === 'pending') return;
      if (Date.now() - lastActivityAtRef.current >= avatar151Guide.idleTimeoutMs) {
        setSleeping(true);
      }
    }, 2000);
    return () => {
      window.removeEventListener('pointermove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.clearInterval(timer);
    };
  }, [audioState, canAutoSleep, sleeping, status]);

  if (loading) {
    return (
      <div className={`avatar-guide avatar-guide-${variant} ${isBarePresentation ? 'avatar-guide--bare' : ''}`}>
        <Skeleton.Image active className="avatar-skeleton" />
        {showStatus ? (
          <div className="avatar-status">
            <Skeleton active paragraph={{ rows: 2 }} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`avatar-guide avatar-guide-${variant} avatar-guide-${stageMode} is-${status} audio-${audioState} ${
        isBarePresentation ? 'avatar-guide--bare' : ''
      }`}
    >
      <div
        ref={unityTarget.targetRef}
        className={`avatar-stage-shell ${
          shouldUseAvatar ? 'has-vrm' : shouldSuppressImage ? 'is-awaiting-vrm' : imageFailed ? 'has-fallback' : 'has-image'
        }`}
        aria-label="灵诗音 AI 数字人导游"
      >
        {!isBarePresentation ? (
          <>
            <div className="avatar-aura" />
            <div className="avatar-scan-ring" />
            <div className="avatar-light-dots">
              <span />
              <span />
              <span />
            </div>
          </>
        ) : null}

        {showStateBadge ? (
          <div
            className={`avatar-state-pill avatar-state-pill--${visualState}`}
            aria-label={`数字人状态：${stateBadgeText[visualState]}`}
            aria-live="polite"
          >
            <span className="avatar-state-pill__light" aria-hidden="true" />
            <span className="avatar-state-pill__text">{stateBadgeText[visualState]}</span>
          </div>
        ) : null}

        {shouldUseAvatar ? null : shouldSuppressImage ? null : (
          <>
            <img
              className="avatar-character"
              src={fallbackImageUrl}
              alt="灵诗音 AI 数字人导游"
              draggable={false}
              onError={() => setImageFailed(true)}
            />
            <div className="avatar-css-fallback" aria-hidden="true">
              <div className="avatar-fallback-hair" />
              <div className="avatar-fallback-face">
                <span className="avatar-fallback-mouth" />
              </div>
              <div className="avatar-fallback-body" />
            </div>
          </>
        )}

        {!isBarePresentation ? (
          <div className="avatar-speech-wave" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : null}
      </div>

      {showStatus ? (
        <div className="avatar-status">
          {error ? (
            <Alert type="warning" showIcon message="数字人状态异常" description={error} />
          ) : (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space size={8} wrap>
                <Badge status={current.badge} text={title ?? current.label} />
                <Tag color={audio.color}>{audio.label}</Tag>
                {avatarError ? <Tag color="orange">VRM 兜底</Tag> : null}
              </Space>
              {statusDetail ? (
                <Typography.Text type="secondary">
                  {status === 'thinking' ? <Spin size="small" style={{ marginRight: 8 }} /> : null}
                  {statusDetail}
                </Typography.Text>
              ) : null}
              {avatarError ? (
                <Typography.Text
                  type="secondary"
                  className="avatar-vrm-error"
                  title={avatarError}
                  data-vrm-error={avatarError}
                >
                  VRM 数字人资源未就绪，已使用静态头像兜底。
                </Typography.Text>
              ) : null}
              {profileText ? (
                <Typography.Text className="avatar-profile-text">{profileText}</Typography.Text>
              ) : null}
            </Space>
          )}
        </div>
      ) : null}
    </div>
  );
}
