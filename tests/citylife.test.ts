import { describe, it, expect } from 'vitest';
import { ColliderGrid } from '../src/core/collision';
import { buildSidewalkPaths } from '../src/people/pedestrians';
import { pickIncidentSites } from '../src/events/incidents';
import { doorInfoFor } from '../src/city/lobbies';
import { buildKabukiLayout, MARKET_CENTER, MARKET_HALF, ALLEY_W } from '../src/city/kabukiMarket';
import { greenFor, listIntersections, CYCLE } from '../src/traffic/trafficLights';
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

describe('doorInfoFor（大堂门朝最近的路）', () => {
  const plots = generatePlots(SEED);

  it('门所在面到路的距离不大于另一轴', () => {
    for (const p of plots.slice(0, 500)) {
      const info = doorInfoFor(p);
      const gapX = distToRoad(p.x) - p.sx / 2;
      const gapZ = distToRoad(p.z) - p.sz / 2;
      if (info.axisX) expect(gapX).toBeLessThanOrEqual(gapZ + 1e-9);
      else expect(gapZ).toBeLessThanOrEqual(gapX + 1e-9);
    }
  });
});

describe('红绿灯相位', () => {
  it('同一路口两个轴向不会同时绿灯', () => {
    for (let t = 0; t < CYCLE * 2; t += 0.25) {
      for (const [ix, iz] of [[0, 0], [1, 0], [2, 3]] as const) {
        const bothGreen = greenFor(true, ix, iz, t) && greenFor(false, ix, iz, t);
        expect(bothGreen).toBe(false);
      }
    }
  });

  it('一个周期内两个轴向都有绿灯窗口', () => {
    let zGreen = false;
    let xGreen = false;
    for (let t = 0; t < CYCLE; t += 0.25) {
      zGreen = zGreen || greenFor(true, 0, 0, t);
      xGreen = xGreen || greenFor(false, 0, 0, t);
    }
    expect(zGreen).toBe(true);
    expect(xGreen).toBe(true);
  });

  it('受控路口全部在城区陆地上', () => {
    const inters = listIntersections();
    expect(inters.length).toBeGreaterThan(50);
    for (const { ix, iz } of inters) {
      expect(ix * 480).toBeGreaterThanOrEqual(-2050);
      expect(Math.hypot(ix * 480, iz * 480)).toBeLessThanOrEqual(3200);
    }
  });
});

describe('Kabuki 市场布局', () => {
  const layout = buildKabukiLayout();

  it('摊位排与巷道都在市场范围内', () => {
    for (const r of layout.rows) {
      expect(Math.abs(r.x - MARKET_CENTER.x)).toBeLessThanOrEqual(MARKET_HALF);
      expect(r.z0).toBeGreaterThanOrEqual(MARKET_CENTER.z - MARKET_HALF);
      expect(r.z1).toBeLessThanOrEqual(MARKET_CENTER.z + MARKET_HALF);
    }
  });

  it('巷道宽度为窄巷尺度（3~5m）', () => {
    expect(ALLEY_W).toBeGreaterThanOrEqual(3);
    expect(ALLEY_W).toBeLessThanOrEqual(5);
  });

  it('巷道数量与人流配置齐全', () => {
    expect(layout.lanes.length).toBeGreaterThan(10);
    for (const lane of layout.lanes) expect(lane.count).toBeGreaterThan(0);
  });
});
