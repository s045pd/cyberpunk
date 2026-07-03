import * as THREE from 'three';
import { createRng, range } from '../core/rng';

const COUNT = 45000;
const BOX = { x: 520, y: 380, z: 520 };
const FALL_SPEED = 95;

const VERT = /* glsl */ `
attribute vec3 aOffset;
uniform float uTime;
uniform vec3 uCam;
varying float vAlpha;

const vec3 BOX = vec3(${BOX.x}.0, ${BOX.y}.0, ${BOX.z}.0);

void main() {
  vec3 p;
  p.x = uCam.x + mod(aOffset.x - uCam.x, BOX.x) - BOX.x * 0.5;
  p.z = uCam.z + mod(aOffset.z - uCam.z, BOX.z) - BOX.z * 0.5;
  p.y = uCam.y + mod(aOffset.y - uTime * ${FALL_SPEED}.0 - uCam.y, BOX.y) - BOX.y * 0.5;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vAlpha = smoothstep(${BOX.x}.0 * 0.55, 60.0, dist) * 0.45;
  gl_PointSize = clamp(160.0 / dist, 1.0, 3.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  // 竖向雨丝：横向快速衰减
  vec2 c = gl_PointCoord - 0.5;
  float streak = smoothstep(0.5, 0.0, abs(c.x)) * smoothstep(0.55, 0.1, abs(c.y));
  gl_FragColor = vec4(vec3(0.62, 0.72, 0.86), vAlpha * streak);
}
`;

export interface Rain {
  points: THREE.Points;
  update(dt: number, t: number, cam: THREE.Vector3): void;
  setDensity(fraction: number): void;
}

export function createRain(seed: number): Rain {
  const rng = createRng((seed ^ 0x2a12) >>> 0);
  const offsets = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    offsets.set([
      range(rng, 0, BOX.x),
      range(rng, 0, BOX.y),
      range(rng, 0, BOX.z),
    ], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  // position 必须存在（three 需要）但实际位置全在 shader 里算
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  return {
    points,
    update(_dt: number, t: number, cam: THREE.Vector3) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uCam.value.copy(cam);
    },
    setDensity(fraction: number) {
      geo.setDrawRange(0, Math.floor(COUNT * fraction));
    },
  };
}
