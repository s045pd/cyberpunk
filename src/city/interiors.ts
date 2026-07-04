import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Plot, distToRoad } from './layout';
import { DISTRICTS } from './districts';
import { createRng, range, pick } from '../core/rng';
import { AABB } from '../core/collision';

const LOBBY_H = 4.2;
const WALL_T = 0.45;
const DOOR_W = 3.6;

/** 纯逻辑、可单测：挑出临街、高大、彼此分散的可进入建筑 */
export function partitionOpenPlots(
  plots: Plot[], seed: number, target = 26,
): { open: Plot[]; closed: Plot[] } {
  const rng = createRng((seed ^ 0xd002) >>> 0);
  const candidates = plots.filter((p) => {
    if (p.h < 30 || Math.min(p.sx, p.sz) < 14) return false;
    const edgeGap = Math.min(
      distToRoad(p.x) - p.sx / 2,
      distToRoad(p.z) - p.sz / 2,
    );
    return edgeGap >= 0 && edgeGap < 20;
  });
  // 确定性洗牌
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const open: Plot[] = [];
  for (const p of candidates) {
    if (open.length >= target) break;
    if (open.some((q) => Math.hypot(q.x - p.x, q.z - p.z) <= 150)) continue;
    open.push(p);
  }
  const openSet = new Set(open);
  return { open, closed: plots.filter((p) => !openSet.has(p)) };
}

export interface Interiors {
  group: THREE.Group;
  colliders: AABB[];
  update(dt: number, t: number): void;
}

/**
 * 可进入建筑：一层挑空大堂（临街门洞 + 发光门框），
 * 内有电梯厅 / 售货机 / 前台，上部楼体照常延伸。
 */
export function createInteriors(open: Plot[], seed: number): Interiors {
  const rng = createRng((seed ^ 0xd003) >>> 0);
  const styleById = new Map(DISTRICTS.map((d) => [d.id, d.style]));
  const group = new THREE.Group();
  const colliders: AABB[] = [];

  const structure: THREE.BufferGeometry[] = [];   // 墙体/楼上体量/前台（深色）
  const ceilings: THREE.BufferGeometry[] = [];    // 天花灯板（白光）
  const doorGlows: THREE.BufferGeometry[] = [];   // 门框光柱（青色）
  const machines: THREE.BufferGeometry[] = [];    // 售货机面板（品红）
  const elevators: THREE.BufferGeometry[] = [];   // 电梯门缝（暖白）
  const upperWindows: THREE.BufferGeometry[] = []; // 上部楼体的少量亮窗条

  const box = (
    arr: THREE.BufferGeometry[],
    w: number, h: number, d: number, x: number, y: number, z: number,
  ) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    arr.push(g);
  };
  const aabb = (cx: number, cz: number, w: number, d: number): AABB => ({
    minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2,
  });

  for (const p of open) {
    // 门朝最近的路（比较两轴到路距离减去半footprint）
    const gapX = distToRoad(p.x) - p.sx / 2;
    const gapZ = distToRoad(p.z) - p.sz / 2;
    const doorAxisX = gapX <= gapZ; // true: 门在 ±x 面
    const roadDirX = ((p.x % 480) + 480) % 480 < 240 ? -1 : 1;
    const roadDirZ = ((p.z % 480) + 480) % 480 < 240 ? -1 : 1;

    const hx = p.sx / 2;
    const hz = p.sz / 2;

    // ---- 大堂四墙（门墙分两段） ----
    interface Wall { cx: number; cz: number; w: number; d: number; }
    const walls: Wall[] = [];
    const doorSide = doorAxisX ? roadDirX : roadDirZ;
    if (doorAxisX) {
      // 门在 x = p.x + doorSide*hx 的墙上
      const wx = p.x + doorSide * (hx - WALL_T / 2);
      const segD = (p.sz - DOOR_W) / 2;
      walls.push(
        { cx: wx, cz: p.z - (DOOR_W / 2 + segD / 2), w: WALL_T, d: segD },
        { cx: wx, cz: p.z + (DOOR_W / 2 + segD / 2), w: WALL_T, d: segD },
        { cx: p.x - doorSide * (hx - WALL_T / 2), cz: p.z, w: WALL_T, d: p.sz },
        { cx: p.x, cz: p.z - hz + WALL_T / 2, w: p.sx, d: WALL_T },
        { cx: p.x, cz: p.z + hz - WALL_T / 2, w: p.sx, d: WALL_T },
      );
    } else {
      const wz = p.z + doorSide * (hz - WALL_T / 2);
      const segW = (p.sx - DOOR_W) / 2;
      walls.push(
        { cx: p.x - (DOOR_W / 2 + segW / 2), cz: wz, w: segW, d: WALL_T },
        { cx: p.x + (DOOR_W / 2 + segW / 2), cz: wz, w: segW, d: WALL_T },
        { cx: p.x, cz: p.z - doorSide * (hz - WALL_T / 2), w: p.sx, d: WALL_T },
        { cx: p.x - hx + WALL_T / 2, cz: p.z, w: WALL_T, d: p.sz },
        { cx: p.x + hx - WALL_T / 2, cz: p.z, w: WALL_T, d: p.sz },
      );
    }
    for (const w of walls) {
      box(structure, w.w, LOBBY_H, w.d, w.cx, LOBBY_H / 2, w.cz);
      colliders.push(aabb(w.cx, w.cz, w.w, w.d));
    }

    // ---- 门框光柱 + 门头 ----
    const doorX = doorAxisX ? p.x + doorSide * hx : p.x;
    const doorZ = doorAxisX ? p.z : p.z + doorSide * hz;
    if (doorAxisX) {
      box(doorGlows, 0.18, 3.4, 0.18, doorX, 1.7, doorZ - DOOR_W / 2);
      box(doorGlows, 0.18, 3.4, 0.18, doorX, 1.7, doorZ + DOOR_W / 2);
      box(doorGlows, 0.18, 0.18, DOOR_W + 0.36, doorX, 3.5, doorZ);
    } else {
      box(doorGlows, 0.18, 3.4, 0.18, doorX - DOOR_W / 2, 1.7, doorZ);
      box(doorGlows, 0.18, 3.4, 0.18, doorX + DOOR_W / 2, 1.7, doorZ);
      box(doorGlows, DOOR_W + 0.36, 0.18, 0.18, doorX, 3.5, doorZ);
    }

    // ---- 大堂内饰 ----
    // 天花灯板 ×2
    box(ceilings, p.sx * 0.32, 0.06, 1.4, p.x - p.sx * 0.18, LOBBY_H - 0.15, p.z);
    box(ceilings, p.sx * 0.32, 0.06, 1.4, p.x + p.sx * 0.18, LOBBY_H - 0.15, p.z);
    // 电梯厅（门对面内墙）：两道金属门 + 发光门缝
    const backSide = -doorSide;
    const ex = doorAxisX ? p.x + backSide * (hx - WALL_T - 0.4) : p.x - 2.2;
    const ez = doorAxisX ? p.z - 2.2 : p.z + backSide * (hz - WALL_T - 0.4);
    for (const off of [0, 4.4]) {
      const mx = doorAxisX ? ex : ex + off;
      const mz = doorAxisX ? ez + off : ez;
      box(structure, doorAxisX ? 0.35 : 2.4, 3.0, doorAxisX ? 2.4 : 0.35, mx, 1.5, mz);
      box(elevators, doorAxisX ? 0.4 : 0.12, 2.6, doorAxisX ? 0.12 : 0.4, mx, 1.4, mz);
      colliders.push(aabb(mx, mz, doorAxisX ? 0.5 : 2.6, doorAxisX ? 2.6 : 0.5));
    }
    // 售货机
    const vx = doorAxisX ? p.x + backSide * 2 : p.x + hx - WALL_T - 1.0;
    const vz = doorAxisX ? p.z + hz - WALL_T - 1.0 : p.z + backSide * 2;
    box(structure, 1.1, 2.0, 0.9, vx, 1.0, vz);
    box(machines, doorAxisX ? 1.0 : 0.1, 1.5, doorAxisX ? 0.1 : 1.0,
      vx, 1.2, vz + (doorAxisX ? -0.5 : 0) * 0 + (doorAxisX ? -0.5 : 0));
    colliders.push(aabb(vx, vz, 1.3, 1.1));

    // ---- 上部楼体（4.5m 以上照旧体量 + 稀疏亮窗条） ----
    const style = styleById.get(p.district)!;
    box(structure, p.sx, p.h - LOBBY_H - 0.3, p.sz, p.x, (p.h + LOBBY_H) / 2, p.z);
    const winColorPick = pick(rng, style.neonPalette);
    void winColorPick;
    for (let wy = LOBBY_H + 6; wy < p.h - 4; wy += range(rng, 9, 16)) {
      box(upperWindows, p.sx + 0.08, 0.5, 0.06, p.x, wy,
        p.z + hz * (rng() < 0.5 ? 1 : -1));
    }
  }

  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (geos.length === 0) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  add(structure, new THREE.MeshStandardMaterial({
    color: 0x181b21, roughness: 0.6, metalness: 0.5,
  }));
  add(ceilings, new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xdfe8ee, emissiveIntensity: 1.5,
  }));
  add(doorGlows, new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0x00e5ff, emissiveIntensity: 2.2,
  }));
  add(machines, new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xff2975, emissiveIntensity: 1.8,
  }));
  add(elevators, new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xffd9a0, emissiveIntensity: 1.4,
  }));
  add(upperWindows, new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0x9fc8dd, emissiveIntensity: 1.1,
  }));

  return { group, colliders, update() { /* 静态 */ } };
}
