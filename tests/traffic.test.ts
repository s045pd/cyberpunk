import { describe, it, expect } from 'vitest';
import { buildAirCurves } from '../src/traffic/airTraffic';
import { buildRoadCurves } from '../src/traffic/groundTraffic';

describe('buildAirCurves', () => {
  const curves = buildAirCurves(20770703);

  it('至少 5 条闭合环线', () => {
    expect(curves.length).toBeGreaterThanOrEqual(5);
  });

  it('采样点高度在 200~540m 空层内', () => {
    for (const c of curves) {
      for (const p of c.getSpacedPoints(100)) {
        expect(p.y).toBeGreaterThan(200);
        expect(p.y).toBeLessThan(540);
      }
    }
  });

  it('采样连续（相邻点距不超过 260m）', () => {
    for (const c of curves) {
      const pts = c.getSpacedPoints(200);
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i].distanceTo(pts[i - 1])).toBeLessThan(260);
      }
    }
  });
});

describe('buildRoadCurves', () => {
  const curves = buildRoadCurves();

  it('覆盖两个轴向的多条道路', () => {
    expect(curves.length).toBeGreaterThan(20);
  });

  it('全部贴地（y = 3）且在城市半径内', () => {
    for (const c of curves) {
      for (const p of c.getSpacedPoints(10)) {
        expect(p.y).toBeCloseTo(3, 5);
        expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(3401);
      }
    }
  });
});
