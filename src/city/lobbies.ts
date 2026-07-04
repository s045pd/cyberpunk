import * as THREE from 'three';
import { Plot, distToRoad } from './layout';
import { AABB } from '../core/collision';

export const LOBBY_H = 4.2;
const WALL_T = 0.5;
const DOOR_W = 3.4;

export interface DoorInfo {
  axisX: boolean;   // true: 门开在 ±x 面
  side: 1 | -1;     // 朝向哪一侧的路
}

/** 纯逻辑、可单测：门朝最近的路 */
export function doorInfoFor(p: Pick<Plot, 'x' | 'z' | 'sx' | 'sz'>): DoorInfo {
  const gapX = distToRoad(p.x) - p.sx / 2;
  const gapZ = distToRoad(p.z) - p.sz / 2;
  const axisX = gapX <= gapZ;
  const v = axisX ? p.x : p.z;
  const r = ((v % 480) + 480) % 480;
  const side: 1 | -1 = r < 240 ? -1 : 1;
  return { axisX, side };
}

export interface ElevatorZone {
  aabb: AABB;                 // 触发区（大堂内电梯前）
  roof: AABB;                 // 天台可行走范围
  h: number;                  // 楼顶高度
}

export interface Lobbies {
  group: THREE.Group;
  colliders: AABB[];
  zones: ElevatorZone[];
}

/**
 * 全城通用大堂：每栋楼一层挑空（楼体从 LOBBY_H 起浮，见 buildings.ts 的 y 重映射），
 * 五段墙留出临街门洞 + 发光门框 + 天花灯 + 玻璃观光电梯位。
 */
export function createLobbies(plots: Plot[]): Lobbies {
  const group = new THREE.Group();
  const colliders: AABB[] = [];
  const zones: ElevatorZone[] = [];

  const n = plots.length;
  const walls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.65, metalness: 0.45 }),
    n * 5,
  );
  const doorGlows = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0x00e5ff, emissiveIntensity: 1.9,
    }),
    n * 3,
  );
  const ceilLights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xdfe8ee, emissiveIntensity: 1.3,
    }),
    n,
  );
  const elevCabs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.4, metalness: 0.7 }),
    n * 2,
  );
  const elevGlows = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffd9a0, emissiveIntensity: 1.5,
    }),
    n,
  );
  for (const mesh of [walls, doorGlows, ceilLights, elevCabs, elevGlows]) {
    mesh.frustumCulled = false;
  }

  const m = new THREE.Matrix4();
  const setBox = (
    mesh: THREE.InstancedMesh, i: number,
    cx: number, cy: number, cz: number, w: number, h: number, d: number,
  ) => {
    m.makeScale(w, h, d);
    m.setPosition(cx, cy, cz);
    mesh.setMatrixAt(i, m);
  };
  const aabb = (cx: number, cz: number, w: number, d: number): AABB => ({
    minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2,
  });

  let wi = 0;
  let gi = 0;
  let ei = 0;
  plots.forEach((p, pi) => {
    const { axisX, side } = doorInfoFor(p);
    const hx = p.sx / 2;
    const hz = p.sz / 2;

    // ---- 五段墙（门墙两段 + 后墙 + 两侧墙） ----
    interface W { cx: number; cz: number; w: number; d: number; }
    const list: W[] = [];
    if (axisX) {
      const wx = p.x + side * (hx - WALL_T / 2);
      const segD = Math.max((p.sz - DOOR_W) / 2, 0.4);
      list.push(
        { cx: wx, cz: p.z - (DOOR_W / 2 + segD / 2), w: WALL_T, d: segD },
        { cx: wx, cz: p.z + (DOOR_W / 2 + segD / 2), w: WALL_T, d: segD },
        { cx: p.x - side * (hx - WALL_T / 2), cz: p.z, w: WALL_T, d: p.sz },
        { cx: p.x, cz: p.z - hz + WALL_T / 2, w: p.sx, d: WALL_T },
        { cx: p.x, cz: p.z + hz - WALL_T / 2, w: p.sx, d: WALL_T },
      );
    } else {
      const wz = p.z + side * (hz - WALL_T / 2);
      const segW = Math.max((p.sx - DOOR_W) / 2, 0.4);
      list.push(
        { cx: p.x - (DOOR_W / 2 + segW / 2), cz: wz, w: segW, d: WALL_T },
        { cx: p.x + (DOOR_W / 2 + segW / 2), cz: wz, w: segW, d: WALL_T },
        { cx: p.x, cz: p.z - side * (hz - WALL_T / 2), w: p.sx, d: WALL_T },
        { cx: p.x - hx + WALL_T / 2, cz: p.z, w: WALL_T, d: p.sz },
        { cx: p.x + hx - WALL_T / 2, cz: p.z, w: WALL_T, d: p.sz },
      );
    }
    for (const w of list) {
      setBox(walls, wi++, w.cx, LOBBY_H / 2, w.cz, w.w, LOBBY_H, w.d);
      colliders.push(aabb(w.cx, w.cz, w.w, w.d));
    }

    // ---- 门框光柱 ×2 + 门头横梁 ----
    const dx = axisX ? p.x + side * hx : p.x;
    const dz = axisX ? p.z : p.z + side * hz;
    if (axisX) {
      setBox(doorGlows, gi++, dx, 1.7, dz - DOOR_W / 2, 0.16, 3.4, 0.16);
      setBox(doorGlows, gi++, dx, 1.7, dz + DOOR_W / 2, 0.16, 3.4, 0.16);
      setBox(doorGlows, gi++, dx, 3.45, dz, 0.16, 0.16, DOOR_W + 0.32);
    } else {
      setBox(doorGlows, gi++, dx - DOOR_W / 2, 1.7, dz, 0.16, 3.4, 0.16);
      setBox(doorGlows, gi++, dx + DOOR_W / 2, 1.7, dz, 0.16, 3.4, 0.16);
      setBox(doorGlows, gi++, dx, 3.45, dz, DOOR_W + 0.32, 0.16, 0.16);
    }

    // ---- 天花灯板 ----
    setBox(ceilLights, pi, p.x, LOBBY_H - 0.12,
      p.z, Math.min(p.sx * 0.5, 8), 0.06, 1.2);

    // ---- 玻璃观光电梯（门对面后墙内侧）：两片侧板 + 暖光门缝 ----
    const back = -side;
    const ex = axisX ? p.x + back * (hx - WALL_T - 1.4) : p.x;
    const ez = axisX ? p.z : p.z + back * (hz - WALL_T - 1.4);
    if (axisX) {
      setBox(elevCabs, ei * 2, ex, 1.6, ez - 1.3, 1.6, 3.2, 0.2);
      setBox(elevCabs, ei * 2 + 1, ex, 1.6, ez + 1.3, 1.6, 3.2, 0.2);
      colliders.push(aabb(ex, ez - 1.3, 1.7, 0.35), aabb(ex, ez + 1.3, 1.7, 0.35));
    } else {
      setBox(elevCabs, ei * 2, ex - 1.3, 1.6, ez, 0.2, 3.2, 1.6);
      setBox(elevCabs, ei * 2 + 1, ex + 1.3, 1.6, ez, 0.2, 3.2, 1.6);
      colliders.push(aabb(ex - 1.3, ez, 0.35, 1.7), aabb(ex + 1.3, ez, 0.35, 1.7));
    }
    setBox(elevGlows, ei, ex, 3.1, ez, axisX ? 0.1 : 2.2, 0.12, axisX ? 2.2 : 0.1);
    ei++;

    // 触发区：电梯两板之间 + 少许前庭
    zones.push({
      aabb: aabb(ex, ez, 2.4, 2.4),
      roof: {
        minX: p.x - hx + 0.7, maxX: p.x + hx - 0.7,
        minZ: p.z - hz + 0.7, maxZ: p.z + hz - 0.7,
      },
      h: p.h,
    });
  });

  walls.instanceMatrix.needsUpdate = true;
  doorGlows.instanceMatrix.needsUpdate = true;
  ceilLights.instanceMatrix.needsUpdate = true;
  elevCabs.instanceMatrix.needsUpdate = true;
  elevGlows.instanceMatrix.needsUpdate = true;
  group.add(walls, doorGlows, ceilLights, elevCabs, elevGlows);

  return { group, colliders, zones };
}
