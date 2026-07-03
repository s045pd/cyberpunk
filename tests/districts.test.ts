import { describe, it, expect } from 'vitest';
import {
  CITY_SIZE, DISTRICTS, pointInPolygon, districtAt, normToWorld,
} from '../src/city/districts';

describe('pointInPolygon', () => {
  const square: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];

  it('内部点为 true', () => {
    expect(pointInPolygon(0.5, 0.5, square)).toBe(true);
  });

  it('外部点为 false', () => {
    expect(pointInPolygon(1.5, 0.5, square)).toBe(false);
    expect(pointInPolygon(-0.1, 0.5, square)).toBe(false);
  });

  it('凹多边形正确判定', () => {
    const lShape: Array<[number, number]> = [
      [0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2],
    ];
    expect(pointInPolygon(0.5, 1.5, lShape)).toBe(true);
    expect(pointInPolygon(1.5, 1.5, lShape)).toBe(false);
  });
});

describe('DISTRICTS 数据', () => {
  it('包含六大区', () => {
    expect(DISTRICTS.map((d) => d.id).sort()).toEqual([
      'city-center', 'heywood', 'pacifica', 'santo-domingo', 'watson', 'westbrook',
    ]);
  });

  it('每区多边形至少 4 个顶点且坐标归一化', () => {
    for (const d of DISTRICTS) {
      expect(d.polygon.length).toBeGreaterThanOrEqual(4);
      for (const [x, y] of d.polygon) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('楼高范围与密度合法', () => {
    for (const d of DISTRICTS) {
      const [lo, hi] = d.style.heightRange;
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeGreaterThan(lo);
      expect(d.style.density).toBeGreaterThan(0);
      expect(d.style.density).toBeLessThanOrEqual(1);
    }
  });
});

describe('districtAt（世界坐标）', () => {
  const probes: Array<[string, number, number]> = [
    ['watson', 0.5, 0.2],
    ['westbrook', 0.8, 0.25],
    ['city-center', 0.4, 0.47],
    ['heywood', 0.62, 0.55],
    ['santo-domingo', 0.82, 0.6],
    ['pacifica', 0.38, 0.7],
  ];

  it.each(probes)('%s 内部点归属正确', (id, nx, ny) => {
    const [wx, wz] = normToWorld(nx, ny);
    expect(districtAt(wx, wz)?.id).toBe(id);
  });

  it('城区外返回 null（恶土）', () => {
    expect(districtAt(-CITY_SIZE / 2 + 10, -CITY_SIZE / 2 + 10)).toBeNull();
    expect(districtAt(CITY_SIZE, CITY_SIZE)).toBeNull();
  });
});
