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
    if (c > westLimit) {
      for (const side of [-1, 1]) {
        paths.push(new THREE.LineCurve3(
          new THREE.Vector3(c + side * SIDEWALK_OFFSET, 0, -half),
          new THREE.Vector3(c + side * SIDEWALK_OFFSET, 0, half),
        ));
      }
    }
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
  badge?: boolean;   // 胸前发光徽章
}

function buildHumanGeometry(o: HumanOpts): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hipY = 0.52;
  const legW = o.shoulder * 0.32;
  parts.push(
    partBox(o.shoulder, 0.34, 0.15, 0, hipY + 0.17, 0, 0),
    partBox(o.head, o.head, o.head, 0, 0.9, 0, 1),
    partBox(legW, hipY, legW * 1.1, -o.shoulder * 0.22, hipY / 2, 0, 2),
    partBox(legW, hipY, legW * 1.1, o.shoulder * 0.22, hipY / 2, 0, 3),
    partBox(0.05, 0.36, 0.06, -(o.shoulder / 2 + 0.035), 0.66, 0, 4),
    partBox(0.05, 0.36, 0.06, o.shoulder / 2 + 0.035, 0.66, 0, 5),
  );
  if (o.hairLen > 0) {
    parts.push(partBox(o.head * 1.08, o.hairLen, o.head * 0.5,
      0, 0.9 + o.head / 2 - o.hairLen / 2, -o.head * 0.42, 8));
  } else {
    parts.push(partBox(o.head * 1.06, 0.035, o.head * 1.06,
      0, 0.9 + o.head / 2 + 0.017, 0, o.cap ? 0 : 8));
  }
  if (o.cap) {
    parts.push(partBox(o.head * 1.1, 0.02, o.head * 0.5,
      0, 0.9 + o.head / 2, o.head * 0.55, 0));
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
  clothes?: number[];
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
// 右侧通行车道（相对行进方向向右偏移）——对向人流天然分离，实现避让
const LANE_SLOTS = [0.35, 0.75, 1.15, 1.55];

/* ---------- GPU 步行 shader：位置沿直线路径推进，CPU 零开销 ---------- */

const VERT = /* glsl */ `
attribute float aPart;
attribute vec3 aClothes;
attribute vec3 aSkin;
attribute vec3 aAccent;
attribute vec3 aAnim;      // (seed, 步频/米, 摆幅)，步频 0 = 静止
attribute vec4 aPath;      // (起点 x, 起点 z, 方向 x, 方向 z)
attribute vec4 aMove;      // (路径长, 初始里程, 米/秒, 右侧偏移)
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

  float walked = aMove.y + aMove.z * uTime;
  float d = mod(walked, max(aMove.x, 1.0));
  vec2 base = aPath.xy + aPath.zw * d + vec2(aPath.w, -aPath.z) * aMove.w;

  vec3 p = position;
  float ph = walked * aAnim.y + aAnim.x * 17.0;
  float s = sin(ph) * aAnim.z;
  if (aPart > 1.5 && aPart < 2.5) {
    p.z += max(0.52 - p.y, 0.0) * 1.9 * s;
  } else if (aPart > 2.5 && aPart < 3.5) {
    p.z -= max(0.52 - p.y, 0.0) * 1.9 * s;
  } else if (aPart > 3.5 && aPart < 4.5) {
    p.z -= max(0.82 - p.y, 0.0) * 1.1 * s;
  } else if (aPart > 4.5 && aPart < 5.5) {
    p.z += max(0.82 - p.y, 0.0) * 1.1 * s;
  }

  vec4 world = instanceMatrix * vec4(p, 1.0);
  world.x += base.x;
  world.z += base.y;
  world.y += abs(sin(ph)) * 0.02 * step(0.01, aAnim.y);
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
  if (vPart < 0.5) col = vClothes * lit;
  else if (vPart < 1.5) col = vSkin * lit;
  else if (vPart < 3.5) col = vClothes * 0.55 * lit;
  else if (vPart < 5.5) col = vClothes * 0.85 * lit;
  else if (vPart < 6.5) col = vAccent * 1.9;
  else if (vPart < 7.5) col = vec3(0.22, 0.22, 0.24) * lit;
  else col = vec3(0.05, 0.045, 0.04) + vSkin * 0.08;

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

export interface PedLane {
  curve: THREE.LineCurve3;
  count: number;
}

export interface PedFleetOptions {
  lanes: PedLane[];
  seed: number;
  statics?: StaticPed[];
}

const KIND_ORDER: PedKind[] = ['man', 'woman', 'elder', 'kid', 'cop', 'medic', 'vendor'];
// 街头人群构成：普通市民为主，NCPD 巡逻占比小
const WALKER_WEIGHTS: Array<[PedKind, number]> = [
  ['man', 0.34], ['woman', 0.32], ['elder', 0.13], ['kid', 0.13], ['cop', 0.08],
];

interface PedEntry {
  height: number;
  static_?: StaticPed;
  walker?: {
    start: THREE.Vector3;
    dir: THREE.Vector2;
    len: number;
    t0: number;
    speed: number;
    lateral: number;
    yaw: number;
  };
}

export class PedFleet {
  group = new THREE.Group();
  meshes: THREE.InstancedMesh[] = [];
  private staticCounts: number[] = [];
  private walkerCounts: number[] = [];
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

    // 静态人员排在桶前部（setDensity 截尾只隐藏行走者）
    const buckets = new Map<PedKind, PedEntry[]>();
    KIND_ORDER.forEach((k) => buckets.set(k, []));

    for (const s of opts.statics ?? []) {
      const prof = PROFILES[s.kind];
      buckets.get(s.kind)!.push({
        static_: s,
        height: range(rng, prof.heights[0], prof.heights[1]),
      });
    }

    const pickWalkerKind = (): PedKind => {
      let r = rng();
      for (const [k, w] of WALKER_WEIGHTS) {
        r -= w;
        if (r <= 0) return k;
      }
      return 'man';
    };

    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    for (const lane of opts.lanes) {
      lane.curve.getPoint(0, p0);
      lane.curve.getPoint(1, p1);
      const len = p0.distanceTo(p1);
      for (let i = 0; i < lane.count; i++) {
        const kind = pickWalkerKind();
        const prof = PROFILES[kind];
        const reverse = rng() < 0.5;
        const dir = new THREE.Vector2(
          (p1.x - p0.x) / len, (p1.z - p0.z) / len,
        );
        if (reverse) dir.multiplyScalar(-1);
        const start = reverse ? p1.clone() : p0.clone();
        buckets.get(kind)!.push({
          height: range(rng, prof.heights[0], prof.heights[1]),
          walker: {
            start,
            dir,
            len,
            t0: rng() * len,
            speed: range(rng, prof.speed[0], prof.speed[1]),
            lateral: pick(rng, LANE_SLOTS) + range(rng, -0.12, 0.12),
            yaw: Math.atan2(dir.x, dir.y),
          },
        });
      }
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
      const aAnim = new Float32Array(n * 3);
      const aPath = new Float32Array(n * 4);
      const aMove = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) aMove[i * 4] = 1; // len 默认 1
      let statics = 0;
      let walkers = 0;

      list.forEach((entry, i) => {
        clothes.setHex(prof.clothes ? pick(rng, prof.clothes) : pick(rng, CLOTHES));
        skin.setHex(pick(rng, SKINS));
        const accentHex = prof.accent
          ? pick(rng, prof.accent)
          : (rng() < 0.25 ? pick(rng, NEON) : 0x000000);
        accent.setHex(accentHex);
        aClothes.set([clothes.r, clothes.g, clothes.b], i * 3);
        aSkin.set([skin.r, skin.g, skin.b], i * 3);
        aAccent.set([accent.r, accent.g, accent.b], i * 3);
        aAnim.set([range(rng, 0, 100), 0, prof.swing], i * 3);

        if (entry.walker) {
          const w = entry.walker;
          aAnim[i * 3 + 1] = 7.4 / entry.height;   // 步频随身高
          aPath.set([w.start.x, w.start.z, w.dir.x, w.dir.y], i * 4);
          aMove.set([w.len, w.t0, w.speed, w.lateral], i * 4);
          pos.set(0, 0, 0);
          euler.set(0, w.yaw, 0);
          walkers++;
        } else {
          const s = entry.static_!;
          pos.set(s.x, s.lying ? 0.14 : 0, s.z);
          if (s.lying) euler.set(-Math.PI / 2, 0, s.yaw);
          else euler.set(0, s.yaw, 0);
          statics++;
        }
        quat.setFromEuler(euler);
        scl.setScalar(entry.height);
        m.compose(pos, quat, scl);
        mesh.setMatrixAt(i, m);
      });

      const geo = mesh.geometry;
      geo.setAttribute('aClothes', new THREE.InstancedBufferAttribute(aClothes, 3));
      geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(aSkin, 3));
      geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(aAccent, 3));
      geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(aAnim, 3));
      geo.setAttribute('aPath', new THREE.InstancedBufferAttribute(aPath, 4));
      geo.setAttribute('aMove', new THREE.InstancedBufferAttribute(aMove, 4));
      mesh.instanceMatrix.needsUpdate = true;
      this.staticCounts.push(statics);
      this.walkerCounts.push(walkers);
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
  }

  /** 质量降档：截尾隐藏行走者，静态场景人员保留（在桶前部） */
  setDensity(fraction: number): void {
    this.meshes.forEach((mesh, k) => {
      mesh.count = this.staticCounts[k]
        + Math.floor(this.walkerCounts[k] * fraction);
    });
  }

  /** 位移在 GPU：每帧仅推进时间 uniform */
  update(_dt: number, t: number): void {
    this.material.uniforms.uTime.value = t;
  }
}
