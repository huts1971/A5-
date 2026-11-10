// @ts-nocheck
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { avatar151Guide, type Avatar151MotionGroup, type GuideEmotionCue } from '../config/avatar151Guide';
import type { AvatarAudioState } from '../components/guide/AvatarGuide';
import type { GuideStatus } from '../types/scenic';

type ExpressionTargets = Record<string, number>;
type BoneMap = Record<string, THREE.Object3D | undefined>;

type BakedFrame = {
  t: number;
  q: number[][];
};

type BakedClip = {
  name: string;
  group: Avatar151MotionGroup;
  loop: boolean;
  duration: number;
  source?: string;
  frames: BakedFrame[];
};

type BakedMotionData = {
  schema: string;
  fps: number;
  bones: string[];
  baseQ?: number[][];
  clips: BakedClip[];
};

type SampledPose = {
  q: THREE.Quaternion[];
};

const expressionNames = ['blink', 'happy', 'relaxed', 'surprised', 'sad', 'angry', 'aa', 'ih', 'ou', 'ee', 'oh'];
const mouthNames = ['aa', 'ih', 'ou', 'ee', 'oh'];
const proceduralMotionName: Record<Avatar151MotionGroup, string> = {
  welcome: 'procedural_welcome_wave',
  idle: 'procedural_idle_breathing',
  thinking: 'procedural_thinking',
  speaking: 'procedural_talk_explain',
  fallback: 'procedural_soft_fallback',
};

export interface Avatar151DebugApi {
  playMotion: (group: Avatar151MotionGroup, index?: number) => void;
  speakText: (text: string) => void;
  setExpression: (name: string, value: number) => void;
  getCurrentState: () => { group: string; motion: string; phase: string; loadedGroups: string[] };
}

export interface Avatar151RendererOptions {
  canvas: HTMLCanvasElement;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export class Avatar151Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly onReady?: () => void;
  private readonly onError?: (message: string) => void;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  private readonly clock = new THREE.Clock();
  private readonly renderer: THREE.WebGLRenderer;
  private frameId = 0;
  private resizeObserver?: ResizeObserver;
  private disposed = false;
  private vrm?: VRM;
  private bones: BoneMap = {};
  private rawBones: BoneMap = {};
  private baseQuaternions = new Map<THREE.Object3D, THREE.Quaternion>();
  private currentGroup: Avatar151MotionGroup = 'idle';
  private currentMotionName = proceduralMotionName.idle;
  private expressionTargets: ExpressionTargets = {};
  private expressionValues: ExpressionTargets = {};
  private availableExpressions = new Set<string>();
  private speechText = '';
  private mouthElapsed = 0;
  private blinkElapsed = 0;
  private nextBlinkIn = 2.2 + Math.random() * 2.8;
  private blinking = false;
  private desiredStatus: GuideStatus = 'idle';
  private desiredAudioState: AvatarAudioState = 'idle';
  private desiredEmotionCue: GuideEmotionCue = 'welcome';
  private ready = false;
  private poseElapsed = 0;

  private baked?: BakedMotionData;
  private bakedClipsByGroup = new Map<Avatar151MotionGroup, BakedClip[]>();
  private bakedBoneNodes: Array<THREE.Object3D | undefined> = [];
  private bakedUnityBaseQuaternions: THREE.Quaternion[] = [];
  private activeClip?: BakedClip;
  private activeClipTime = 0;
  private transitionFrom?: SampledPose;
  private transitionElapsed = 0;
  private transitionDuration = 0.55;
  private lastPose?: SampledPose;
  private groupPickCursor: Record<Avatar151MotionGroup, number> = {
    welcome: 0,
    idle: 0,
    thinking: 0,
    speaking: 0,
    fallback: 0,
  };

  private smoothedArmTargets = {
    leftUpper: new THREE.Vector3(-0.22, -0.95, 0.1).normalize(),
    leftLower: new THREE.Vector3(-0.08, -0.98, 0.04).normalize(),
    rightUpper: new THREE.Vector3(0.22, -0.95, 0.1).normalize(),
    rightLower: new THREE.Vector3(0.08, -0.98, 0.04).normalize(),
  };

  constructor(options: Avatar151RendererOptions) {
    this.canvas = options.canvas;
    this.onReady = options.onReady;
    this.onError = options.onError;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.shadowMap.enabled = true;
    this.camera.position.set(0, 1.06, 3.75);
    this.camera.lookAt(0, 0.84, 0);
    this.setupLighting();
    expressionNames.forEach((name) => {
      this.expressionTargets[name] = 0;
      this.expressionValues[name] = 0;
    });
  }

  async initialize(modelUrl = avatar151Guide.modelUrl) {
    try {
      this.observeResize();
      await this.loadModel(modelUrl);
      await this.loadBakedMotions();
      if (this.disposed) return;
      this.ready = true;
      this.onReady?.();
      this.playMotionGroup('welcome');
      this.startLoop();
      window.setTimeout(() => {
        if (!this.disposed && this.currentGroup === 'welcome') this.applyDesiredState();
      }, 3200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onError?.(message);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.frameId) window.cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose?.();
    });
  }

  setGuideState(status: GuideStatus, audioState: AvatarAudioState) {
    this.desiredStatus = status;
    this.desiredAudioState = audioState;
    this.applyDesiredState();
  }

  setEmotionCue(cue: GuideEmotionCue = 'idle') {
    this.desiredEmotionCue = cue;
    this.updateExpressionTargets();
  }

  speakText(text: string) {
    this.speechText = text.trim();
    this.mouthElapsed = 0;
  }

  getDebugApi(): Avatar151DebugApi {
    return {
      playMotion: (group, index) => this.playMotionGroup(group, index),
      speakText: (text) => this.speakText(text),
      setExpression: (name, value) => {
        this.expressionTargets[name] = THREE.MathUtils.clamp(value, 0, 1);
      },
      getCurrentState: () => ({
        group: this.currentGroup,
        motion: this.currentMotionName,
        phase: this.ready ? 'ready' : 'loading',
        loadedGroups: this.baked ? Array.from(this.bakedClipsByGroup.keys()) : ['procedural'],
      }),
    };
  }

  private setupLighting() {
    const ambient = new THREE.HemisphereLight(0xfff1df, 0x35415a, 0.68);
    const key = new THREE.DirectionalLight(0xffe0bf, 1.15);
    key.position.set(1.25, 2.25, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const fill = new THREE.DirectionalLight(0xd7eaff, 0.36);
    fill.position.set(-2.0, 1.35, 1.1);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(-0.4, 1.9, -2.2);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.68, 48), new THREE.ShadowMaterial({ opacity: 0.16 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    floor.receiveShadow = true;
    this.scene.add(ambient, key, fill, rim, floor);
  }

  private observeResize() {
    const resize = () => {
      const parent = this.canvas.parentElement;
      const width = Math.max(320, parent?.clientWidth || this.canvas.clientWidth || 640);
      const height = Math.max(420, parent?.clientHeight || this.canvas.clientHeight || 640);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(width, height, false);
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    if (this.canvas.parentElement) this.resizeObserver.observe(this.canvas.parentElement);
  }

  private async loadModel(modelUrl: string) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(modelUrl);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error('VRM model could not be loaded.');
    VRMUtils.rotateVRM0(vrm);
    this.vrm = vrm;
    vrm.scene.rotation.y = Math.PI;
    this.cacheBones();
    this.captureAvailableExpressions();
    this.normalizeMaterials(vrm.scene);
    this.fitModelToStage(vrm);
    this.scene.add(vrm.scene);
  }

  private async loadBakedMotions() {
    try {
      const response = await fetch(avatar151Guide.bakedMotionUrl, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as BakedMotionData;
      if (!data?.clips?.length || !data?.bones?.length) throw new Error('invalid baked motion data');
      if (!data.baseQ || data.baseQ.length !== data.bones.length) throw new Error('baked motion data is missing rest-pose baseQ');
      this.baked = data;
      this.bakedClipsByGroup.clear();
      for (const clip of data.clips) {
        const group = clip.group ?? 'idle';
        const list = this.bakedClipsByGroup.get(group) ?? [];
        list.push(clip);
        this.bakedClipsByGroup.set(group, list);
      }
      this.bakedBoneNodes = data.bones.map((name) => this.rawBones[name] ?? this.bones[name]);
      this.bakedUnityBaseQuaternions = data.baseQ.map((item) => this.quatFromArray(item));
    } catch (error) {
      console.warn('[Avatar151] baked motion load failed, using procedural fallback.', error);
      this.baked = undefined;
      this.bakedClipsByGroup.clear();
      this.bakedBoneNodes = [];
      this.bakedUnityBaseQuaternions = [];
    }
  }

  private cacheBones() {
    const humanoid = this.vrm?.humanoid;
    if (!humanoid) return;
    const normalized = (name: string) => humanoid.getNormalizedBoneNode(name as never) ?? humanoid.getRawBoneNode(name as never);
    const raw = (name: string) => humanoid.getRawBoneNode(name as never) ?? humanoid.getNormalizedBoneNode(name as never);
    const names = [
      'hips',
      'spine',
      'chest',
      'upperChest',
      'neck',
      'head',
      'leftShoulder',
      'leftUpperArm',
      'leftLowerArm',
      'leftHand',
      'rightShoulder',
      'rightUpperArm',
      'rightLowerArm',
      'rightHand',
      'leftUpperLeg',
      'leftLowerLeg',
      'leftFoot',
      'rightUpperLeg',
      'rightLowerLeg',
      'rightFoot',
    ];
    this.bones = {};
    this.rawBones = {};
    names.forEach((name) => {
      this.bones[name] = normalized(name);
      this.rawBones[name] = raw(name);
    });
    this.baseQuaternions.clear();
    Object.values(this.bones).forEach((bone) => {
      if (bone) this.baseQuaternions.set(bone, bone.quaternion.clone());
    });
    Object.values(this.rawBones).forEach((bone) => {
      if (bone && !this.baseQuaternions.has(bone)) this.baseQuaternions.set(bone, bone.quaternion.clone());
    });
  }

  private captureAvailableExpressions() {
    const manager = this.vrm?.expressionManager;
    this.availableExpressions.clear();
    for (const name of expressionNames) {
      if (manager?.getExpression?.(name)) this.availableExpressions.add(name);
    }
  }

  private normalizeMaterials(root: THREE.Object3D) {
    root.traverse((object) => {
      object.castShadow = true;
      object.receiveShadow = true;
      const mesh = object as THREE.Mesh;
      const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const material of materials) {
        if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
        if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        material.toneMapped = true;
        material.needsUpdate = true;
      }
    });
  }

  private fitModelToStage(vrm: VRM) {
    const scene = vrm.scene;
    scene.position.set(0, 0, 0);
    scene.scale.setScalar(1);
    scene.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(scene);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    const scale = 1.56 / Math.max(sourceSize.y, 0.001);
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);
    const fittedBox = new THREE.Box3().setFromObject(scene);
    const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
    scene.position.x -= fittedCenter.x;
    scene.position.y -= fittedBox.min.y + 0.02;
    scene.position.z -= fittedCenter.z;
    this.camera.position.set(0, 1.06, 3.75);
    this.camera.lookAt(0, 0.84, 0);
    this.camera.updateProjectionMatrix();
  }

  private startLoop() {
    const tick = () => {
      if (this.disposed) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.poseElapsed += delta;
      if (this.activeClip) this.updateBakedPose(delta);
      else this.updateProceduralPose(delta);
      this.updateBlink(delta);
      this.updateMouth(delta);
      this.applyExpressionValues(delta);
      this.vrm?.update(delta);
      this.renderer.render(this.scene, this.camera);
      this.frameId = window.requestAnimationFrame(tick);
    };
    this.clock.start();
    tick();
  }

  private applyDesiredState() {
    if (!this.ready) return;
    if (this.desiredAudioState === 'playing' || this.desiredStatus === 'speaking') {
      this.playMotionGroup('speaking');
      return;
    }
    if (this.desiredStatus === 'thinking' || this.desiredAudioState === 'pending') {
      this.playMotionGroup('thinking');
      return;
    }
    if (this.desiredEmotionCue === 'fallback') {
      this.playMotionGroup('fallback');
      return;
    }
    this.playMotionGroup('idle');
  }

  private playMotionGroup(group: Avatar151MotionGroup, forcedIndex?: number) {
    const clips = this.bakedClipsByGroup.get(group);
    const fallbackClips = group === 'fallback' ? this.bakedClipsByGroup.get('thinking') : undefined;
    const available = clips?.length ? clips : fallbackClips;
    this.currentGroup = group;
    if (this.baked && available?.length) {
      let index = typeof forcedIndex === 'number' ? forcedIndex : this.groupPickCursor[group] % available.length;
      index = THREE.MathUtils.clamp(index, 0, available.length - 1);
      const nextClip = available[index];
      if (!forcedIndex && group !== 'welcome') this.groupPickCursor[group] = (this.groupPickCursor[group] + 1) % available.length;
      if (this.activeClip?.name !== nextClip.name) {
        this.transitionFrom = this.lastPose ? this.clonePose(this.lastPose) : undefined;
        this.transitionElapsed = 0;
        this.transitionDuration = group === 'welcome' ? 0.35 : 0.58;
        this.activeClip = nextClip;
        this.activeClipTime = 0;
      }
      this.currentMotionName = nextClip.name;
    } else {
      this.activeClip = undefined;
      this.transitionFrom = undefined;
      this.currentMotionName = proceduralMotionName[group] ?? `procedural_${group}`;
    }
    this.updateExpressionTargets();
  }

  private updateBakedPose(delta: number) {
    const clip = this.activeClip;
    if (!clip) return;
    this.activeClipTime += delta;
    if (!clip.loop && this.activeClipTime > clip.duration) {
      this.applyDesiredState();
      return;
    }
    const pose = this.sampleBakedClip(clip, this.activeClipTime);
    let finalPose = pose;
    if (this.transitionFrom) {
      this.transitionElapsed += delta;
      const alpha = THREE.MathUtils.smoothstep(
        THREE.MathUtils.clamp(this.transitionElapsed / Math.max(this.transitionDuration, 0.001), 0, 1),
        0,
        1,
      );
      finalPose = this.blendPose(this.transitionFrom, pose, alpha);
      if (alpha >= 0.999) this.transitionFrom = undefined;
    }
    this.applyBakedPose(finalPose);
    this.lastPose = this.clonePose(finalPose);
  }

  private sampleBakedClip(clip: BakedClip, time: number): SampledPose {
    const frames = clip.frames;
    if (!frames?.length) {
      return { q: this.bakedBoneNodes.map(() => new THREE.Quaternion()) };
    }
    const duration = Math.max(clip.duration, 0.001);
    const localTime = clip.loop ? ((time % duration) + duration) % duration : THREE.MathUtils.clamp(time, 0, duration);
    let leftIndex = 0;
    for (let i = 0; i < frames.length - 1; i += 1) {
      if (frames[i + 1].t >= localTime) {
        leftIndex = i;
        break;
      }
      leftIndex = i;
    }
    const rightIndex = Math.min(leftIndex + 1, frames.length - 1);
    const left = frames[leftIndex];
    const right = frames[rightIndex];
    const span = Math.max(right.t - left.t, 0.0001);
    const alpha = THREE.MathUtils.clamp((localTime - left.t) / span, 0, 1);
    const q = this.bakedBoneNodes.map((_, boneIndex) => {
      const qa = this.quatFromArray(left.q[boneIndex]);
      const qb = this.quatFromArray(right.q[boneIndex] ?? left.q[boneIndex]);
      qa.slerp(qb, alpha);
      const unityBase = this.bakedUnityBaseQuaternions[boneIndex] ?? new THREE.Quaternion();
      const delta = unityBase.clone().invert().multiply(qa).normalize();
      const node = this.bakedBoneNodes[boneIndex];
      const frontendBase = (node && this.baseQuaternions.get(node)) || new THREE.Quaternion();
      return frontendBase.clone().multiply(delta).normalize();
    });
    return { q };
  }

  private applyBakedPose(pose: SampledPose) {
    for (let i = 0; i < this.bakedBoneNodes.length; i += 1) {
      const bone = this.bakedBoneNodes[i];
      if (!bone || !pose.q[i]) continue;
      bone.quaternion.copy(pose.q[i]);
    }
  }

  private blendPose(from: SampledPose, to: SampledPose, alpha: number): SampledPose {
    return {
      q: to.q.map((target, index) => {
        const start = from.q[index] ?? target;
        const q = start.clone();
        q.slerp(target, alpha);
        return q;
      }),
    };
  }

  private clonePose(pose: SampledPose): SampledPose {
    return { q: pose.q.map((item) => item.clone()) };
  }

  private quatFromArray(value?: number[]) {
    if (!value || value.length < 4) return new THREE.Quaternion();
    return new THREE.Quaternion(value[0], value[1], value[2], value[3]).normalize();
  }

  private updateProceduralPose(delta: number) {
    this.resetBoneRotations();
    const t = this.poseElapsed;
    const breathe = Math.sin(t * 2.1);
    const talk = Math.sin(t * 4.6);
    const group = this.currentGroup;

    this.applyLocalRotation(this.bones.spine, new THREE.Euler(0.01 * breathe, 0, 0.012 * breathe, 'XYZ'));
    this.applyLocalRotation(this.bones.chest, new THREE.Euler(0.012 * breathe, 0.018 * Math.sin(t * 0.85), 0, 'XYZ'));
    if (group === 'thinking' || group === 'fallback') {
      this.applyLocalRotation(this.bones.head, new THREE.Euler(0.08 + 0.012 * breathe, -0.08, 0.035, 'XYZ'));
    } else if (group === 'speaking') {
      this.applyLocalRotation(this.bones.head, new THREE.Euler(0.012 * talk, 0.035 * Math.sin(t * 1.7), 0, 'XYZ'));
    } else {
      this.applyLocalRotation(this.bones.head, new THREE.Euler(0.006 * breathe, 0.02 * Math.sin(t * 0.75), 0, 'XYZ'));
    }

    const targets = this.resolveArmTargets(group, t);
    this.lerpDirection(this.smoothedArmTargets.leftUpper, targets.leftUpper, delta);
    this.lerpDirection(this.smoothedArmTargets.leftLower, targets.leftLower, delta);
    this.lerpDirection(this.smoothedArmTargets.rightUpper, targets.rightUpper, delta);
    this.lerpDirection(this.smoothedArmTargets.rightLower, targets.rightLower, delta);

    this.vrm?.scene.updateMatrixWorld(true);
    this.rotateBoneToward(this.bones.leftUpperArm, this.bones.leftLowerArm, this.smoothedArmTargets.leftUpper, 0.94);
    this.vrm?.scene.updateMatrixWorld(true);
    this.rotateBoneToward(this.bones.leftLowerArm, this.bones.leftHand, this.smoothedArmTargets.leftLower, 0.88);
    this.vrm?.scene.updateMatrixWorld(true);
    this.rotateBoneToward(this.bones.rightUpperArm, this.bones.rightLowerArm, this.smoothedArmTargets.rightUpper, 0.94);
    this.vrm?.scene.updateMatrixWorld(true);
    this.rotateBoneToward(this.bones.rightLowerArm, this.bones.rightHand, this.smoothedArmTargets.rightLower, 0.88);
  }

  private resolveArmTargets(group: Avatar151MotionGroup, t: number) {
    const idle = {
      leftUpper: new THREE.Vector3(-0.18, -0.96, 0.08).normalize(),
      leftLower: new THREE.Vector3(-0.06, -0.99, 0.03).normalize(),
      rightUpper: new THREE.Vector3(0.18, -0.96, 0.08).normalize(),
      rightLower: new THREE.Vector3(0.06, -0.99, 0.03).normalize(),
    };
    if (group === 'welcome') {
      const wave = Math.sin(t * 8.0) * 0.14;
      return {
        leftUpper: idle.leftUpper,
        leftLower: idle.leftLower,
        rightUpper: new THREE.Vector3(0.58, 0.32 + wave, 0.12).normalize(),
        rightLower: new THREE.Vector3(0.22, 0.88 + wave, 0.16).normalize(),
      };
    }
    if (group === 'speaking') {
      const sway = Math.sin(t * 3.2) * 0.08;
      return {
        leftUpper: new THREE.Vector3(-0.33, -0.62 + sway, 0.42).normalize(),
        leftLower: new THREE.Vector3(-0.18, -0.36, 0.74).normalize(),
        rightUpper: new THREE.Vector3(0.33, -0.58 - sway, 0.44).normalize(),
        rightLower: new THREE.Vector3(0.18, -0.32, 0.76).normalize(),
      };
    }
    if (group === 'thinking' || group === 'fallback') {
      return {
        leftUpper: new THREE.Vector3(-0.16, -0.96, 0.06).normalize(),
        leftLower: new THREE.Vector3(-0.06, -0.99, 0.03).normalize(),
        rightUpper: new THREE.Vector3(0.25, -0.86, 0.28).normalize(),
        rightLower: new THREE.Vector3(0.1, -0.62, 0.55).normalize(),
      };
    }
    return idle;
  }

  private resetBoneRotations() {
    for (const [bone, quaternion] of this.baseQuaternions.entries()) {
      bone.quaternion.copy(quaternion);
    }
  }

  private applyLocalRotation(bone: THREE.Object3D | undefined, euler: THREE.Euler) {
    if (!bone) return;
    bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(euler));
  }

  private lerpDirection(current: THREE.Vector3, target: THREE.Vector3, delta: number) {
    const alpha = 1 - Math.exp(-delta * 5.8);
    current.lerp(target, alpha).normalize();
  }

  private rotateBoneToward(
    bone: THREE.Object3D | undefined,
    child: THREE.Object3D | undefined,
    desiredWorldDirection: THREE.Vector3,
    influence: number,
  ) {
    if (!bone || !child) return;
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    bone.getWorldPosition(start);
    child.getWorldPosition(end);
    const currentDirection = end.sub(start).normalize();
    if (currentDirection.lengthSq() < 0.0001) return;
    const deltaWorld = new THREE.Quaternion().setFromUnitVectors(currentDirection, desiredWorldDirection.clone().normalize());
    const currentWorld = new THREE.Quaternion();
    bone.getWorldQuaternion(currentWorld);
    const targetWorld = deltaWorld.multiply(currentWorld);
    currentWorld.slerp(targetWorld, influence);
    const parentWorld = new THREE.Quaternion();
    bone.parent?.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(parentWorld.invert().multiply(currentWorld));
  }

  private updateExpressionTargets() {
    const cue = this.desiredEmotionCue;
    const speaking = this.desiredStatus === 'speaking' || this.desiredAudioState === 'playing' || this.currentGroup === 'speaking';
    const thinking = this.desiredStatus === 'thinking' || this.desiredAudioState === 'pending' || cue === 'thinking' || this.currentGroup === 'thinking';
    expressionNames.forEach((name) => {
      if (!mouthNames.includes(name) && name !== 'blink') this.expressionTargets[name] = 0;
    });
    if (speaking) {
      this.expressionTargets.happy = 0.2;
      this.expressionTargets.relaxed = 0.16;
    } else if (thinking) {
      this.expressionTargets.relaxed = 0.34;
    } else if (cue === 'success' || cue === 'welcome' || cue === 'wake' || this.currentGroup === 'welcome') {
      this.expressionTargets.happy = 0.42;
      this.expressionTargets.relaxed = 0.2;
    } else if (cue === 'fallback') {
      this.expressionTargets.sad = 0.12;
      this.expressionTargets.relaxed = 0.2;
    } else if (cue === 'sleep') {
      this.expressionTargets.relaxed = 0.42;
    } else {
      this.expressionTargets.relaxed = 0.22;
    }
  }

  private updateBlink(delta: number) {
    this.blinkElapsed += delta;
    if (!this.blinking && this.blinkElapsed >= this.nextBlinkIn) {
      this.blinking = true;
      this.blinkElapsed = 0;
      this.nextBlinkIn = 2.4 + Math.random() * 3.4;
    }
    if (this.blinking) {
      const t = this.blinkElapsed;
      this.expressionTargets.blink = t < 0.07 ? t / 0.07 : Math.max(0, 1 - (t - 0.07) / 0.11);
      if (t > 0.2) {
        this.blinking = false;
        this.expressionTargets.blink = 0;
        this.blinkElapsed = 0;
      }
    }
  }

  private updateMouth(delta: number) {
    const shouldTalk = this.desiredAudioState === 'playing';
    this.mouthElapsed += delta;
    mouthNames.forEach((name) => {
      this.expressionTargets[name] = 0;
    });
    if (!shouldTalk) return;
    const intensity = this.speechText ? 0.58 : 0.42;
    const a = (Math.sin(this.mouthElapsed * 17.5) + 1) * 0.5;
    const b = (Math.sin(this.mouthElapsed * 11.0 + 1.8) + 1) * 0.5;
    const c = (Math.sin(this.mouthElapsed * 7.4 + 3.1) + 1) * 0.5;
    this.expressionTargets.aa = 0.12 + a * intensity;
    this.expressionTargets.ih = b * 0.16;
    this.expressionTargets.ou = c * 0.12;
  }

  private applyExpressionValues(delta: number) {
    this.updateExpressionTargets();
    const manager = this.vrm?.expressionManager;
    if (!manager) return;
    const alpha = 1 - Math.exp(-delta * 12);
    for (const name of expressionNames) {
      if (!this.availableExpressions.has(name)) continue;
      const current = this.expressionValues[name] ?? 0;
      const target = this.expressionTargets[name] ?? 0;
      const next = THREE.MathUtils.lerp(current, target, alpha);
      this.expressionValues[name] = next;
      manager.setValue(name, next);
    }
  }
}
