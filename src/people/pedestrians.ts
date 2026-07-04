import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range, pick, Rng } from '../core/rng';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';

export type PedKind =
  | 'man' | 'woman' | 'elder' | 'kid'
  | 'cop' | 'medic' | 'vendor';

const ROAD_SPACING = 480;      // 与 layout.ts 对齐
const ROAD_HALF_WIDTH = 14;
const CITY_RADIUS = 3400;
const SIDEWALK_OFFSET = ROAD_HALF_WIDTH + 2.4;

/** 纯几何、可单测：沿路网两侧的人行道路径（避开西侧海湾） */
export function buildSidewalkPaths(): THREE.LineCurve3[] {
  const paths: THREE.LineCurve3[] = [];
  const westLimit = -2050; // coastXAt 最东 -2080，留 30m 裕量
  for (let k = -6; k <= 6; k++) {
    const c = k * ROAD_SPACING;
    if (Math.abs(c) + SIDEWALK_OFFSET >= CITY_RADIUS) continue;
    const half = Math.sqrt(
      CITY_RADIUS * CITY_RADIUS - (Math.abs(c) + SIDEWALK_OFFSET) ** 2,
    );
    // 沿 z 的人行道（路两侧）—— 西侧水域中的纵路直接跳过
    if (c > westLimit) {
      for (const side of [-1, 1]) {
        paths.push(new THREE.LineCurve3(
          new THREE.Vector3(c + side * SIDEWALK_OFFSET, 0, -half),
          new THREE.Vector3(c + side * SIDEWALK_OFFSET, 0, half),
        ));
      }
    }
    // 沿 x 的人行道 —— 西端截断到岸线以东
    const x0 = Math.max(-half, westLimit);
    if (x0 < half - 50) {
      for (const side of [-1, 1]) {
        paths.push(new THREE.LineCurve3(
          new THREE.Vector3(x0, 0, c + side * SIDEWALK_OFFSET),
          new THREE.Vector3(half, 0, c + side * SIDEWALK_OFFSET),
        ));
      }
    }
  }
  return paths;
}

/* ---------- 人体几何：单位身高，aPart 分区驱动步态 ---------- */
// 0 躯干/帽 1 头 2 左腿 3 右腿 4 左臂 5 右臂 6 发光饰件 7 手杖 8 头发

function partBox(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  part: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const n = g.getAttribute('position').count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  return g;
}

interface HumanOpts {
  head: number;
  shoulder: number;
  hairLen: number;   // 后垂发长（0 = 短发帽盖）
  cap?: boolean;     // 制服帽（用躯干色）
  cane?: boolean;    // 手杖
  visor?: boolean;   // 面部发光义眼条
  badge?: boolean;   // 胸前发光徽章
}

function buildHumanGeometry(o: HumanOpts): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hipY = 0.52;
  const legW = o.shoulder * 0.32;
  parts.push(
    partBox(o.shoulder, 0.34, 0.15, 0, hipY + 0.17, 0, 0),                 // 躯干
    partBox(o.head, o.head, o.head, 0, 0.9, 0, 1),                          // 头
    partBox(legW, hipY, legW * 1.1, -o.shoulder * 0.22, hipY / 2, 0, 2),    // 左腿
    partBox(legW, hipY, legW * 1.1, o.shoulder * 0.22, hipY / 2, 0, 3),     // 右腿
    partBox(0.05, 0.36, 0.06, -(o.shoulder / 2 + 0.035), 0.66, 0, 4),       // 左臂
    partBox(0.05, 0.36, 0.06, o.shoulder / 2 + 0.035, 0.66, 0, 5),          // 右臂
  );
  if (o.hairLen > 0) {
    parts.push(partBox(o.head * 1.08, o.hairLen, o.head * 0.5,
      0, 0.9 + o.head / 2 - o.hairLen / 2, -o.head * 0.42, 8));
  } else {
    parts.push(partBox(o.head * 1.06, 0.035, o.head * 1.06,
      0, 0.9 + o.head / 2 + 0.017, 0, o.cap ? 0 : 8));                      // 短发盖/制服帽
  }
  if (o.cap) {
    parts.push(partBox(o.head * 1.1, 0.02, o.head * 0.5,
      0, 0.9 + o.head / 2, o.head * 0.55, 0));                              // 帽檐
  }
  if (o.visor) {
    parts.push(partBox(o.head * 0.9, 0.025, 0.015, 0, 0.91, o.head / 2 + 0.008, 6));
  }
  if (o.badge) {
    parts.push(partBox(0.06, 0.05, 0.015, -o.shoulder * 0.22, 0.74, 0.083, 6));
  }
  if (o.cane) {
    parts.push(partBox(0.018, 0.5, 0.018, o.shoulder / 2 + 0.09, 0.25, 0.06, 7));
  }
  return mergeGeometries(parts);
}

const ARCHETYPES: Record<PedKind, HumanOpts> = {
  man: { head: 0.11, shoulder: 0.30, hairLen: 0 },
  woman: { head: 0.10, shoulder: 0.24, hairLen: 0.2 },
  elder: { head: 0.105, shoulder: 0.26, hairLen: 0, cane: true },
  kid: { head: 0.16, shoulder: 0.22, hairLen: 0 },
  cop: { head: 0.11, shoulder: 0.31, hairLen: 0, cap: true, badge: true },
  medic: { head: 0.11, shoulder: 0.29, hairLen: 0, cap: true, badge: true },
  vendor: { head: 0.11, shoulder: 0.29, hairLen: 0, badge: true },
};

interface KindProfile {
  heights: [number, number];
  speed: [number, number];
  swing: number;
  clothes?: number[]; // 固定制服色板
  accent?: number[];
}

const PROFILES: Record<PedKind, KindProfile> = {
  man: { heights: [1.7, 1.84], speed: [1.0, 1.7], swing: 0.5 },
  woman: { heights: [1.56, 1.7], speed: [1.0, 1.6], swing: 0.45 },
  elder: { heights: [1.48, 1.6], speed: [0.45, 0.75], swing: 0.22 },
  kid: { heights: [0.92, 1.2], speed: [1.2, 2.1], swing: 0.65 },
  cop: {
    heights: [1.72, 1.82], speed: [1.0, 1.35], swing: 0.42,
    clothes: [0x1a2334], accent: [0x00c8ff],
  },
  medic: {
    heights: [1.7, 1.8], speed: [1.1, 1.4], swing: 0.42,
    clothes: [0xd8d5cc], accent: [0xff7a00],
  },
  vendor: {
    heights: [1.6, 1.78], speed: [0, 0], swing: 0,
    clothes: [0x3d3226, 0x2a3438], accent: [0xffe600, 0xff2975],
  },
};

const CLOTHES = [
  0x2a2d33, 0x3d2f2a, 0x223140, 0x40222e,
  0x2e3a2b, 0x4a4438, 0x20242c, 0x39312f,
];
const SKINS = [0xc9a284, 0xa8785a, 0x8a5a3c, 0x6b4530, 0xd9b294];
const NEON = [0x00e5ff, 0xff2975, 0xb96bff, 0x00ffd5, 0xffe600];

/* ---------- 步态动画 shader ---------- */

const VERT = /* glsl */ `
attribute float aPart;
attribute vec3 aClothes;
attribute vec3 aSkin;
attribute vec3 aAccent;
attribute float aSeed;
attribute float aGait;
attribute float aSwing;
uniform float uTime;
varying float vPart;
varying vec3 vClothes;
varying vec3 vSkin;
varying vec3 vAccent;
varying vec3 vNormal;
varying float vDist;

void main() {
  vPart = aPart;
  vClothes = aClothes;
  vSkin = aSkin;
  vAccent = aAccent;
  vNormal = normalize(mat3(instanceMatrix) * normal);

  vec3 p = position;
  float ph = uTime * aGait + aSeed * 17.0;
  float s = sin(ph) * aSwing;
  if (aPart > 1.5 && aPart < 2.5) {
    p.z += max(0.52 - p.y, 0.0) * 1.9 * s;          // 左腿
  } else if (aPart > 2.5 && aPart < 3.5) {
    p.z -= max(0.52 - p.y, 0.0) * 1.9 * s;          // 右腿
  } else if (aPart > 3.5 && aPart < 4.5) {
    p.z -= max(0.82 - p.y, 0.0) * 1.1 * s;          // 左臂反摆
  } else if (aPart > 4.5 && aPart < 5.5) {
    p.z += max(0.82 - p.y, 0.0) * 1.1 * s;          // 右臂
  }
  p.y += abs(sin(ph)) * 0.015 * step(0.01, aGait);  // 步行起伏

  vec4 world = instanceMatrix * vec4(p, 1.0);
  vec4 view = viewMatrix * world;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vPart;
varying vec3 vClothes;
varying vec3 vSkin;
varying vec3 vAccent;
varying vec3 vNormal;
varying float vDist;

void main() {
  vec3 n = normalize(vNormal);
  float lit = 0.5 + 0.4 * max(n.y, 0.0);
  vec3 col;
  if (vPart < 0.5) col = vClothes * lit;                     // 躯干/制服帽
  else if (vPart < 1.5) col = vSkin * lit;                   // 头
  else if (vPart < 3.5) col = vClothes * 0.55 * lit;         // 腿（裤色）
  else if (vPart < 5.5) col = vClothes * 0.85 * lit;         // 臂
  else if (vPart < 6.5) col = vAccent * 1.9;                 // 发光饰件
  else if (vPart < 7.5) col = vec3(0.22, 0.22, 0.24) * lit;  // 手杖
  else col = vec3(0.05, 0.045, 0.04) + vSkin * 0.08;         // 头发

  // 街道光晕染
  col += vec3(0.4, 0.25, 0.1) * 0.08;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------- 行人群 ---------- */

export interface StaticPed {
  kind: PedKind;
  x: number;
  z: number;
  yaw: number;
  lying?: boolean;
}

export interface PedFleetOptions {
  paths: THREE.Curve<THREE.Vector3>[];
  countPerPath: number;
  seed: number;
  statics?: StaticPed[];
}

interface Walker {
  pathIdx: number;
  t: number;
  speed: number;   // 参数比例/秒（含方向）
  lateral: number;
  height: number;
}

const KIND_ORDER: PedKind[] = ['man', 'woman', 'elder', 'kid', 'cop', 'medic', 'vendor'];
// 街头人群构成：普通市民为主，NCPD 巡逻占比小
const WALKER_WEIGHTS: Array<[PedKind, number]> = [
  ['man', 0.34], ['woman', 0.32], ['elder', 0.13], ['kid', 0.13], ['cop', 0.08],
];
const SAMPLES = 256;

export class PedFleet {
  group = new THREE.Group();
  meshes: THREE.InstancedMesh[] = [];
  private walkers: Walker[][] = [];
  private walkerCounts: number[] = [];
  private samples: THREE.Vector3[][] = [];
  private material: THREE.ShaderMaterial;

  constructor(opts: PedFleetOptions) {
    const rng: Rng = createRng(opts.seed >>> 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: new THREE.Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
      },
    });

    const buckets = new Map<PedKind, Array<{
      walker?: Walker; static_?: StaticPed; height: number;
    }>>();
    KIND_ORDER.forEach((k) => buckets.set(k, []));

    const pickWalkerKind = (): PedKind => {
      let r = rng();
      for (const [k, w] of WALKER_WEIGHTS) {
        r -= w;
        if (r <= 0) return k;
      }
      return 'man';
    };

    opts.paths.forEach((path, pathIdx) => {
      this.samples.push(path.getSpacedPoints(SAMPLES));
      const length = Math.max(path.getLength(), 1);
      for (let i = 0; i < opts.countPerPath; i++) {
        const kind = pickWalkerKind();
        const prof = PROFILES[kind];
        const dir = rng() < 0.5 ? 1 : -1;
        buckets.get(kind)!.push({
          height: range(rng, prof.heights[0], prof.heights[1]),
          walker: {
            pathIdx,
            t: rng(),
            speed: (range(rng, prof.speed[0], prof.speed[1]) / length) * dir,
            lateral: range(rng, -1.2, 1.2),
            height: 0,
          },
        });
      }
    });
    for (const s of opts.statics ?? []) {
      const prof = PROFILES[s.kind];
      buckets.get(s.kind)!.push({
        static_: s,
        height: range(rng, prof.heights[0], prof.heights[1]),
      });
    }

    const clothes = new THREE.Color();
    const skin = new THREE.Color();
    const accent = new THREE.Color();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const euler = new THREE.Euler();

    KIND_ORDER.forEach((kind) => {
      const list = buckets.get(kind)!;
      const prof = PROFILES[kind];
      const n = Math.max(list.length, 1);
      const mesh = new THREE.InstancedMesh(
        buildHumanGeometry(ARCHETYPES[kind]), this.material, n,
      );
      mesh.count = list.length;
      mesh.frustumCulled = false;

      const aClothes = new Float32Array(n * 3);
      const aSkin = new Float32Array(n * 3);
      const aAccent = new Float32Array(n * 3);
      const aSeed = new Float32Array(n);
      const aGait = new Float32Array(n);
      const aSwing = new Float32Array(n);
      const walkers: Walker[] = [];

      list.forEach((entry, i) => {
        clothes.setHex(prof.clothes ? pick(rng, prof.clothes) : pick(rng, CLOTHES));
        skin.setHex(pick(rng, SKINS));
        // 平民约 1/4 带霓虹饰件；制服类固定
        const accentHex = prof.accent
          ? pick(rng, prof.accent)
          : (rng() < 0.25 ? pick(rng, NEON) : 0x000000);
        accent.setHex(accentHex);
        aClothes.set([clothes.r, clothes.g, clothes.b], i * 3);
        aSkin.set([skin.r, skin.g, skin.b], i * 3);
        aAccent.set([accent.r, accent.g, accent.b], i * 3);
        aSeed[i] = range(rng, 0, 100);
        aSwing[i] = prof.swing;

        if (entry.walker) {
          entry.walker.height = entry.height;
          const stepRate = 5.2 / entry.height; // 个子越小步频越高
          aGait[i] = Math.abs(entry.walker.speed) > 1e-9 ? stepRate : 0;
          walkers.push(entry.walker);
        } else {
          aGait[i] = 0;
          const s = entry.static_!;
          pos.set(s.x, s.lying ? 0.14 : 0, s.z);
          if (s.lying) euler.set(-Math.PI / 2, 0, s.yaw);
          else euler.set(0, s.yaw, 0);
          quat.setFromEuler(euler);
          scl.setScalar(entry.height);
          m.compose(pos, quat, scl);
          mesh.setMatrixAt(i, m);
        }
      });
      // 行走者排在桶前部（构造顺序保证），静态在尾部一次性写入
      this.walkers.push(walkers);
      this.walkerCounts.push(walkers.length);

      const geo = mesh.geometry;
      geo.setAttribute('aClothes', new THREE.InstancedBufferAttribute(aClothes, 3));
      geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(aSkin, 3));
      geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(aAccent, 3));
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
      geo.setAttribute('aGait', new THREE.InstancedBufferAttribute(aGait, 1));
      geo.setAttribute('aSwing', new THREE.InstancedBufferAttribute(aSwing, 1));
      mesh.instanceMatrix.needsUpdate = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
    this.update(0, 0);
  }

  /** 质量降档：按比例隐藏行走者（静态场景人员保留在尾部不受影响） */
  setDensity(fraction: number): void {
    const hide = new THREE.Matrix4().makeTranslation(0, -500, 0);
    this.meshes.forEach((mesh, k) => {
      const target = Math.floor(this.walkerCounts[k] * fraction);
      const prev = this.visibleWalkers[k] ?? this.walkerCounts[k];
      for (let i = target; i < prev; i++) mesh.setMatrixAt(i, hide);
      if (target < prev) mesh.instanceMatrix.needsUpdate = true;
      this.visibleWalkers[k] = target;
    });
  }

  private visibleWalkers: number[] = [];

  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private scl = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private ahead = new THREE.Vector3();

  update(dt: number, t: number): void {
    this.material.uniforms.uTime.value = t;
    const EPS = 2 / SAMPLES;
    this.meshes.forEach((mesh, k) => {
      const walkers = this.walkers[k];
      const visible = this.visibleWalkers[k] ?? walkers.length;
      for (let i = 0; i < Math.min(visible, walkers.length); i++) {
        const w = walkers[i];
        w.t = ((w.t + w.speed * dt) % 1 + 1) % 1;
        const pts = this.samples[w.pathIdx];
        sampleAt(pts, w.t, this.pos);
        sampleAt(pts, ((w.t + EPS * Math.sign(w.speed || 1)) % 1 + 1) % 1, this.ahead);
        const dx = this.ahead.x - this.pos.x;
        const dz = this.ahead.z - this.pos.z;
        const yaw = Math.atan2(dx, dz);
        const len = Math.hypot(dx, dz) || 1;
        this.pos.x += (dz / len) * w.lateral;
        this.pos.z += (-dx / len) * w.lateral;
        this.quat.setFromAxisAngle(UP, yaw);
        this.scl.setScalar(w.height);
        this.m.compose(this.pos, this.quat, this.scl);
        mesh.setMatrixAt(i, this.m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
function sampleAt(pts: THREE.Vector3[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const f = t * (pts.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  tmpA.copy(pts[Math.min(i + 1, pts.length - 1)]);
  return out.copy(pts[i]).lerp(tmpA, k);
}
