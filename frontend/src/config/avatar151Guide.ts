export type GuideStageMode = 'home' | 'guide';

export type GuideEmotionCue =
  | 'idle'
  | 'thinking'
  | 'speaking'
  | 'success'
  | 'fallback'
  | 'wake'
  | 'sleep'
  | 'welcome'
  | 'smile'
  | 'closed_smile'
  | 'blush'
  | 'tired'
  | 'tired_eye'
  | 'closed_eye';

export type Avatar151MotionGroup = 'welcome' | 'idle' | 'thinking' | 'speaking' | 'fallback';

export interface Avatar151MotionAsset {
  name: string;
  url: string;
  label: string;
  loop?: boolean;
}

export interface UnityWebGLRuntimeConfig {
  loaderUrl: string;
  dataUrl: string;
  frameworkUrl: string;
  codeUrl: string;
  streamingAssetsUrl: string;
  bridgeObjectName: string;
  loadTimeoutMs?: number;
}

const motionBase = '/avatar/uketsukejou151/motions';
const unityWebglVersion = '20260702-avatar151-webgl-v25-no-ear-no-hat-runtime';
const withUnityVersion = (url: string) => `${url}?v=${unityWebglVersion}`;

export const avatar151Guide = {
  modelUrl: '/avatar/uketsukejou151/model/uketsukejou_1.0.vrm',
  fallbackImageUrl: '/avatar/uketsukejou151/avatar-151-chat.svg',
  chatAvatarUrl: '/avatar/uketsukejou151/avatar-151-head.png',
  bakedMotionUrl: '/avatar/uketsukejou151/baked/avatar151-baked-motions.json',
  unityWebgl: {
    loaderUrl: withUnityVersion('/avatar/uketsukejou151/unity-webgl/Build/avatar151-guide.loader.js'),
    dataUrl: withUnityVersion('/avatar/uketsukejou151/unity-webgl/Build/avatar151-guide.data'),
    frameworkUrl: withUnityVersion('/avatar/uketsukejou151/unity-webgl/Build/avatar151-guide.framework.js'),
    codeUrl: withUnityVersion('/avatar/uketsukejou151/unity-webgl/Build/avatar151-guide.wasm'),
    streamingAssetsUrl: '/avatar/uketsukejou151/unity-webgl/StreamingAssets',
    bridgeObjectName: 'Avatar151Bridge',
    loadTimeoutMs: 10_000,
  },
  idleTimeoutMs: 20_000,
  stages: {
    home: {
      avatarDelayMs: 900,
    },
    guide: {
      avatarDelayMs: 0,
    },
  } satisfies Record<GuideStageMode, { avatarDelayMs: number }>,
  motions: {
    welcome: [
      {
        name: 'welcome_wave_08',
        url: `${motionBase}/welcome_wave_08.fbx`,
        label: 'welcome / wave',
        loop: false,
      },
    ],
    idle: [
      {
        name: 'idle_or_think_19',
        url: `${motionBase}/idle_head_nod_19.fbx`,
        label: 'idle / gentle nod',
        loop: true,
      },
      {
        name: 'idle_neutral_04',
        url: `${motionBase}/idle_neutral_04.fbx`,
        label: 'idle / natural breathing',
        loop: true,
      },
    ],
    thinking: [
      {
        name: 'think_looking_14',
        url: `${motionBase}/think_looking_14.fbx`,
        label: 'thinking / looking aside',
        loop: true,
      },
    ],
    speaking: [
      {
        name: 'talk_basic_14',
        url: `${motionBase}/talk_basic_14.fbx`,
        label: 'speaking / basic gesture',
        loop: true,
      },
      {
        name: 'talk_basic_15',
        url: `${motionBase}/talk_basic_15.fbx`,
        label: 'speaking / explain gesture',
        loop: true,
      },
      {
        name: 'talk_confirm_32',
        url: `${motionBase}/talk_confirm_32.fbx`,
        label: 'speaking / confirm nod',
        loop: true,
      },
      {
        name: 'talk_waist_48',
        url: `${motionBase}/talk_waist_48.fbx`,
        label: 'speaking / waist gesture',
        loop: true,
      },
    ],
    fallback: [
      {
        name: 'think_looking_14',
        url: `${motionBase}/think_looking_14.fbx`,
        label: 'fallback / looking aside',
        loop: true,
      },
    ],
  } satisfies Record<Avatar151MotionGroup, Avatar151MotionAsset[]>,
};



