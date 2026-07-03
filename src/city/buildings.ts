import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Plot } from './layout';
import { DISTRICTS } from './districts';
import { createRng, range } from '../core/rng';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';

const KIND_COUNT = 5;

// 注意：InstancedMesh 渲染时 three 会定义 USE_INSTANCING 并在 ShaderMaterial
// 前缀里自动声明 attribute mat4 instanceMatrix，这里不能重复声明。
const VERT = /* glsl */ `
attribute vec3 aScale;
attribute vec3 aTint;
attribute float aLit;
attribute float aSeed;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vTint;
varying float vLit;
varying float vSeed;
varying float vDist;

void main() {
  vLocal = position * aScale;
  vNormal = normal;
  vTint = aTint;
  vLit = aLit;
  vSeed = aSeed;
  vec4 world = instanceMatrix * vec4(vLocal, 1.0);
  vec4 view = viewMatrix * world;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vTint;
varying float vLit;
varying float vSeed;
varying float vDist;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec3 n = normalize(vNormal);
  // 暗立面基色 + 微弱顶面光
  vec3 col = vTint * (0.35 + 0.5 * max(n.y, 0.0));

  // 侧面窗格
  if (abs(n.y) < 0.5) {
    vec2 wallUV = abs(n.x) > 0.5 ? vLocal.zy : vLocal.xy;
    vec2 cellSize = vec2(4.0, 3.6);
    vec2 cell = floor(wallUV / cellSize);
    vec2 f = fract(wallUV / cellSize);
    float rnd = hash21(cell + vSeed);
    float lit = step(1.0 - vLit, rnd);
    float frame = step(0.18, f.x) * step(f.x, 0.82)
                * step(0.22, f.y) * step(f.y, 0.88);
    float warm = hash21(cell + vSeed + 7.0);
    vec3 winCol = mix(vec3(0.35, 0.72, 1.0), vec3(1.0, 0.72, 0.38), step(0.55, warm));
    float flicker = 1.0;
    if (rnd > 0.986) {
      flicker = 0.4 + 0.6 * step(0.0, sin(uTime * (8.0 + warm * 40.0) + vSeed * 10.0));
    }
    col += winCol * lit * frame * flicker * 1.7;
  }

  // 近地面压暗（假 AO）
  col *= clamp(vLocal.y / 25.0 + 0.35, 0.35, 1.0);

  // 指数平方雾（与 scene.fog 一致）
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

function unitBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

function archetypeGeometry(kind: number): THREE.BufferGeometry {
  switch (kind) {
    case 1: { // 阶梯塔：主体 + 收分顶部
      const top = unitBox();
      top.scale(0.62, 0.32, 0.62);
      top.translate(0, 1.0, 0);
      return mergeGeometries([unitBox(), top]);
    }
    case 2: { // 天线塔
      const mast = new THREE.BoxGeometry(0.05, 0.4, 0.05);
      mast.translate(0, 1.2, 0);
      return mergeGeometries([unitBox(), mast]);
    }
    case 3: { // 板楼（矮宽）
      const g = unitBox();
      g.scale(1.35, 0.62, 0.75);
      return g;
    }
    case 4: { // 双子楼
      const a = unitBox();
      a.scale(0.42, 1.0, 0.9);
      a.translate(-0.28, 0, 0);
      const b = unitBox();
      b.scale(0.42, 0.82, 0.9);
      b.translate(0.28, 0, 0);
      return mergeGeometries([a, b]);
    }
    default:
      return unitBox();
  }
}

export interface Buildings {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

export function createBuildings(plots: Plot[], seed: number): Buildings {
  const styleById = new Map(DISTRICTS.map((d) => [d.id, d.style]));
  const rng = createRng(seed >>> 0);
  const group = new THREE.Group();

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
    },
  });

  const byKind: Plot[][] = Array.from({ length: KIND_COUNT }, () => []);
  for (const p of plots) byKind[p.kind].push(p);

  const tint = new THREE.Color();
  const m = new THREE.Matrix4();

  byKind.forEach((list, kind) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(archetypeGeometry(kind), material, list.length);
    mesh.frustumCulled = false;

    const aScale = new Float32Array(list.length * 3);
    const aTint = new Float32Array(list.length * 3);
    const aLit = new Float32Array(list.length);
    const aSeed = new Float32Array(list.length);

    list.forEach((p, i) => {
      m.makeTranslation(p.x, 0, p.z);
      mesh.setMatrixAt(i, m);
      aScale.set([p.sx, p.h, p.sz], i * 3);
      tint.setHex(styleById.get(p.district)!.facadeColor);
      const jitter = range(rng, 0.8, 1.2);
      aTint.set([tint.r * jitter, tint.g * jitter, tint.b * jitter], i * 3);
      aLit[i] = p.litRate;
      aSeed[i] = range(rng, 0, 100);
    });

    const geo = mesh.geometry;
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 3));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 3));
    geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(aLit, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  });

  return {
    group,
    update(_dt: number, t: number) {
      material.uniforms.uTime.value = t;
    },
  };
}
