import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Plot } from './layout';
import { DISTRICTS } from './districts';
import { createRng, range, pick } from '../core/rng';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';

const KIND_COUNT = 8;

// 注意：InstancedMesh 渲染时 three 会定义 USE_INSTANCING 并在 ShaderMaterial
// 前缀里自动声明 attribute mat4 instanceMatrix，这里不能重复声明。
const VERT = /* glsl */ `
attribute vec3 aScale;
attribute vec3 aTint;
attribute vec3 aAccent;
attribute float aLit;
attribute float aSeed;
attribute float aTrim;
varying vec3 vLocal;
varying vec3 vScale;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vAccent;
varying float vLit;
varying float vSeed;
varying float vTrim;
varying float vDist;

void main() {
  vLocal = position * aScale;
  vScale = aScale;
  vNormal = normal;
  vTint = aTint;
  vAccent = aAccent;
  vLit = aLit;
  vSeed = aSeed;
  vTrim = aTrim;
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
varying vec3 vScale;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vAccent;
varying float vLit;
varying float vSeed;
varying float vTrim;
varying float vDist;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec3 n = normalize(vNormal);
  float side = step(abs(n.y), 0.5);
  vec2 wallUV = abs(n.x) > 0.5 ? vLocal.zy : vLocal.xy;

  // ---- 立面材质：面板拼布 + 竖梃，让楼体在夜里也是可见的实体 ----
  vec3 base = vTint;
  float panelRnd = hash21(floor(wallUV / vec2(11.0, 12.8)) + vSeed);
  base *= mix(1.0, 0.72 + panelRnd * 0.6, side);
  float mull = step(fract(wallUV.x / 7.5), 0.06) * side;
  base *= 1.0 - mull * 0.35;

  vec3 col = base * (0.55 + 0.3 * max(n.y, 0.0));

  // 楼板暗线：每层一道，体量分层可读
  float slab = step(fract(vLocal.y / 3.2), 0.07) * side;
  col *= 1.0 - slab * 0.45;

  // 街道光反弹：底部数十米被城市霓虹与钠灯晕染
  float bounce = exp(-max(vLocal.y - 3.0, 0.0) / 42.0);
  col += (vAccent * 0.4 + vec3(0.5, 0.30, 0.12)) * bounce * 0.22;

  // ---- 窗格：未亮的窗是深色玻璃，亮窗压在 bloom 阈值下 ----
  if (side > 0.5) {
    vec2 cellSize = vec2(2.6, 3.2);
    vec2 cell = floor(wallUV / cellSize);
    vec2 f = fract(wallUV / cellSize);
    float rnd = hash21(cell + vSeed);
    float band = hash21(vec2(cell.y, vSeed));
    float bandBoost = mix(0.45, 1.5, step(0.72, band));
    float lit = step(1.0 - clamp(vLit * bandBoost, 0.0, 0.85), rnd);
    float inWin = step(0.2, f.x) * step(f.x, 0.8)
                * step(0.3, f.y) * step(f.y, 0.85);
    col = mix(col, col * 0.4 + vec3(0.012, 0.016, 0.028), inWin * (1.0 - lit));
    float warm = hash21(cell + vSeed + 7.0);
    vec3 winCol = warm < 0.42
      ? vec3(1.0, 0.66, 0.30)
      : (warm < 0.8 ? vec3(0.8, 0.85, 0.95) : vec3(0.45, 0.9, 0.85));
    float flicker = 1.0;
    if (rnd > 0.988) {
      flicker = 0.4 + 0.6 * step(0.0, sin(uTime * (8.0 + warm * 40.0) + vSeed * 10.0));
    }
    col += winCol * lit * inWin * flicker * 1.1;
  }

  // 霓虹描边：少量楼体的层顶光带 + 棱线（收敛，不喧宾夺主）
  if (vTrim > 0.5) {
    float topBand = step(vScale.y * 0.965, vLocal.y) * step(vLocal.y, vScale.y * 1.005);
    float cornerX = step(vScale.x * 0.465, abs(vLocal.x));
    float cornerZ = step(vScale.z * 0.465, abs(vLocal.z));
    col += vAccent * (topBand * 1.6 + cornerX * cornerZ * 0.6);
  }

  // 近地面压暗（街道峡谷阴影）
  col *= clamp(vLocal.y / 26.0 + 0.42, 0.42, 1.0);

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

/** 顶部机房/水箱等屋顶杂物，增加轮廓细节 */
function roofClutter(y: number): THREE.BufferGeometry[] {
  const a = unitBox();
  a.scale(0.28, 0.08, 0.22);
  a.translate(-0.2, y, 0.15);
  const b = unitBox();
  b.scale(0.16, 0.12, 0.16);
  b.translate(0.22, y, -0.18);
  return [a, b];
}

function archetypeGeometry(kind: number): THREE.BufferGeometry {
  switch (kind) {
    case 1: { // 两段收分
      const top = unitBox();
      top.scale(0.68, 0.34, 0.68);
      top.translate(0, 1.0, 0);
      return mergeGeometries([unitBox(), top, ...roofClutter(1.34)]);
    }
    case 2: { // 三段收分（下城超塔轮廓）
      const mid = unitBox();
      mid.scale(0.78, 0.4, 0.78);
      mid.translate(0, 1.0, 0);
      const top = unitBox();
      top.scale(0.55, 0.28, 0.55);
      top.translate(0, 1.4, 0);
      return mergeGeometries([unitBox(), mid, top]);
    }
    case 3: { // 板楼
      const g = unitBox();
      g.scale(1.3, 0.62, 0.78);
      return mergeGeometries([g, ...roofClutter(0.62)]);
    }
    case 4: { // 双子楼 + 连桥
      const a = unitBox();
      a.scale(0.42, 1.0, 0.9);
      a.translate(-0.28, 0, 0);
      const b = unitBox();
      b.scale(0.42, 0.84, 0.9);
      b.translate(0.28, 0, 0);
      const bridge = unitBox();
      bridge.scale(0.18, 0.04, 0.5);
      bridge.translate(0, 0.6, 0);
      return mergeGeometries([a, b, bridge]);
    }
    case 5: { // 裙楼 + 塔楼（企业塔经典形态）
      const podium = unitBox();
      podium.scale(1.0, 0.16, 1.0);
      const tower = unitBox();
      tower.scale(0.56, 0.9, 0.56);
      tower.translate(0, 0.16, 0);
      return mergeGeometries([podium, tower, ...roofClutter(0.18)]);
    }
    case 6: { // 天线塔
      const mast = new THREE.BoxGeometry(0.04, 0.42, 0.04);
      mast.translate(0.12, 1.2, -0.1);
      const mast2 = new THREE.BoxGeometry(0.03, 0.28, 0.03);
      mast2.translate(-0.18, 1.13, 0.14);
      return mergeGeometries([unitBox(), mast, mast2, ...roofClutter(1.0)]);
    }
    case 7: { // 低层工业：主体 + 屋顶储罐群
      const g = unitBox();
      g.scale(1.2, 0.8, 1.0);
      const t1 = unitBox();
      t1.scale(0.2, 0.5, 0.2);
      t1.translate(-0.3, 0.8, 0.2);
      const t2 = unitBox();
      t2.scale(0.14, 0.36, 0.14);
      t2.translate(0.25, 0.8, -0.15);
      return mergeGeometries([g, t1, t2]);
    }
    default:
      return mergeGeometries([unitBox(), ...roofClutter(1.0)]);
  }
}

export interface Buildings {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

// 立面变体色：混入区域基色，形成锈橙/灰/绿灰/棕的拼布城市（参考原作日景材质）
const FACADE_VARIANTS = [0x3a4048, 0x4a3720, 0x2f3835, 0x3f3326, 0x2b2f38];

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
  const variant = new THREE.Color();
  const accent = new THREE.Color();
  const m = new THREE.Matrix4();

  byKind.forEach((list, kind) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(archetypeGeometry(kind), material, list.length);
    mesh.frustumCulled = false;

    const aScale = new Float32Array(list.length * 3);
    const aTint = new Float32Array(list.length * 3);
    const aAccent = new Float32Array(list.length * 3);
    const aLit = new Float32Array(list.length);
    const aSeed = new Float32Array(list.length);
    const aTrim = new Float32Array(list.length);

    list.forEach((p, i) => {
      m.makeTranslation(p.x, 0, p.z);
      mesh.setMatrixAt(i, m);
      aScale.set([p.sx, p.h, p.sz], i * 3);
      const style = styleById.get(p.district)!;
      tint.setHex(style.facadeColor);
      tint.lerp(variant.setHex(pick(rng, FACADE_VARIANTS)), 0.62);
      const jitter = range(rng, 0.8, 1.2);
      aTint.set([tint.r * jitter, tint.g * jitter, tint.b * jitter], i * 3);
      accent.setHex(pick(rng, style.neonPalette));
      aAccent.set([accent.r, accent.g, accent.b], i * 3);
      aLit[i] = p.litRate;
      aSeed[i] = range(rng, 0, 100);
      // 少量楼体有霓虹描边；高楼概率略高
      aTrim[i] = rng() < (p.h > 120 ? 0.2 : 0.07) ? 1 : 0;
    });

    const geo = mesh.geometry;
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 3));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 3));
    geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(aAccent, 3));
    geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(aLit, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
    geo.setAttribute('aTrim', new THREE.InstancedBufferAttribute(aTrim, 1));
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
