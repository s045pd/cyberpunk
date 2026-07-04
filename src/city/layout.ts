import {
  CITY_SIZE, DISTRICTS, DistrictId, pointInPolygon,
} from './districts';
import { LANDMARK_CLEARINGS } from './anchors';
import { createRng, range } from '../core/rng';

export const ROAD_SPACING = 480;
export const ROAD_HALF_WIDTH = 14;

export interface Plot {
  x: number; z: number;   // 中心（世界坐标）
  sx: number; sz: number; // 底面尺寸
  h: number;              // 楼高
  district: DistrictId;
  kind: number;           // 建筑形体 0..7
  litRate: number;        // 该楼窗亮率
}

/** 到最近路网中心线的距离（路网位于 ROAD_SPACING 整数倍坐标处） */
export function distToRoad(v: number): number {
  const r = ((v % ROAD_SPACING) + ROAD_SPACING) % ROAD_SPACING;
  return Math.min(r, ROAD_SPACING - r);
}

function inClearing(x: number, z: number): boolean {
  for (const c of LANDMARK_CLEARINGS) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < c.r * c.r) return true;
  }
  return false;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 平滑值噪声：让楼高成片聚集（高层区/低层区），而非纯随机撒点 */
function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const s = (a: number, b: number) => {
    let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = s(xi, zi) * (1 - u) + s(xi + 1, zi) * u;
  const b = s(xi, zi + 1) * (1 - u) + s(xi + 1, zi + 1) * u;
  return a * (1 - v) + b * v;
}

export function generatePlots(seed: number): Plot[] {
  const plots: Plot[] = [];
  for (const d of DISTRICTS) {
    const rng = createRng((seed ^ hashId(d.id)) >>> 0);
    const s = d.style;

    let minX = 1; let minY = 1; let maxX = 0; let maxY = 0;
    for (const [px, py] of d.polygon) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    const x0 = (minX - 0.5) * CITY_SIZE;
    const x1 = (maxX - 0.5) * CITY_SIZE;
    const z0 = (minY - 0.5) * CITY_SIZE;
    const z1 = (maxY - 0.5) * CITY_SIZE;

    for (let gx = x0; gx < x1; gx += s.cellSize) {
      for (let gz = z0; gz < z1; gz += s.cellSize) {
        if (rng() > s.density) continue;
        // 楼体贴格排列，仅少量抖动 —— 形成墙贴墙的实心街区
        const x = gx + s.cellSize * (0.5 + range(rng, -0.06, 0.06));
        const z = gz + s.cellSize * (0.5 + range(rng, -0.06, 0.06));

        // 楼皮不许伸进道路
        const margin = ROAD_HALF_WIDTH + s.cellSize * 0.5;
        if (distToRoad(x) < margin || distToRoad(z) < margin) continue;

        const nx = x / CITY_SIZE + 0.5;
        const nz = z / CITY_SIZE + 0.5;
        if (!pointInPolygon(nx, nz, d.polygon)) continue;
        if (inClearing(x, z)) continue;

        const [hLo, hHi] = s.heightRange;
        // 基础高度 × 聚集噪声：高层成簇、低层成片
        const cluster = 0.55 + valueNoise(x / 540, z / 540, seed) * 1.1;
        let h = hLo + (hHi - hLo) * Math.pow(rng(), s.heightBias) * cluster;
        h = Math.min(Math.max(h, hLo), hHi);
        if (d.id === 'city-center' && rng() < 0.06) {
          h = Math.min(h * 2.0, 460); // 少量超高层
        }

        plots.push({
          x, z,
          sx: s.cellSize * range(rng, 0.86, 0.98),
          sz: s.cellSize * range(rng, 0.86, 0.98),
          h,
          district: d.id,
          kind: Math.floor(rng() * 8),
          litRate: Math.min(1, s.windowLitRate * range(rng, 0.7, 1.25)),
        });
      }
    }
  }
  return plots;
}
