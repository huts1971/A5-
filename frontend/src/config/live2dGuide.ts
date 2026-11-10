export type GuideEmotionCue =
  | 'idle'
  | 'thinking'
  | 'speaking'
  | 'success'
  | 'fallback'
  | 'tap'
  | 'sleep'
  | 'wake';

export type GuideStageMode = 'home' | 'guide';

export const haruGuide = {
  modelUrl: '/live2d/models/Haru/Haru.model3.json',
  fallbackImageUrl: '/live2d/models/Haru/preview.png',
  idleTimeoutMs: 20_000,
  stages: {
    home: {
      live2dDelayMs: 900,
    },
    guide: {
      live2dDelayMs: 0,
    },
  },
  motions: {
    idle: 'Idle',
    thinking: 'Thinking',
    speaking: 'Speaking',
    success: 'Success',
    fallback: 'Fallback',
    wake: 'Success',
    sleep: 'Sleep',
    tap: 'Tap',
  },
} as const;
