import { describe, it, expect } from 'vitest';
import { generatePlots, distToRoad, ROAD_HALF_WIDTH } from '../src/city/layout';
import { DISTRICTS, pointInPolygon, CITY_SIZE } from '../src/city/districts';
import { LANDMARK_CLEARINGS } from '../src/city/anchors';

const SEED = 20770703;

describe('generatePlots', () => {
  const plots = generatePlots(SEED);
  const byId = new Map(DISTRICTS.map((d) => [d.id, d]));

  it('相同种子结果确定', () => {
    const again = generatePlots(SEED);
    expect(again.length).toBe(plots.length);
    expect(again[0]).toEqual(plots[0]);
    expect(again[again.length - 1]).toEqual(plots[plots.length - 1]);
  });

  it('产出规模在预期区间（全城）', () => {
    expect(plots.length).toBeGreaterThan(8000);
    expect(plots.length).toBeLessThan(60000);
  });

  it('每个地块中心都在所属区域多边形内', () => {
    for (const p of plots) {
      const d = byId.get(p.district)!;
      const nx = p.x / CITY_SIZE + 0.5;
      const nz = p.z / CITY_SIZE + 0.5;
      expect(pointInPolygon(nx, nz, d.polygon)).toBe(true);
    }
  });

  it('楼高落在区域风格范围内（含市中心超高层加成上限 460）', () => {
    for (const p of plots) {
      const [lo, hi] = byId.get(p.district)!.style.heightRange;
      expect(p.h).toBeGreaterThanOrEqual(lo);
      expect(p.h).toBeLessThanOrEqual(Math.max(hi, 460));
    }
  });

  it('地块避开路网', () => {
    for (const p of plots) {
      expect(distToRoad(p.x)).toBeGreaterThanOrEqual(ROAD_HALF_WIDTH);
      expect(distToRoad(p.z)).toBeGreaterThanOrEqual(ROAD_HALF_WIDTH);
    }
  });

  it('地块避开地标净空区', () => {
    for (const p of plots) {
      for (const c of LANDMARK_CLEARINGS) {
        const dist = Math.hypot(p.x - c.x, p.z - c.z);
        expect(dist).toBeGreaterThanOrEqual(c.r);
      }
    }
  });

  it('六大区均有产出', () => {
    const ids = new Set(plots.map((p) => p.district));
    expect(ids.size).toBe(6);
  });
});
