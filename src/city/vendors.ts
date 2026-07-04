import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range, pick, Rng } from '../core/rng';
import { districtAt, DistrictId } from './districts';
import { coastXAt } from './water';
import { StaticPed } from '../people/pedestrians';

const ROAD_SPACING = 480;
const STALL_LINE = 14 + 4.6;   // 人行道外缘
const CITY_RADIUS = 3200;

// 商贩聚集区（按城市设定：Kabuki 夜市最密，市中心几乎没有地摊）
const VENDOR_WEIGHT: Partial<Record<DistrictId, number>> = {
  watson: 1.0, westbrook: 0.6, heywood: 0.55, 'santo-domingo': 0.4, pacifica: 0.25,
};

export interface VendorSpot {
  x: number;
  z: number;
  yaw: number;
}

/** 沿人行道挑选摊位点（面向马路） */
export function pickVendorSpots(seed: number, max = 120): VendorSpot[] {
  const rng = createRng((seed ^ 0xf00d) >>> 0);
  const spots: VendorSpot[] = [];
  for (let k = -6; k <= 6 && spots.length < max; k++) {
    const c = k * ROAD_SPACING;
    if (Math.abs(c) >= CITY_RADIUS || c < -1900) continue;
    for (let v = -CITY_RADIUS; v < CITY_RADIUS; v += 90) {
      if (spots.length >= max) break;
      if (Math.hypot(c, v) > CITY_RADIUS) continue;
      // 沿 z 的路东西两侧
      const side = rng() < 0.5 ? 1 : -1;
      const x = c + side * STALL_LINE;
      const z = v + range(rng, -30, 30);
      if (x < coastXAt(z) + 60) continue;
      const d = districtAt(x, z);
      if (!d) continue;
      const w = VENDOR_WEIGHT[d.id] ?? 0;
      if (rng() > w * 0.24) continue;
      spots.push({ x, z, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  }
  return spots;
}

export interface Vendors {
  group: THREE.Group;
  statics: StaticPed[];
  update(dt: number, t: number): void;
}

/** 沿街小吃/杂货摊：柜台 + 雨棚 + 发光招牌 + 暖光灯，摊主站位交给 PedFleet */
export function createVendors(seed: number): Vendors {
  const rng: Rng = createRng((seed ^ 0xf00e) >>> 0);
  const spots = pickVendorSpots(seed);
  const group = new THREE.Group();
  const statics: StaticPed[] = [];

  const darks: THREE.BufferGeometry[] = [];
  const glowsByColor = new Map<number, THREE.BufferGeometry[]>();
  const warms: THREE.BufferGeometry[] = [];
  const NEON = [0xffe600, 0xff2975, 0x00ffd5, 0xff6a00, 0x00e5ff];

  const push = (arr: THREE.BufferGeometry[], g: THREE.BufferGeometry,
    x: number, z: number, yaw: number) => {
    g.rotateY(yaw);
    g.translate(x, 0, z);
    arr.push(g);
  };

  for (const s of spots) {
    const accent = pick(rng, NEON);
    // 柜台 + 顶棚 + 支柱（摊主在柜台后，面向马路）
    const counter = new THREE.BoxGeometry(2.6, 1.05, 1.1);
    counter.translate(0, 0.53, 0);
    push(darks, counter, s.x, s.z, s.yaw);
    const roof = new THREE.BoxGeometry(3.1, 0.09, 1.9);
    roof.translate(0, 2.15, 0.1);
    push(darks, roof, s.x, s.z, s.yaw);
    for (const px of [-1.4, 1.4]) {
      const pole = new THREE.BoxGeometry(0.07, 2.1, 0.07);
      pole.translate(px, 1.05, 0.75);
      push(darks, pole, s.x, s.z, s.yaw);
    }
    // 招牌（雨棚前沿发光条）
    const sign = new THREE.BoxGeometry(2.9, 0.3, 0.06);
    sign.translate(0, 1.95, 1.06);
    const bucket = glowsByColor.get(accent) ?? [];
    bucket.push(sign);
    push(bucket, sign, s.x, s.z, s.yaw);
    glowsByColor.set(accent, bucket);
    // 台面暖光（食摊灯）
    const lamp = new THREE.BoxGeometry(1.9, 0.05, 0.5);
    lamp.translate(0, 1.7, 0.2);
    push(warms, lamp, s.x, s.z, s.yaw);

    // 摊主 + 偶发顾客
    const bx = s.x - Math.sin(s.yaw) * 1.1;
    const bz = s.z - Math.cos(s.yaw) * 1.1;
    statics.push({ kind: 'vendor', x: bx, z: bz, yaw: s.yaw });
    if (rng() < 0.5) {
      statics.push({
        kind: rng() < 0.5 ? 'man' : 'woman',
        x: s.x + Math.sin(s.yaw) * 1.6 + range(rng, -0.8, 0.8),
        z: s.z + Math.cos(s.yaw) * 1.6 + range(rng, -0.8, 0.8),
        yaw: s.yaw + Math.PI + range(rng, -0.4, 0.4),
      });
    }
  }

  if (darks.length > 0) {
    const mesh = new THREE.Mesh(
      mergeGeometries(darks),
      new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.8, metalness: 0.3 }),
    );
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  for (const [color, geos] of glowsByColor) {
    // push 时 sign 被塞进 bucket 两次的防御去重
    const unique = [...new Set(geos)];
    const mesh = new THREE.Mesh(
      mergeGeometries(unique),
      new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: color, emissiveIntensity: 1.9,
      }),
    );
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  if (warms.length > 0) {
    const mesh = new THREE.Mesh(
      mergeGeometries(warms),
      new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: 0xffb35c, emissiveIntensity: 1.3,
      }),
    );
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  return { group, statics, update() { /* 静态场景 */ } };
}
