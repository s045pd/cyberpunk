import { BodyPart } from './damage';
import { ColliderGrid } from '../core/collision';

export interface Vec3Like { x: number; y: number; z: number; }

export interface TargetCapsule {
  id: string;
  x: number;
  z: number;
  y0: number;       // 脚
  y1: number;       // 头顶
  r: number;
  headFrom: number; // 高于此为爆头
}

export interface HitResult {
  id: string;
  t: number;
  part: BodyPart;
}

/**
 * 射线 vs 竖直圆柱（胶囊近似）：先解 XZ 平面圆相交，再验 y 段。
 * 返回沿射线距离 t 与命中部位。
 */
export function rayCapsule(
  o: Vec3Like, d: Vec3Like, cap: Omit<TargetCapsule, 'id'> | TargetCapsule,
): { t: number; part: BodyPart } | null {
  const ox = o.x - cap.x;
  const oz = o.z - cap.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) {
    // 近乎垂直射击：仅当水平在半径内
    if (ox * ox + oz * oz > cap.r * cap.r) return null;
    const t = d.y > 0 ? cap.y0 - o.y : o.y - cap.y1;
    if (t < 0) return null;
    return { t, part: 'head' };
  }
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - cap.r * cap.r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const y = o.y + d.y * t;
  if (y < cap.y0 || y > cap.y1) return null;
  return { t, part: y >= cap.headFrom ? 'head' : 'body' };
}

const MARCH_STEP = 1.5;

/** 步进查墙：返回首个被挡的距离，未被挡返回 null */
export function marchBlocked(
  o: Vec3Like, d: Vec3Like, maxT: number, grid: ColliderGrid,
): number | null {
  for (let t = MARCH_STEP; t <= maxT; t += MARCH_STEP) {
    if (grid.blocked(o.x + d.x * t, o.z + d.z * t)) return t;
  }
  return null;
}

/** 最近命中：先取最近胶囊，再验墙体未提前挡住 */
export function firstHit(
  o: Vec3Like, d: Vec3Like, maxRange: number,
  targets: TargetCapsule[], grid: ColliderGrid,
): HitResult | null {
  let best: HitResult | null = null;
  for (const cap of targets) {
    const hit = rayCapsule(o, d, cap);
    if (!hit || hit.t > maxRange) continue;
    if (!best || hit.t < best.t) best = { id: cap.id, t: hit.t, part: hit.part };
  }
  if (!best) return null;
  const wallT = marchBlocked(o, d, best.t, grid);
  if (wallT !== null && wallT < best.t) return null;
  return best;
}
