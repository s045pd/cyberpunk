import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range, pick, Rng } from '../core/rng';
import { AABB } from '../core/collision';
import { StaticPed } from '../people/pedestrians';

// 市场占据 Watson 的一个街区中央（与 anchors.ts 的 kabuki-market 净空一致）
export const MARKET_CENTER = { x: 720, z: -2640 };
export const MARKET_HALF = 68;          // 市场半宽
const ROW_PITCH = 9;                    // 摊位排间距
const STALL_D = 2.4;                    // 单摊进深（背靠背 ×2）
export const ALLEY_W = ROW_PITCH - STALL_D * 2; // 巷宽 4.2m

export interface MarketLane {
  curve: THREE.LineCurve3;
  count: number;
}

export interface KabukiLayout {
  rows: Array<{ x: number; z0: number; z1: number }>; // 摊位排（沿 z）
  lanes: MarketLane[];                                 // 巷道人流路径
}

/** 纯逻辑、可单测：摊位排与巷道布局 */
export function buildKabukiLayout(): KabukiLayout {
  const rows: KabukiLayout['rows'] = [];
  const lanes: MarketLane[] = [];
  const { x: cx, z: cz } = MARKET_CENTER;
  const half = MARKET_HALF;
  const nRows = Math.floor((half * 2) / ROW_PITCH); // 15 排

  for (let i = 0; i <= nRows; i++) {
    const x = cx - half + i * ROW_PITCH;
    if (i < nRows) {
      // 摊位排（中间留一条横向大道）
      rows.push({ x: x + ROW_PITCH / 2, z0: cz - half, z1: cz - 8 });
      rows.push({ x: x + ROW_PITCH / 2, z0: cz + 8, z1: cz + half });
    }
    // 巷道（排与排之间）
    lanes.push({
      curve: new THREE.LineCurve3(
        new THREE.Vector3(x, 0, cz - half),
        new THREE.Vector3(x, 0, cz + half),
      ),
      count: 26,
    });
  }
  // 中央横向大道
  lanes.push({
    curve: new THREE.LineCurve3(
      new THREE.Vector3(cx - half, 0, cz),
      new THREE.Vector3(cx + half, 0, cz),
    ),
    count: 40,
  });
  return { rows, lanes };
}

export interface KabukiMarket {
  group: THREE.Group;
  statics: StaticPed[];
  lanes: MarketLane[];
  colliders: AABB[];
  update(dt: number, t: number): void;
}

const NEON = [0xff2975, 0xffe600, 0x00ffd5, 0xff6a00, 0x00e5ff];

/** Kabuki 夜市：背靠背摊位排、窄巷、灯笼串、密集人流 */
export function createKabukiMarket(seed: number): KabukiMarket {
  const rng: Rng = createRng((seed ^ 0x4ab1) >>> 0);
  const layout = buildKabukiLayout();
  const group = new THREE.Group();
  const statics: StaticPed[] = [];
  const colliders: AABB[] = [];

  const darks: THREE.BufferGeometry[] = [];
  const warms: THREE.BufferGeometry[] = [];
  const lanterns: THREE.BufferGeometry[] = [];
  const signsByColor = new Map<number, THREE.BufferGeometry[]>();

  const box = (
    arr: THREE.BufferGeometry[],
    w: number, h: number, d: number, x: number, y: number, z: number,
  ) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    arr.push(g);
  };

  for (const row of layout.rows) {
    const len = row.z1 - row.z0;
    // 整排结构：双面柜台 + 顶棚
    box(darks, STALL_D * 2, 1.0, len, row.x, 0.5, (row.z0 + row.z1) / 2);
    box(darks, STALL_D * 2 + 0.8, 0.08, len, row.x, 2.3, (row.z0 + row.z1) / 2);
    colliders.push({
      minX: row.x - STALL_D, maxX: row.x + STALL_D,
      minZ: row.z0, maxZ: row.z1,
    });
    // 沿排的发光招牌段 + 台面暖光 + 摊主/顾客
    for (let z = row.z0 + 2; z < row.z1 - 2; z += range(rng, 5, 9)) {
      const color = pick(rng, NEON);
      const bucket = signsByColor.get(color) ?? [];
      const side = rng() < 0.5 ? 1 : -1;
      const sg = new THREE.BoxGeometry(0.06, 0.42, range(rng, 1.6, 3));
      sg.translate(row.x + side * (STALL_D + 0.42), 2.05, z);
      bucket.push(sg);
      signsByColor.set(color, bucket);
      box(warms, 1.6, 0.05, 1.2, row.x + side * (STALL_D * 0.5), 1.75, z);
      if (rng() < 0.55) {
        statics.push({
          kind: 'vendor',
          x: row.x, z: z + range(rng, -1, 1),
          yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        });
      }
      if (rng() < 0.4) {
        statics.push({
          kind: pick(rng, ['man', 'woman', 'elder', 'kid'] as const),
          x: row.x + side * (STALL_D + 1.1), z: z + range(rng, -0.8, 0.8),
          yaw: (side > 0 ? Math.PI / 2 : -Math.PI / 2) + range(rng, -0.4, 0.4),
        });
      }
    }
  }

  // 灯笼串：横跨巷道，每 8m 一串
  const { z: cz } = MARKET_CENTER;
  for (const lane of layout.lanes.slice(0, -1)) {
    const x = lane.curve.v1.x;
    for (let z = cz - MARKET_HALF + 4; z < cz + MARKET_HALF - 4; z += 8) {
      for (let k = -1; k <= 1; k++) {
        box(lanterns, 0.22, 0.3, 0.22, x + k * 1.2, 2.6 - Math.abs(k) * 0.18, z);
      }
    }
  }

  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (geos.length === 0) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  add(darks, new THREE.MeshStandardMaterial({
    color: 0x1e1a16, roughness: 0.8, metalness: 0.25,
  }));
  add(warms, new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xffb35c, emissiveIntensity: 1.4,
  }));
  add(lanterns, new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xff5030, emissiveIntensity: 1.7,
  }));
  for (const [color, geos] of signsByColor) {
    add(geos, new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: color, emissiveIntensity: 2.0,
    }));
  }

  return {
    group, statics, lanes: layout.lanes, colliders,
    update() { /* 静态 */ },
  };
}
