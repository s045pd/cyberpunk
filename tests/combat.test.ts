import { describe, it, expect } from 'vitest';
import { HealthRegistry } from '../src/combat/damage';
import { WeaponState, WEAPONS } from '../src/combat/weapons';
import { rayCapsule, firstHit, marchBlocked } from '../src/combat/hitreg';
import { ColliderGrid } from '../src/core/collision';
import { WantedSystem } from '../src/events/wanted';
import { GANGS, planSquads } from '../src/people/gangs';
import * as THREE from 'three';
import { PedFleet } from '../src/people/pedestrians';
import { districtAt } from '../src/city/districts';

describe('HealthRegistry', () => {
  it('默认 100 血，伤害递减且不溢出为负', () => {
    const h = new HealthRegistry();
    h.ensure('a');
    expect(h.damage('a', 30, 'body')).toEqual({ hp: 70, died: false });
    expect(h.damage('a', 200, 'body')).toEqual({ hp: 0, died: true });
  });

  it('爆头双倍伤害', () => {
    const h = new HealthRegistry();
    h.ensure('b');
    expect(h.damage('b', 25, 'head').hp).toBe(50);
  });

  it('死亡只触发一次，鞭尸不再返回 died', () => {
    const h = new HealthRegistry();
    h.ensure('c');
    h.damage('c', 999, 'body');
    expect(h.damage('c', 10, 'body')).toEqual({ hp: 0, died: false });
    expect(h.isDead('c')).toBe(true);
  });

  it('revive 恢复满血并清除死亡态', () => {
    const h = new HealthRegistry();
    h.ensure('d');
    h.damage('d', 999, 'body');
    h.revive('d');
    expect(h.isDead('d')).toBe(false);
    expect(h.damage('d', 10, 'body').hp).toBe(90);
  });
});

describe('WeaponState', () => {
  it('四槽定义齐全且数值符合 spec', () => {
    expect(WEAPONS.map((w) => w.id)).toEqual(['fist', 'pistol', 'smg', 'shotgun']);
    expect(WEAPONS[1].damage).toBe(25);
    expect(WEAPONS[3].pellets).toBe(8);
  });

  it('射速节流：间隔内不能再开火', () => {
    const w = new WeaponState();
    w.select(1, 0);
    expect(w.fire(1.0)).toBe(true);
    expect(w.fire(1.1)).toBe(false);
    expect(w.fire(1.4)).toBe(true);
  });

  it('弹匣打空后不能开火，换弹后恢复', () => {
    const w = new WeaponState();
    w.select(1, 0);
    for (let i = 0; i < 12; i++) w.fire(i);
    expect(w.ammo()).toBe(0);
    expect(w.fire(20)).toBe(false);
    w.startReload(21);
    w.tick(21 + WEAPONS[1].reloadTime + 0.01);
    expect(w.ammo()).toBe(12);
    expect(w.fire(23)).toBe(true);
  });

  it('切枪打断换弹', () => {
    const w = new WeaponState();
    w.select(1, 0);
    w.fire(0);
    w.startReload(1);
    w.select(2, 1.1);
    w.select(1, 1.2);
    w.tick(5);
    expect(w.ammo()).toBe(11);
  });

  it('拳头无弹药限制', () => {
    const w = new WeaponState();
    w.select(0, 0);
    for (let i = 0; i < 50; i++) expect(w.fire(i)).toBe(true);
  });
});

describe('hitreg', () => {
  const cap = { id: 'n1', x: 10, z: 0, y0: 0, y1: 1.8, r: 0.35, headFrom: 1.5 };

  it('正对射线命中躯干', () => {
    const hit = rayCapsule({ x: 0, y: 1.0, z: 0 }, { x: 1, y: 0, z: 0 }, cap);
    expect(hit).not.toBeNull();
    expect(hit!.part).toBe('body');
    expect(hit!.t).toBeCloseTo(10 - 0.35, 1);
  });

  it('打高处命中头部', () => {
    const hit = rayCapsule({ x: 0, y: 1.65, z: 0 }, { x: 1, y: 0, z: 0 }, cap);
    expect(hit!.part).toBe('head');
  });

  it('偏离半径则未命中', () => {
    expect(rayCapsule({ x: 0, y: 1, z: 1.0 }, { x: 1, y: 0, z: 0 }, cap)).toBeNull();
  });

  it('墙体阻挡：march 返回墙距', () => {
    const grid = new ColliderGrid(64);
    grid.add({ minX: 4, maxX: 5, minZ: -2, maxZ: 2 });
    expect(grid.blocked(4.5, 0)).toBe(true);
    expect(grid.blocked(3, 0)).toBe(false);
    const t = marchBlocked({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 20, grid);
    expect(t).not.toBeNull();
    expect(t!).toBeLessThan(6);
  });

  it('firstHit 选最近目标且尊重墙体', () => {
    const grid = new ColliderGrid(64);
    const far = { id: 'far', x: 20, z: 0, y0: 0, y1: 1.8, r: 0.35, headFrom: 1.5 };
    const near = { id: 'near', x: 8, z: 0, y0: 0, y1: 1.8, r: 0.35, headFrom: 1.5 };
    const hit = firstHit({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 100, [far, near], grid);
    expect(hit!.id).toBe('near');
    grid.add({ minX: 4, maxX: 5, minZ: -2, maxZ: 2 });
    expect(firstHit({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 100, [far, near], grid))
      .toBeNull();
  });
});

describe('WantedSystem', () => {
  it('首次作案 1 星，累计 3 次升 2 星，封顶 2', () => {
    const w = new WantedSystem();
    w.onCrime(0);
    expect(w.stars).toBe(1);
    w.onCrime(1);
    w.onCrime(2);
    expect(w.stars).toBe(2);
    w.onCrime(3);
    expect(w.stars).toBe(2);
  });

  it('脱离视线 20 秒降一星，40 秒清零', () => {
    const w = new WantedSystem();
    w.onCrime(0);
    w.onCrime(1);
    w.onCrime(2);
    w.onSeen(5);
    w.tick(24);
    expect(w.stars).toBe(2);
    w.tick(25.1);
    expect(w.stars).toBe(1);
    w.tick(45.2);
    expect(w.stars).toBe(0);
  });

  it('被看到会刷新衰减计时', () => {
    const w = new WantedSystem();
    w.onCrime(0);
    w.onSeen(18);
    w.tick(20.5);
    expect(w.stars).toBe(1);
  });

  it('clear 立即归零', () => {
    const w = new WantedSystem();
    w.onCrime(0);
    w.onCrime(1);
    w.onCrime(2);
    w.clear();
    expect(w.stars).toBe(0);
  });
});

describe('gangs', () => {
  it('四个原创帮派各有地盘与色标', () => {
    expect(GANGS.map((g) => g.id)).toEqual(['ferro', 'oni', 'tide', 'aurel']);
    for (const g of GANGS) {
      expect(g.color).toBeGreaterThan(0);
      expect(g.district).toBeTruthy();
    }
  });

  it('小队规划：每帮 6 队、全部落在本帮地盘内', () => {
    const squads = planSquads(20770703);
    for (const g of GANGS) {
      const own = squads.filter((s) => s.gangId === g.id);
      expect(own.length).toBe(6);
      for (const s of own) {
        expect(districtAt(s.x, s.z)?.id).toBe(g.district);
        expect(s.members).toBeGreaterThanOrEqual(3);
        expect(s.members).toBeLessThanOrEqual(5);
      }
    }
  });

  it('确定性', () => {
    expect(planSquads(7)).toEqual(planSquads(7));
  });
});

function tinyFleet(): PedFleet {
  return new PedFleet({
    lanes: [{
      curve: new THREE.LineCurve3(
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 0, 0),
      ),
      count: 8,
    }],
    seed: 42,
  });
}

describe('PedFleet 战斗接口', () => {
  it('resolveWalker 反算位置沿路径且确定', () => {
    const fleet = tinyFleet();
    const p = fleet.resolveWalker(0, 0, 3.5);
    if (p) {
      expect(p.x).toBeGreaterThanOrEqual(-3);
      expect(p.x).toBeLessThanOrEqual(103);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(2.2);
      expect(p.height).toBeGreaterThan(0.9);
    }
    expect(fleet.resolveWalker(0, 0, 3.5)).toEqual(p);
  });

  it('killWalker 后不再参与命中', () => {
    const fleet = tinyFleet();
    let found: [number, number] | null = null;
    fleet.forEachWalkerNear(50, 0, 200, 2, (k, i) => {
      if (!found) found = [k, i];
    });
    expect(found).not.toBeNull();
    const [k, i] = found!;
    const before = fleet.resolveWalker(k, i, 2)!;
    fleet.killWalker(k, i, before.x, before.z, 2);
    expect(fleet.resolveWalker(k, i, 5)).toBeNull();
  });

  it('forEachWalkerNear 半径过滤', () => {
    const fleet = tinyFleet();
    let count = 0;
    fleet.forEachWalkerNear(0, 0, 30, 1, () => count++);
    let all = 0;
    fleet.forEachWalkerNear(50, 0, 10000, 1, () => all++);
    expect(all).toBeGreaterThanOrEqual(count);
    expect(all).toBeGreaterThan(0);
  });
});
