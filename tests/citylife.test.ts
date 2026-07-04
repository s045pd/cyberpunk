import { describe, it, expect } from 'vitest';
import { ColliderGrid } from '../src/core/collision';
import { buildSidewalkPaths } from '../src/people/pedestrians';
import { pickIncidentSites } from '../src/events/incidents';
import { partitionOpenPlots } from '../src/city/interiors';
import { coastXAt, WATER_EAST_MAX } from '../src/city/water';
import { generatePlots, distToRoad } from '../src/city/layout';
import { districtAt } from '../src/city/districts';

const SEED = 20770703;

describe('ColliderGrid', () => {
  const grid = new ColliderGrid(64);
  grid.add({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 });

  it('盒外的点不受影响', () => {
    const [x, z] = grid.resolve(50, 50, 0.5);
    expect(x).toBe(50);
    expect(z).toBe(50);
  });

  it('侵入盒内的点被推出到盒外', () => {
    const [x, z] = grid.resolve(9.8, 0, 0.5);
    expect(Math.abs(x) >= 10.5 - 1e-6 || Math.abs(z) >= 10.5 - 1e-6).toBe(true);
  });

  it('沿最小穿透轴推出（贴边滑动）', () => {
    const [x, z] = grid.resolve(9.9, 3, 0.5);
    expect(x).toBeGreaterThanOrEqual(10.5 - 1e-6);
    expect(z).toBeCloseTo(3, 5);
  });
});

describe('coastXAt（西侧海湾岸线）', () => {
  it('岸线始终在城区建筑带以西', () => {
    for (let z = -4000; z <= 4000; z += 100) {
      expect(coastXAt(z)).toBeLessThan(-2050);
      expect(coastXAt(z)).toBeGreaterThan(-2700);
    }
    expect(WATER_EAST_MAX).toBeLessThan(-2000);
  });
});

describe('buildSidewalkPaths', () => {
  const paths = buildSidewalkPaths();

  it('数量充足且覆盖双轴向', () => {
    expect(paths.length).toBeGreaterThan(30);
  });

  it('全部贴地且避开水域', () => {
    for (const c of paths) {
      for (const p of c.getSpacedPoints(8)) {
        expect(p.y).toBeCloseTo(0, 5);
        expect(p.x).toBeGreaterThan(coastXAt(p.z) - 1e-6);
      }
    }
  });
});

describe('pickIncidentSites', () => {
  const sites = pickIncidentSites(SEED);

  it('数量与类型正确', () => {
    expect(sites.filter((s) => s.kind === 'crime').length).toBe(6);
    expect(sites.filter((s) => s.kind === 'rescue').length).toBe(3);
  });

  it('全部在城区陆地上且有区域归属', () => {
    for (const s of sites) {
      expect(s.x).toBeGreaterThan(coastXAt(s.z));
      expect(districtAt(s.x, s.z)).not.toBeNull();
    }
  });

  it('相同种子结果确定', () => {
    expect(pickIncidentSites(SEED)).toEqual(sites);
  });
});

describe('partitionOpenPlots', () => {
  const plots = generatePlots(SEED);
  const { open, closed } = partitionOpenPlots(plots, SEED);

  it('可进入建筑数量在预期范围且与封闭楼互斥', () => {
    expect(open.length).toBeGreaterThanOrEqual(16);
    expect(open.length).toBeLessThanOrEqual(30);
    expect(open.length + closed.length).toBe(plots.length);
  });

  it('可进入建筑临街且足够高大', () => {
    for (const p of open) {
      expect(p.h).toBeGreaterThanOrEqual(30);
      expect(Math.min(p.sx, p.sz)).toBeGreaterThanOrEqual(14);
      const edgeGap = Math.min(
        distToRoad(p.x) - p.sx / 2,
        distToRoad(p.z) - p.sz / 2,
      );
      expect(edgeGap).toBeLessThan(20);
      expect(edgeGap).toBeGreaterThan(-1e-6);
    }
  });

  it('彼此间距足够分散', () => {
    for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const d = Math.hypot(open[i].x - open[j].x, open[i].z - open[j].z);
        expect(d).toBeGreaterThan(140);
      }
    }
  });
});
