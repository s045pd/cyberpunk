import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';

/**
 * 西侧 Del Coronado 湾：夜之城临海，城区多边形西缘（x≈-2080）以西全部是水。
 * 岸线用双正弦扰动出自然弧度。
 */
export function coastXAt(z: number): number {
  return -2350 + 180 * Math.sin(z * 0.0004) + 90 * Math.sin(z * 0.0013 + 2.0);
}

/** 岸线最东可达位置（陆上设施须在此以东） */
export const WATER_EAST_MAX = -2080;

const VERT = /* glsl */ `
varying vec2 vWorld;
varying float vDist;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  vec4 view = viewMatrix * world;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uGlow;
varying vec2 vWorld;
varying float vDist;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  // 岸线以东丢弃（与 coastXAt 保持一致）
  float coast = -2350.0 + 180.0 * sin(vWorld.y * 0.0004) + 90.0 * sin(vWorld.y * 0.0013 + 2.0);
  if (vWorld.x > coast) discard;

  // 深色水体 + 两层滚动波光
  vec3 col = vec3(0.010, 0.016, 0.024);
  float w1 = vnoise(vWorld * 0.015 + vec2(uTime * 0.06, uTime * 0.02));
  float w2 = vnoise(vWorld * 0.06 - vec2(uTime * 0.11, uTime * 0.05));
  float glint = smoothstep(0.62, 0.95, w1 * 0.6 + w2 * 0.4);
  col += vec3(0.10, 0.13, 0.18) * glint;

  // 城市霓虹在水面的倒影（近岸更亮，随波扰动）
  vec2 uv = vWorld / 8000.0 + 0.5;
  uv.x += (w2 - 0.5) * 0.01;
  vec3 glow = texture2D(uGlow, uv).rgb;
  float shoreFade = smoothstep(coast - 900.0, coast, vWorld.x);
  col += glow * (0.25 + shoreFade * 0.55);

  // 岸边浪线
  float foam = smoothstep(14.0, 0.0, coast - vWorld.x)
             * (0.5 + 0.5 * sin(uTime * 1.4 + vWorld.y * 0.05));
  col += vec3(0.06, 0.09, 0.11) * foam;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface Water {
  mesh: THREE.Mesh;
  update(dt: number, t: number): void;
}

export function createWater(glowTexture: THREE.Texture): Water {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uGlow: { value: glowTexture },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.35;
  return {
    mesh,
    update(_dt: number, t: number) {
      mat.uniforms.uTime.value = t;
    },
  };
}
