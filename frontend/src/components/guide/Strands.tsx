import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import styles from './Strands.module.css';

const MAX_STRANDS = 12;
const MAX_COLORS = 8;
const COLORS = ['#f97316', '#7c3aed', '#06b6d4'];

const VERTEX_SHADER = `
in vec3 position;

void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[${MAX_COLORS}];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

out vec4 fragColor;

const float PI = 3.14159265;

vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(uColorCount);
  int idx = int(floor(scaled));
  float blend = fract(scaled);
  int nextIdx = idx + 1;
  if (nextIdx >= uColorCount) nextIdx = 0;
  return mix(uColors[idx], uColors[nextIdx], blend);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  uv /= max(uScale, 0.0001);

  float energy = 0.06 + uIntensity * 0.94;
  float envelope = pow(max(cos(uv.x * PI * 1.3), 0.0), uTaper);
  vec3 color = vec3(0.0);

  for (int i = 0; i < ${MAX_STRANDS}; i++) {
    if (i >= uStrandCount) break;

    float strand = float(i);
    float phase = strand * 1.7 * uSpread;
    float frequency = (2.0 + strand * 0.35) * uWaviness;
    float speed = 1.4 + strand * 1.2;
    float time = uTime * uSpeed;
    float wave = sin(uv.x * frequency + time * speed + phase) * 0.60
      + sin(uv.x * frequency * 1.1 - time * speed * 0.7 + phase * 1.7) * 0.40;

    float amplitude = (0.1 + 0.02 * energy) * envelope * uAmplitude;
    float y = wave * amplitude;
    float distanceToStrand = abs(uv.y - y);
    float thickness = (0.001 + 0.05 * energy) * (0.35 + envelope) * uThickness;
    float glow = thickness / (distanceToStrand + thickness * 0.45);
    glow *= glow;

    float palettePosition = strand / float(uStrandCount) + uv.x * 0.30 + uTime * 0.04;
    color += samplePalette(palettePosition) * glow * envelope;
  }

  color *= 0.45 + 0.7 * energy;
  color = 1.0 - exp(-color * uGlow);

  float gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = max(mix(vec3(gray), color, uSaturation), 0.0);

  float luminance = max(max(color.r, color.g), color.b);
  float alpha = clamp(luminance, 0.0, 1.0) * uOpacity;
  fragColor = vec4(color * uOpacity, alpha);
}
`;

function buildPalette() {
  const colors = COLORS.map((color) => new THREE.Color(color));
  while (colors.length < MAX_COLORS) {
    colors.push(colors[colors.length - 1].clone());
  }
  return colors;
}

interface StrandsProps {
  className?: string;
}

export default function Strands({ className = '' }: StrandsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(1);

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uColors: { value: buildPalette() },
        uColorCount: { value: COLORS.length },
        uStrandCount: { value: 3 },
        uSpeed: { value: 0.5 },
        uAmplitude: { value: 1 },
        uWaviness: { value: 1 },
        uThickness: { value: 0.7 },
        uGlow: { value: 2.6 },
        uTaper: { value: 3 },
        uSpread: { value: 1 },
        uIntensity: { value: 0.6 },
        uOpacity: { value: 1 },
        uScale: { value: 1.5 },
        uSaturation: { value: 2 },
      },
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    container.appendChild(renderer.domElement);

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      material.uniforms.uResolution.value.set(width, height);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let animationFrame = 0;
    const render = (time: number) => {
      material.uniforms.uTime.value = time * 0.001;
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className}`}
      aria-hidden="true"
    />
  );
}
