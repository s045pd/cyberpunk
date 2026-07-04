import * as THREE from 'three';
import { createRng, range, pick, Rng } from '../core/rng';
import { districtAt, DistrictId } from '../city/districts';
import { LANDMARK_CLEARINGS } from '../city/anchors';
import { coastXAt } from '../city/water';
import { StaticPed } from '../people/pedestrians';
import {
  buildVehicleGeometry, createVehicleMaterial, POLICE_PALETTE,
} from '../traffic/vehicles';

const ROAD_SPACING = 480;

export interface IncidentSite {
  x: number;          // 所在路口
  z: number;
  sx: number;         // 现场中心（路口人行道角）
  sz: number;
  kind: 'crime' | 'rescue';
  district: DistrictId;
}

// 治安差的区域事件多发 —— 严格按设定：Pacifica/Watson/Santo Domingo 高危
const CRIME_DISTRICTS: DistrictId[] = ['pacifica', 'watson', 'santo-domingo', 'heywood'];
const RESCUE_DISTRICTS: DistrictId[] = ['watson', 'westbrook', 'city-center', 'heywood'];

/** 纯逻辑、可单测：在路口挑选事件现场 */
export function pickIncidentSites(
  seed: number, crimeCount = 6, rescueCount = 3,
): IncidentSite[] {
  const rng = createRng((seed ^ 0x1c1d) >>> 0);
  const candidates: Array<{ x: number; z: number; district: DistrictId }> = [];
  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      const x = i * ROAD_SPACING;
      const z = j * ROAD_SPACING;
      if (Math.hypot(x, z) > 2900) continue;
      if (x < coastXAt(z) + 150) continue;
      if (LANDMARK_CLEARINGS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 60)) continue;
      const d = districtAt(x, z);
      if (!d) continue;
      candidates.push({ x, z, district: d.id });
    }
  }
  // 洗牌（种子确定）
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const sites: IncidentSite[] = [];
  const used = new Set<number>();
  const take = (kind: 'crime' | 'rescue', count: number, allowed: DistrictId[]) => {
    for (let ci = 0; ci < candidates.length && count > 0; ci++) {
      if (used.has(ci)) continue;
      const c = candidates[ci];
      if (!allowed.includes(c.district)) continue;
      if (sites.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 700)) continue;
      used.add(ci);
      const cornerX = pick(rng, [1, -1] as const) * 9;
      const cornerZ = pick(rng, [1, -1] as const) * 9;
      sites.push({
        x: c.x, z: c.z,
        sx: c.x + cornerX, sz: c.z + cornerZ,
        kind, district: c.district,
      });
      count--;
    }
  };
  take('crime', crimeCount, CRIME_DISTRICTS);
  take('rescue', rescueCount, RESCUE_DISTRICTS);
  return sites;
}

/* ---------- 现场搭建 ---------- */

export interface Incidents {
  group: THREE.Group;
  statics: StaticPed[];       // 交给 PedFleet 渲染的现场人员
  sites: IncidentSite[];
  update(dt: number, t: number): void;
}

function cordon(
  cx: number, cz: number, half: number, color: number,
): THREE.BufferGeometry[] {
  // 四角立柱 + 四边悬浮警戒光带（几何合并前着色靠材质分组，这里只产出光带）
  const strips: THREE.BufferGeometry[] = [];
  void color;
  const segs: Array<[number, number, number, number, number]> = [
    [cx, cz - half, half * 2, 0.28, 0],
    [cx, cz + half, half * 2, 0.28, 0],
    [cx - half, cz, half * 2, 0.28, Math.PI / 2],
    [cx + half, cz, half * 2, 0.28, Math.PI / 2],
  ];
  for (const [x, z, len, h, yaw] of segs) {
    const g = new THREE.BoxGeometry(len, h, 0.04);
    g.rotateY(yaw);
    g.translate(x, 1.05, z);
    strips.push(g);
  }
  return strips;
}

function posts(cx: number, cz: number, half: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const g = new THREE.BoxGeometry(0.1, 1.2, 0.1);
    g.translate(cx + dx * half, 0.6, cz + dz * half);
    out.push(g);
  }
  return out;
}

export function createIncidents(sites: IncidentSite[], seed: number): Incidents {
  const rng: Rng = createRng((seed ^ 0x5cee) >>> 0);
  const group = new THREE.Group();
  const statics: StaticPed[] = [];

  const crimeStrips: THREE.BufferGeometry[] = [];
  const rescueStrips: THREE.BufferGeometry[] = [];
  const postGeos: THREE.BufferGeometry[] = [];
  const padGeos: THREE.BufferGeometry[] = [];

  const crimes = sites.filter((s) => s.kind === 'crime');
  const rescues = sites.filter((s) => s.kind === 'rescue');

  for (const s of crimes) {
    crimeStrips.push(...cordon(s.sx, s.sz, 6.5, 0));
    postGeos.push(...posts(s.sx, s.sz, 6.5));
    // 现场人员：3 名 NCPD + 1 名倒地者 + 2 名围观
    statics.push(
      { kind: 'cop', x: s.sx - 2, z: s.sz - 1.5, yaw: range(rng, 0, 6.28) },
      { kind: 'cop', x: s.sx + 2.2, z: s.sz + 1, yaw: range(rng, 0, 6.28) },
      { kind: 'cop', x: s.sx - 0.5, z: s.sz + 2.6, yaw: range(rng, 0, 6.28) },
      { kind: 'man', x: s.sx, z: s.sz, yaw: range(rng, 0, 6.28), lying: true },
      { kind: 'woman', x: s.sx - 7.8, z: s.sz + 1, yaw: Math.atan2(8.6, -1) },
      { kind: 'man', x: s.sx + 1, z: s.sz - 8, yaw: Math.atan2(-1, 8.8) },
    );
  }
  for (const s of rescues) {
    rescueStrips.push(...cordon(s.sx, s.sz, 7, 0));
    postGeos.push(...posts(s.sx, s.sz, 7));
    // 着陆环
    const pad = new THREE.TorusGeometry(5.2, 0.16, 6, 40);
    pad.rotateX(Math.PI / 2);
    pad.translate(s.sx, 0.25, s.sz);
    padGeos.push(pad);
    statics.push(
      { kind: 'medic', x: s.sx - 1.6, z: s.sz - 1.2, yaw: range(rng, 0, 6.28) },
      { kind: 'medic', x: s.sx + 1.8, z: s.sz + 0.6, yaw: range(rng, 0, 6.28) },
      { kind: 'man', x: s.sx + 0.2, z: s.sz - 0.4, yaw: range(rng, 0, 6.28), lying: true },
    );
  }

  const merge = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (geos.length === 0) return;
    const merged = mergeStatic(geos);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  merge(crimeStrips, new THREE.MeshBasicMaterial({
    color: 0xffe600, transparent: true, opacity: 0.85,
  }));
  merge(rescueStrips, new THREE.MeshBasicMaterial({
    color: 0xff7a00, transparent: true, opacity: 0.85,
  }));
  merge(postGeos, new THREE.MeshStandardMaterial({
    color: 0x15171c, roughness: 0.7, metalness: 0.4,
  }));
  merge(padGeos, new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xff7a00, emissiveIntensity: 1.6,
  }));

  // 停在各犯罪现场路边的警车（灯条闪烁）
  const carMat = createVehicleMaterial();
  const cars = new THREE.InstancedMesh(
    buildVehicleGeometry('police'), carMat, Math.max(crimes.length, 1),
  );
  cars.count = crimes.length;
  cars.frustumCulled = false;
  const aBody = new Float32Array(Math.max(crimes.length, 1) * 3);
  const aAccent = new Float32Array(Math.max(crimes.length, 1) * 3);
  const aSeed = new Float32Array(Math.max(crimes.length, 1));
  const body = new THREE.Color();
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  crimes.forEach((s, i) => {
    // 车停在现场旁的路缘（朝向沿路）
    const alongX = Math.abs(s.sx - s.x) < Math.abs(s.sz - s.z);
    pos.set(
      alongX ? s.x + range(rng, -5, 5) : s.sx + 11,
      0.05,
      alongX ? s.sz + 11 : s.z + range(rng, -5, 5),
    );
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? Math.PI / 2 : 0);
    m.compose(pos, quat, new THREE.Vector3(1, 1, 1));
    cars.setMatrixAt(i, m);
    body.setHex(POLICE_PALETTE[0]);
    aBody.set([body.r, body.g, body.b], i * 3);
    aAccent.set([0, 0.8, 1], i * 3);
    aSeed[i] = range(rng, 0, 100);
  });
  cars.geometry.setAttribute('aBody', new THREE.InstancedBufferAttribute(aBody, 3));
  cars.geometry.setAttribute('aAccent', new THREE.InstancedBufferAttribute(aAccent, 3));
  cars.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  cars.instanceMatrix.needsUpdate = true;
  group.add(cars);

  return {
    group,
    statics,
    sites,
    update(_dt: number, t: number) {
      carMat.uniforms.uTime.value = t;
    },
  };
}

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
function mergeStatic(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(geos);
}
