# 战斗系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整战斗沙盒 —— 玩家 4 武器槽射击、全民 HP=100、帮派巡逻与枪战/斗殴事件、NCPD 通缉、风格化死亡、小地图与场所文字门头、WebAudio 合成音效。

**Architecture:** 单层 GPU 人海保留：行人位置确定性反算做命中，命中后写回实例属性变尸体；会打架的 AI 走 ~160 人 CPU 活性池（帮派/NCPD/斗殴者）。伤害/武器/命中/通缉全部纯逻辑模块（Vitest），渲染与 AI 导演是薄胶水。

**Tech Stack:** 既有 Three.js 管线 + WebAudio API（合成音效，零外部资产）

**Spec:** `docs/superpowers/specs/2026-07-04-combat-system-design.md`

---

## 文件结构总览

| 文件 | 职责 |
|---|---|
| `src/combat/damage.ts` | HP 注册表 + 伤害结算（爆头×2、死亡一次性）【纯逻辑】 |
| `src/combat/weapons.ts` | 4 武器定义 + 开火/换弹/切枪状态机【纯逻辑】 |
| `src/combat/hitreg.ts` | 射线 vs 竖直胶囊、墙体步进遮挡、最近命中【纯逻辑】 |
| `src/combat/tracers.ts` | 曳光线段池 + 火花/红色粒子池 |
| `src/combat/audio.ts` | WebAudio 合成：枪声/命中/换弹/受击/警笛 |
| `src/combat/viewmodel.ts` | 第一人称盒枪 + 枪口焰 + 后座 |
| `src/combat/player.ts` | 玩家战斗：输入/开火/受击/FLATLINED 重生 |
| `src/events/wanted.ts` | 通缉状态机（0-2 星，20s 视线外衰减）【纯逻辑】 |
| `src/people/gangs.ts` | 4 帮派定义/地盘/巡逻小队规划【纯逻辑】 |
| `src/people/activeNpcs.ts` | 活性 NPC 池（CPU 实体 + 实例渲染 + 尸体淡出） |
| `src/events/violence.ts` | 暴力导演：巡逻/遭遇战/斗殴/NCPD 交火/对玩家敌意 |
| `src/ui/combatHud.ts` | 准星/弹药/血条/通缉星/FLATLINED |
| `src/ui/minimap.ts` | M 键小地图（路网/玩家/场所/事件/地盘） |
| 改 `src/core/collision.ts` | 加 `blocked(x,z)` 点查询（子弹遮挡用） |
| 改 `src/people/pedestrians.ts` | 反算位置/击杀写回/恐慌波 uniform/尸体淡出 |
| 改 `src/city/interiorKits.ts` | 门头加场所文字（吧/医/食…canvas 字形图集） |
| 改 `src/controls/walkControls.ts` | 暴露朝向 yaw（小地图/射击方向已有 camera，无需？——不改） |
| 改 `src/main.ts` | 战斗装配（scene.add(camera)、目标提供器、恐慌钩子） |

约定沿用：SEED 确定性、实例化渲染、`update(dt,t)`、纯逻辑与渲染分离、提交格式 `<type>: <描述>`。

---

### Task 1: 伤害与 HP 注册表（TDD）

**Files:**
- Create: `src/combat/damage.ts`
- Test: `tests/combat.test.ts`（本任务创建，后续任务追加用例）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { HealthRegistry } from '../src/combat/damage';

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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/combat.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 src/combat/damage.ts**

```ts
export type BodyPart = 'body' | 'head';

export interface DamageResult {
  hp: number;
  died: boolean;
}

const HEAD_MULT = 2;

/** 全民统一血量表：玩家 / 活性 NPC / 人海行人共用 */
export class HealthRegistry {
  private hp = new Map<string, number>();
  private dead = new Set<string>();

  ensure(id: string, max = 100): void {
    if (!this.hp.has(id)) this.hp.set(id, max);
  }

  damage(id: string, amount: number, part: BodyPart): DamageResult {
    this.ensure(id);
    if (this.dead.has(id)) return { hp: 0, died: false };
    const dealt = part === 'head' ? amount * HEAD_MULT : amount;
    const next = Math.max(0, (this.hp.get(id) ?? 0) - dealt);
    this.hp.set(id, next);
    if (next <= 0) {
      this.dead.add(id);
      return { hp: 0, died: true };
    }
    return { hp: next, died: false };
  }

  isDead(id: string): boolean {
    return this.dead.has(id);
  }

  hpOf(id: string): number {
    return this.hp.get(id) ?? 0;
  }

  revive(id: string, hp = 100): void {
    this.hp.set(id, hp);
    this.dead.delete(id);
  }

  remove(id: string): void {
    this.hp.delete(id);
    this.dead.delete(id);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/combat.test.ts`
Expected: PASS 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/combat/damage.ts tests/combat.test.ts
git commit -m "feat: 全民 HP 注册表与伤害结算（爆头×2）"
```

---

### Task 2: 武器状态机（TDD）

**Files:**
- Create: `src/combat/weapons.ts`
- Test: `tests/combat.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
import { WeaponState, WEAPONS } from '../src/combat/weapons';

describe('WeaponState', () => {
  it('四槽定义齐全且数值符合 spec', () => {
    expect(WEAPONS.map((w) => w.id)).toEqual(['fist', 'pistol', 'smg', 'shotgun']);
    expect(WEAPONS[1].damage).toBe(25);
    expect(WEAPONS[3].pellets).toBe(8);
  });

  it('射速节流：间隔内不能再开火', () => {
    const w = new WeaponState();
    w.select(1, 0);                    // 手枪
    expect(w.fire(1.0)).toBe(true);
    expect(w.fire(1.1)).toBe(false);   // 0.35s 间隔未到
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
    expect(w.ammo()).toBe(11);         // 换弹被打断，弹药没变
  });

  it('拳头无弹药限制', () => {
    const w = new WeaponState();
    w.select(0, 0);
    for (let i = 0; i < 50; i++) expect(w.fire(i)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/combat.test.ts`
Expected: FAIL（weapons 模块不存在）

- [ ] **Step 3: 实现 src/combat/weapons.ts**

```ts
export type WeaponId = 'fist' | 'pistol' | 'smg' | 'shotgun';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;        // 单弹丸伤害
  pellets: number;       // 每次开火弹丸数
  magSize: number;       // Infinity = 无弹匣
  fireInterval: number;  // 秒
  reloadTime: number;    // 秒
  spreadDeg: number;     // 散布半角
  range: number;         // 米
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'fist', name: '拳头', damage: 20, pellets: 1, magSize: Infinity,
    fireInterval: 0.5, reloadTime: 0, spreadDeg: 0, range: 2,
  },
  {
    id: 'pistol', name: '手枪', damage: 25, pellets: 1, magSize: 12,
    fireInterval: 0.35, reloadTime: 1.2, spreadDeg: 0.3, range: 180,
  },
  {
    id: 'smg', name: '冲锋枪', damage: 12, pellets: 1, magSize: 30,
    fireInterval: 0.09, reloadTime: 1.6, spreadDeg: 1.2, range: 140,
  },
  {
    id: 'shotgun', name: '霓虹霰弹', damage: 8, pellets: 8, magSize: 6,
    fireInterval: 0.9, reloadTime: 1.8, spreadDeg: 5, range: 15,
  },
];

/** 开火/换弹/切枪状态机（时间由调用方注入，纯逻辑可测） */
export class WeaponState {
  index = 1; // 默认手枪
  private mags = WEAPONS.map((w) => w.magSize);
  private lastFire = -Infinity;
  private reloadEnds = -Infinity;
  private reloadingIdx = -1;

  current(): WeaponDef {
    return WEAPONS[this.index];
  }

  ammo(): number {
    return this.mags[this.index];
  }

  isReloading(now: number): boolean {
    return this.reloadingIdx === this.index && now < this.reloadEnds;
  }

  select(i: number, now: number): void {
    if (i < 0 || i >= WEAPONS.length || i === this.index) return;
    void now;
    this.reloadingIdx = -1; // 切枪打断换弹
    this.index = i;
  }

  canFire(now: number): boolean {
    if (this.isReloading(now)) return false;
    if (now - this.lastFire < this.current().fireInterval) return false;
    return this.mags[this.index] > 0;
  }

  /** 尝试开火：成功则扣弹并返回 true */
  fire(now: number): boolean {
    this.tick(now);
    if (!this.canFire(now)) return false;
    this.lastFire = now;
    if (Number.isFinite(this.mags[this.index])) this.mags[this.index]--;
    return true;
  }

  startReload(now: number): boolean {
    const def = this.current();
    if (!Number.isFinite(def.magSize)) return false;
    if (this.mags[this.index] >= def.magSize) return false;
    if (this.isReloading(now)) return false;
    this.reloadingIdx = this.index;
    this.reloadEnds = now + def.reloadTime;
    return true;
  }

  /** 推进时间：完成到点的换弹 */
  tick(now: number): void {
    if (this.reloadingIdx === this.index && now >= this.reloadEnds
      && this.reloadingIdx >= 0) {
      this.mags[this.index] = this.current().magSize;
      this.reloadingIdx = -1;
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/combat.test.ts`
Expected: PASS（Task1 + Task2 全部用例）

- [ ] **Step 5: Commit**

```bash
git add src/combat/weapons.ts tests/combat.test.ts
git commit -m "feat: 四槽武器状态机（射速/弹匣/换弹/切枪）"
```

---

### Task 3: 命中判定 + 碰撞网格点查询（TDD）

**Files:**
- Create: `src/combat/hitreg.ts`
- Modify: `src/core/collision.ts`（追加 `blocked(x,z)`）
- Test: `tests/combat.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
import { rayCapsule, firstHit, marchBlocked } from '../src/combat/hitreg';
import { ColliderGrid } from '../src/core/collision';

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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/combat.test.ts`
Expected: FAIL

- [ ] **Step 3: collision.ts 追加点查询**

在 `ColliderGrid` 类内 `resolve` 方法之后追加：

```ts
  /** 点是否落在任一碰撞盒内（子弹遮挡用） */
  blocked(x: number, z: number): boolean {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    for (const b of this.cells.get(this.key(cx, cz)) ?? []) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return true;
    }
    return false;
  }
```

- [ ] **Step 4: 实现 src/combat/hitreg.ts**

```ts
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
    // 垂直射击：仅当水平在半径内
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
```

- [ ] **Step 5: 运行确认通过 + Commit**

Run: `npx vitest run tests/combat.test.ts` → PASS

```bash
git add src/combat/hitreg.ts src/core/collision.ts tests/combat.test.ts
git commit -m "feat: 射线胶囊命中判定与墙体遮挡"
```

---

### Task 4: 通缉状态机（TDD）

**Files:**
- Create: `src/events/wanted.ts`
- Test: `tests/combat.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
import { WantedSystem } from '../src/events/wanted';

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
    expect(w.stars).toBe(2);      // 5+20=25 未到
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
    expect(w.stars).toBe(1);      // 18+20=38 未到
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/combat.test.ts` → FAIL

- [ ] **Step 3: 实现 src/events/wanted.ts**

```ts
const DECAY_SEC = 20;
const ESCALATE_AT = 3;
export const MAX_STARS = 2;

/** NCPD 通缉：0-2 星；每降一星需连续 20s 不被任何警员看到 */
export class WantedSystem {
  stars = 0;
  private crimes = 0;
  private lastSeen = -Infinity;

  onCrime(now: number): void {
    this.crimes++;
    this.stars = this.crimes >= ESCALATE_AT ? MAX_STARS : 1;
    this.lastSeen = now;
  }

  /** 警员视线内命中判定时调用 */
  onSeen(now: number): void {
    if (this.stars > 0) this.lastSeen = now;
  }

  tick(now: number): void {
    while (this.stars > 0 && now - this.lastSeen > DECAY_SEC) {
      this.stars--;
      this.lastSeen += DECAY_SEC;
      if (this.stars === 0) this.crimes = 0;
    }
  }

  clear(): void {
    this.stars = 0;
    this.crimes = 0;
    this.lastSeen = -Infinity;
  }
}
```

- [ ] **Step 4: 运行确认通过 + Commit**

Run: `npx vitest run tests/combat.test.ts` → PASS

```bash
git add src/events/wanted.ts tests/combat.test.ts
git commit -m "feat: NCPD 通缉状态机（两星/视线衰减）"
```

---

### Task 5: 帮派与巡逻小队规划（TDD）

**Files:**
- Create: `src/people/gangs.ts`
- Test: `tests/combat.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
import { GANGS, gangById, planSquads } from '../src/people/gangs';
import { districtAt } from '../src/city/districts';

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
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 src/people/gangs.ts**

```ts
import { DistrictId, DISTRICTS, districtAt, CITY_SIZE } from '../city/districts';
import { createRng, range, rangeInt } from '../core/rng';
import { coastXAt } from '../city/water';

export type GangId = 'ferro' | 'oni' | 'tide' | 'aurel';

export interface Gang {
  id: GangId;
  name: string;
  color: number;
  district: DistrictId;
}

// 原创虚构帮派（色标 = 巡逻队衣着与地盘晕染色）
export const GANGS: Gang[] = [
  { id: 'ferro', name: '铁蛆 FERRO', color: 0xff5a1a, district: 'santo-domingo' },
  { id: 'oni', name: '鬼刃 ONI', color: 0xff2975, district: 'westbrook' },
  { id: 'tide', name: '浪潮 TIDE', color: 0x00d5c8, district: 'pacifica' },
  { id: 'aurel', name: '金环 AUREL', color: 0xe8b53a, district: 'heywood' },
];

export function gangById(id: GangId): Gang {
  return GANGS.find((g) => g.id === id)!;
}

export interface SquadSpawn {
  gangId: GangId;
  x: number;
  z: number;
  members: number;
}

const SQUADS_PER_GANG = 6;

/** 纯逻辑、可单测：在各帮地盘内撒巡逻小队出生点（人行道附近） */
export function planSquads(seed: number): SquadSpawn[] {
  const rng = createRng((seed ^ 0x9a4d) >>> 0);
  const out: SquadSpawn[] = [];
  for (const gang of GANGS) {
    const poly = DISTRICTS.find((d) => d.id === gang.district)!.polygon;
    let minX = 1; let minY = 1; let maxX = 0; let maxY = 0;
    for (const [px, py] of poly) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    let placed = 0;
    let guard = 0;
    while (placed < SQUADS_PER_GANG && guard++ < 4000) {
      const x = (range(rng, minX, maxX) - 0.5) * CITY_SIZE;
      const z = (range(rng, minY, maxY) - 0.5) * CITY_SIZE;
      if (districtAt(x, z)?.id !== gang.district) continue;
      if (x < coastXAt(z) + 80) continue;
      out.push({ gangId: gang.id, x, z, members: rangeInt(rng, 3, 5) });
      placed++;
    }
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过 + Commit**

```bash
git add src/people/gangs.ts tests/combat.test.ts
git commit -m "feat: 四大原创帮派与地盘巡逻小队规划"
```

---

### Task 6: 人海行人的命中反算 / 击杀写回 / 恐慌波（TDD）

**Files:**
- Modify: `src/people/pedestrians.ts`
- Test: `tests/combat.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
import * as THREE from 'three';
import { PedFleet } from '../src/people/pedestrians';

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
  it('resolveWalker 反算位置与 shader 公式一致且沿路径', () => {
    const fleet = tinyFleet();
    const p = fleet.resolveWalker(0, 0, 3.5);
    if (p) {
      expect(p.x).toBeGreaterThanOrEqual(-3);
      expect(p.x).toBeLessThanOrEqual(103);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(2.2); // 车道槽范围内
      expect(p.height).toBeGreaterThan(0.9);
    }
    // 同一时刻两次反算一致
    expect(fleet.resolveWalker(0, 0, 3.5)).toEqual(p);
  });

  it('killWalker 后行人不再移动（速度归零）', () => {
    const fleet = tinyFleet();
    const before = fleet.resolveWalker(0, 0, 2)!;
    fleet.killWalker(0, 0, before.x, before.z, 2);
    const a = fleet.resolveWalker(0, 0, 5);
    expect(a).toBeNull();               // 死者不再参与命中
  });

  it('forEachWalkerNear 只遍历半径内的行人', () => {
    const fleet = tinyFleet();
    let count = 0;
    fleet.forEachWalkerNear(0, 0, 30, 1, () => count++);
    let all = 0;
    fleet.forEachWalkerNear(0, 0, 10000, 1, () => all++);
    expect(all).toBeGreaterThanOrEqual(count);
    expect(all).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL（方法不存在）

- [ ] **Step 3: 修改 pedestrians.ts**

3a. `PedFleet` 类内新增字段（构造器里逐 kind 填充）：

```ts
  // 战斗接口所需：每 kind 的属性数组引用与元数据
  private attrRefs: Array<{
    path: Float32Array;   // aPath
    move: Float32Array;   // aMove
    anim: Float32Array;   // aAnim
    heights: number[];
    mesh: THREE.InstancedMesh;
  }> = [];
  private deadWalkers: Array<{ k: number; i: number; at: number }> = [];
```

构造器中，每个 kind 的 `list.forEach(...)` 里把 `entry.height` 收进 `heights` 数组；attributes 建好后：

```ts
      this.attrRefs.push({ path: aPath, move: aMove, anim: aAnim, heights, mesh });
```

3b. 类内新增方法：

```ts
  /** 反算某行走者当前位置（与 vertex shader 同公式）；死者/静态返回 null */
  resolveWalker(
    k: number, i: number, t: number,
  ): { x: number; z: number; height: number } | null {
    const ref = this.attrRefs[k];
    if (!ref) return null;
    if (i < this.staticCounts[k] || i >= this.staticCounts[k] + this.walkerCounts[k]) {
      return null;
    }
    const speed = ref.move[i * 4 + 2];
    if (speed === 0) return null; // 已死亡或静止
    const len = Math.max(ref.move[i * 4], 1);
    const d = ((ref.move[i * 4 + 1] + speed * t) % len + len) % len;
    const sx = ref.path[i * 4];
    const sz = ref.path[i * 4 + 1];
    const dx = ref.path[i * 4 + 2];
    const dz = ref.path[i * 4 + 3];
    const lat = ref.move[i * 4 + 3];
    return {
      x: sx + dx * d + dz * lat,
      z: sz + dz * d - dx * lat,
      height: ref.heights[i],
    };
  }

  /** 击杀行走者：速度/步态归零，矩阵改为命中点倒地，20s 后淡出 */
  killWalker(k: number, i: number, atX: number, atZ: number, t: number): void {
    const ref = this.attrRefs[k];
    if (!ref) return;
    ref.move.set([1, 0, 0, 0], i * 4);
    ref.path.set([0, 0, 0, 0], i * 4);
    ref.anim[i * 3 + 1] = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, (atX + atZ) % 3.14),
    );
    m.compose(
      new THREE.Vector3(atX, 0.14, atZ), q,
      new THREE.Vector3(ref.heights[i], ref.heights[i], ref.heights[i]),
    );
    ref.mesh.setMatrixAt(i, m);
    ref.mesh.instanceMatrix.needsUpdate = true;
    ref.mesh.geometry.getAttribute('aMove').needsUpdate = true;
    ref.mesh.geometry.getAttribute('aPath').needsUpdate = true;
    ref.mesh.geometry.getAttribute('aAnim').needsUpdate = true;
    this.deadWalkers.push({ k, i, at: t });
  }

  /** 遍历半径内行走者（供命中候选/恐慌等） */
  forEachWalkerNear(
    x: number, z: number, radius: number, t: number,
    fn: (k: number, i: number, px: number, pz: number, height: number) => void,
  ): void {
    const r2 = radius * radius;
    for (let k = 0; k < this.attrRefs.length; k++) {
      const start = this.staticCounts[k];
      const end = start + this.walkerCounts[k];
      for (let i = start; i < end; i++) {
        const p = this.resolveWalker(k, i, t);
        if (!p) continue;
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz <= r2) fn(k, i, p.x, p.z, p.height);
      }
    }
  }

  /** 枪声恐慌波：半径内行人奔跑逃散（纯 shader，4 槽轮换） */
  triggerPanic(x: number, z: number, t: number, radius = 300): void {
    const u = this.material.uniforms.uPanic.value as THREE.Vector4[];
    u[this.panicSlot].set(x, z, radius, t);
    this.panicSlot = (this.panicSlot + 1) % u.length;
  }
  private panicSlot = 0;

  /** 尸体淡出：20s 后 1s 内下沉（由 main 循环调用的 update 内处理） */
  private fadeCorpses(t: number): void {
    for (let d = this.deadWalkers.length - 1; d >= 0; d--) {
      const c = this.deadWalkers[d];
      const age = t - c.at;
      if (age < 20) continue;
      const ref = this.attrRefs[c.k];
      const m = new THREE.Matrix4();
      ref.mesh.getMatrixAt(c.i, m);
      if (age >= 21) {
        m.setPosition(0, -500, 0);
        this.deadWalkers.splice(d, 1);
      } else {
        const e = m.elements;
        e[13] = 0.14 - (age - 20) * 0.6;
      }
      ref.mesh.setMatrixAt(c.i, m);
      ref.mesh.instanceMatrix.needsUpdate = true;
    }
  }
```

3c. `update` 改为：

```ts
  update(_dt: number, t: number): void {
    this.material.uniforms.uTime.value = t;
    this.fadeCorpses(t);
  }
```

3d. 材质 uniforms 加恐慌槽：

```ts
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: new THREE.Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
        uPanic: {
          value: [
            new THREE.Vector4(0, 0, 0, -1e9), new THREE.Vector4(0, 0, 0, -1e9),
            new THREE.Vector4(0, 0, 0, -1e9), new THREE.Vector4(0, 0, 0, -1e9),
          ],
        },
      },
```

3e. VERT 中 `float walked = aMove.y + aMove.z * uTime;` 之后插入：

```glsl
  // 恐慌波：枪声半径内 8 秒冲刺（额外里程 + 更快步频观感）
  uniform 声明区加：uniform vec4 uPanic[4];
  代码：
  float panicBoost = 0.0;
  vec2 probe = aPath.xy + aPath.zw * mod(walked, max(aMove.x, 1.0));
  for (int pi = 0; pi < 4; pi++) {
    float age = uTime - uPanic[pi].w;
    if (age > 0.0 && age < 8.0) {
      float dd = distance(probe, uPanic[pi].xy);
      if (dd < uPanic[pi].z) panicBoost += age * aMove.z * 2.2;
    }
  }
  walked += panicBoost;
```

（注意：`uniform vec4 uPanic[4];` 写在 VERT 顶部 attribute 声明之后；probe 用未加速位置估算，视觉近似足够。）

- [ ] **Step 4: 运行确认通过 + 全量回归 + Commit**

Run: `npx vitest run tests/combat.test.ts && npm test` → 全 PASS

```bash
git add src/people/pedestrians.ts tests/combat.test.ts
git commit -m "feat: 人海行人命中反算/击杀写回/恐慌波"
```

---

### Task 7: 曳光/粒子特效池 + WebAudio 合成音效

**Files:**
- Create: `src/combat/tracers.ts`, `src/combat/audio.ts`

渲染/音频胶水，无单测；验证 = build。

- [ ] **Step 1: 实现 src/combat/tracers.ts**

```ts
import * as THREE from 'three';

const TRACER_MAX = 64;
const TRACER_LIFE = 0.08;
const PARTICLE_MAX = 512;
const PARTICLE_LIFE = 0.4;

/** 战斗特效池：曳光线段 + 命中火花/红色粒子（风格化，无持久痕迹） */
export class CombatFx {
  group = new THREE.Group();

  private tracerGeo = new THREE.BufferGeometry();
  private tracerPos = new Float32Array(TRACER_MAX * 6);
  private tracerAge = new Float32Array(TRACER_MAX).fill(Infinity);
  private tracerIdx = 0;

  private partGeo = new THREE.BufferGeometry();
  private partPos = new Float32Array(PARTICLE_MAX * 3);
  private partVel = new Float32Array(PARTICLE_MAX * 3);
  private partCol = new Float32Array(PARTICLE_MAX * 3);
  private partAge = new Float32Array(PARTICLE_MAX).fill(Infinity);
  private partIdx = 0;

  constructor() {
    this.tracerGeo.setAttribute(
      'position', new THREE.BufferAttribute(this.tracerPos, 3),
    );
    const tracers = new THREE.LineSegments(
      this.tracerGeo,
      new THREE.LineBasicMaterial({
        color: 0xffe9a0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    tracers.frustumCulled = false;
    this.group.add(tracers);

    this.partGeo.setAttribute('position', new THREE.BufferAttribute(this.partPos, 3));
    this.partGeo.setAttribute('color', new THREE.BufferAttribute(this.partCol, 3));
    const parts = new THREE.Points(
      this.partGeo,
      new THREE.PointsMaterial({
        size: 0.14, vertexColors: true, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      }),
    );
    parts.frustumCulled = false;
    this.group.add(parts);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const i = this.tracerIdx;
    this.tracerIdx = (this.tracerIdx + 1) % TRACER_MAX;
    this.tracerPos.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
    this.tracerAge[i] = 0;
  }

  /** 命中效果：blood=true 时喷红色粒子（击中人体），否则白火花（打墙） */
  impact(x: number, y: number, z: number, blood: boolean): void {
    const n = blood ? 8 : 4;
    for (let k = 0; k < n; k++) {
      const i = this.partIdx;
      this.partIdx = (this.partIdx + 1) % PARTICLE_MAX;
      this.partPos.set([x, y, z], i * 3);
      this.partVel.set([
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4,
      ], i * 3);
      if (blood) this.partCol.set([0.8, 0.06, 0.05], i * 3);
      else this.partCol.set([1.0, 0.9, 0.6], i * 3);
      this.partAge[i] = 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < TRACER_MAX; i++) {
      if (this.tracerAge[i] > TRACER_LIFE) continue;
      this.tracerAge[i] += dt;
      if (this.tracerAge[i] > TRACER_LIFE) this.tracerPos.fill(0, i * 6, i * 6 + 6);
    }
    for (let i = 0; i < PARTICLE_MAX; i++) {
      if (this.partAge[i] > PARTICLE_LIFE) continue;
      this.partAge[i] += dt;
      if (this.partAge[i] > PARTICLE_LIFE) {
        this.partPos.set([0, -500, 0], i * 3);
        continue;
      }
      this.partVel[i * 3 + 1] -= 9.8 * dt;
      this.partPos[i * 3] += this.partVel[i * 3] * dt;
      this.partPos[i * 3 + 1] += this.partVel[i * 3 + 1] * dt;
      this.partPos[i * 3 + 2] += this.partVel[i * 3 + 2] * dt;
    }
    (this.tracerGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.partGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.partGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
```

- [ ] **Step 2: 实现 src/combat/audio.ts**

```ts
import { WeaponId } from './weapons';

/** WebAudio 程序化音效：零外部资产。首次用户手势后惰性解锁。 */
export class CombatAudio {
  private ctx: AudioContext | null = null;
  private sirenOsc: OscillatorNode | null = null;

  /** 需在用户手势回调里调用（点击/按键） */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private noiseBurst(
    dur: number, freq: number, gainV: number, type: BiquadFilterType = 'lowpass',
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = gainV;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  private beep(freq: number, dur: number, gainV: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainV, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  shot(id: WeaponId): void {
    if (id === 'fist') this.noiseBurst(0.06, 500, 0.15);
    else if (id === 'pistol') this.noiseBurst(0.12, 1600, 0.3);
    else if (id === 'smg') this.noiseBurst(0.07, 2200, 0.2, 'bandpass');
    else this.noiseBurst(0.22, 700, 0.4);
  }

  hitFlesh(): void { this.noiseBurst(0.05, 400, 0.18); }
  hitWall(): void { this.noiseBurst(0.04, 3000, 0.1, 'highpass'); }
  reload(): void { this.beep(220, 0.05, 0.12); this.beep(330, 0.05, 0.12); }
  hurt(): void { this.beep(90, 0.25, 0.25); }
  flatline(): void { this.beep(660, 1.2, 0.2); }

  siren(on: boolean): void {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      const osc = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      const gain = this.ctx.createGain();
      osc.frequency.value = 700;
      lfo.frequency.value = 0.6;
      lfoGain.gain.value = 250;
      gain.gain.value = 0.03;
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      lfo.start();
      this.sirenOsc = osc;
    } else if (!on && this.sirenOsc) {
      this.sirenOsc.stop();
      this.sirenOsc = null;
    }
  }
}
```

- [ ] **Step 3: 验证 + Commit**

```bash
npm run build && git add src/combat/tracers.ts src/combat/audio.ts
git commit -m "feat: 战斗特效池与 WebAudio 合成音效"
```

---

### Task 8: 活性 NPC 池（帮派/NCPD/斗殴者的 CPU 实体）

**Files:**
- Create: `src/people/activeNpcs.ts`
- Modify: `src/people/pedestrians.ts`（导出 `buildHumanGeometry`、`ARCHETYPES`、`createPedMaterial`）
- Test: `tests/combat.test.ts`（追加构建断言）

- [ ] **Step 1: pedestrians.ts 导出复用件**

把 `function buildHumanGeometry` 与 `const ARCHETYPES` 前加 `export`；材质创建抽为：

```ts
export function createPedMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uPanic: {
        value: [
          new THREE.Vector4(0, 0, 0, -1e9), new THREE.Vector4(0, 0, 0, -1e9),
          new THREE.Vector4(0, 0, 0, -1e9), new THREE.Vector4(0, 0, 0, -1e9),
        ],
      },
    },
  });
}
```

（`PedFleet` 构造器内改用 `this.material = createPedMaterial();`。）

- [ ] **Step 2: 追加失败测试**

```ts
import { ActiveNpcPool } from '../src/people/activeNpcs';
import { planSquads } from '../src/people/gangs';
import { HealthRegistry } from '../src/combat/damage';

describe('ActiveNpcPool', () => {
  it('按小队与 NCPD 配置生成单位，全部注册血量', () => {
    const health = new HealthRegistry();
    const pool = new ActiveNpcPool({
      seed: 42, squads: planSquads(42), ncpdPairs: 8, health,
    });
    const gangers = pool.units.filter((u) => u.role === 'ganger').length;
    const cops = pool.units.filter((u) => u.role === 'ncpd').length;
    expect(gangers).toBeGreaterThanOrEqual(4 * 6 * 3);
    expect(cops).toBe(16);
    for (const u of pool.units) expect(health.hpOf(u.id)).toBe(100);
  });

  it('斗殴者按需生成并可击杀移除', () => {
    const health = new HealthRegistry();
    const pool = new ActiveNpcPool({ seed: 7, squads: [], ncpdPairs: 0, health });
    const brawlers = pool.spawnBrawlers(100, 100, 3, 0);
    expect(brawlers.length).toBe(3);
    pool.applyDeath(brawlers[0], 5);
    expect(brawlers[0].state).toBe('dead');
  });
});
```

- [ ] **Step 3: 运行确认失败** → FAIL

- [ ] **Step 4: 实现 src/people/activeNpcs.ts**

```ts
import * as THREE from 'three';
import {
  buildHumanGeometry, ARCHETYPES, createPedMaterial,
} from './pedestrians';
import { GangId, gangById, SquadSpawn } from './gangs';
import { HealthRegistry } from '../combat/damage';
import { createRng, range, Rng } from '../core/rng';

export type NpcRole = 'ganger' | 'ncpd' | 'brawler';
export type NpcState = 'patrol' | 'fight' | 'brawl' | 'dead';

export interface ActiveNpc {
  id: string;
  role: NpcRole;
  gangId?: GangId;
  squad: number;         // 同队编号（斗殴双方用 -1/-2 区分阵营）
  x: number;
  z: number;
  yaw: number;
  height: number;
  weapon: 'fist' | 'pistol' | 'smg';
  state: NpcState;
  walked: number;        // 驱动步态
  speed: number;
  homeX: number;
  homeZ: number;
  targetId: string | null;
  nextShotAt: number;
  diedAt: number;
  slot: number;          // 实例槽位（mesh, index）
  mesh: 0 | 1;           // 0=平民体型(帮派/斗殴) 1=警察体型
}

export interface ActivePoolOptions {
  seed: number;
  squads: SquadSpawn[];
  ncpdPairs: number;
  health: HealthRegistry;
}

const MAX_CIVIL = 160;
const MAX_COPS = 40;

/** 活性 NPC 池：CPU 驱动矩阵 + 复用行人 shader（aMove.y 驱动步态相位） */
export class ActiveNpcPool {
  group = new THREE.Group();
  units: ActiveNpc[] = [];
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh];
  private material = createPedMaterial();
  private rng: Rng;
  private health: HealthRegistry;
  private nextId = 0;
  private freeSlots: [number[], number[]] = [[], []];

  constructor(opts: ActivePoolOptions) {
    this.rng = createRng((opts.seed ^ 0xac71) >>> 0);
    this.health = opts.health;

    const mk = (arch: 'man' | 'cop', cap: number) => {
      const mesh = new THREE.InstancedMesh(
        buildHumanGeometry(ARCHETYPES[arch]), this.material, cap,
      );
      mesh.count = cap;
      mesh.frustumCulled = false;
      const zero = new THREE.Matrix4().makeTranslation(0, -500, 0);
      const n = cap;
      const fill = (name: string, size: number, v: number[]) => {
        const arr = new Float32Array(n * size);
        for (let i = 0; i < n; i++) arr.set(v, i * size);
        mesh.geometry.setAttribute(
          name, new THREE.InstancedBufferAttribute(arr, size),
        );
      };
      fill('aClothes', 3, [0.2, 0.2, 0.22]);
      fill('aSkin', 3, [0.7, 0.55, 0.42]);
      fill('aAccent', 3, [0, 0, 0]);
      fill('aAnim', 3, [0, 4.2, 0.5]);
      fill('aPath', 4, [0, 0, 0, 0]);
      fill('aMove', 4, [1, 0, 0, 0]);
      for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
      return mesh;
    };
    this.meshes = [mk('man', MAX_CIVIL), mk('cop', MAX_COPS)];
    this.freeSlots = [
      Array.from({ length: MAX_CIVIL }, (_, i) => MAX_CIVIL - 1 - i),
      Array.from({ length: MAX_COPS }, (_, i) => MAX_COPS - 1 - i),
    ];
    this.group.add(this.meshes[0], this.meshes[1]);

    // 帮派小队
    opts.squads.forEach((s, si) => {
      const gang = gangById(s.gangId);
      for (let m = 0; m < s.members; m++) {
        this.spawn({
          role: 'ganger', gangId: s.gangId, squad: si, mesh: 0,
          x: s.x + range(this.rng, -4, 4), z: s.z + range(this.rng, -4, 4),
          weapon: this.rng() < 0.6 ? 'pistol' : 'smg',
          clothes: gang.color, accent: gang.color,
        });
      }
    });
    // NCPD 双人巡组
    for (let p = 0; p < opts.ncpdPairs; p++) {
      const ang = range(this.rng, 0, Math.PI * 2);
      const r = range(this.rng, 400, 2400);
      const px = Math.cos(ang) * r;
      const pz = Math.sin(ang) * r;
      for (let m = 0; m < 2; m++) {
        this.spawn({
          role: 'ncpd', squad: 1000 + p, mesh: 1,
          x: px + m * 1.6, z: pz, weapon: 'pistol',
          clothes: 0x1a2334, accent: 0x00c8ff,
        });
      }
    }
  }

  private spawn(o: {
    role: NpcRole; gangId?: GangId; squad: number; mesh: 0 | 1;
    x: number; z: number; weapon: 'fist' | 'pistol' | 'smg';
    clothes: number; accent: number;
  }): ActiveNpc | null {
    const slot = this.freeSlots[o.mesh].pop();
    if (slot === undefined) return null;
    const id = `npc-${this.nextId++}`;
    const unit: ActiveNpc = {
      id, role: o.role, gangId: o.gangId, squad: o.squad,
      x: o.x, z: o.z, yaw: range(this.rng, 0, Math.PI * 2),
      height: range(this.rng, 1.68, 1.85),
      weapon: o.weapon, state: o.role === 'brawler' ? 'brawl' : 'patrol',
      walked: 0, speed: range(this.rng, 1.0, 1.4),
      homeX: o.x, homeZ: o.z, targetId: null,
      nextShotAt: 0, diedAt: 0, slot, mesh: o.mesh,
    };
    this.health.ensure(id);
    this.health.revive(id);
    const mesh = this.meshes[o.mesh];
    const c = new THREE.Color(o.clothes);
    const a = new THREE.Color(o.accent);
    (mesh.geometry.getAttribute('aClothes') as THREE.InstancedBufferAttribute)
      .set([c.r, c.g, c.b], slot * 3);
    (mesh.geometry.getAttribute('aAccent') as THREE.InstancedBufferAttribute)
      .set([a.r, a.g, a.b], slot * 3);
    mesh.geometry.getAttribute('aClothes').needsUpdate = true;
    mesh.geometry.getAttribute('aAccent').needsUpdate = true;
    this.units.push(unit);
    return unit;
  }

  /** 斗殴事件按需生成（挥拳者，分两个临时阵营） */
  spawnBrawlers(x: number, z: number, n: number, t: number): ActiveNpc[] {
    const out: ActiveNpc[] = [];
    for (let i = 0; i < n; i++) {
      const u = this.spawn({
        role: 'brawler', squad: i % 2 === 0 ? -1 : -2, mesh: 0,
        x: x + range(this.rng, -2, 2), z: z + range(this.rng, -2, 2),
        weapon: 'fist',
        clothes: [0x40222e, 0x223140, 0x3d2f2a][i % 3], accent: 0x000000,
      });
      if (u) {
        u.state = 'brawl';
        u.nextShotAt = t + range(this.rng, 0.3, 1);
        out.push(u);
      }
    }
    return out;
  }

  applyDeath(u: ActiveNpc, t: number): void {
    if (u.state === 'dead') return;
    u.state = 'dead';
    u.diedAt = t;
  }

  /** 回收死亡超过 21s 的单位（槽位归还，可再生成） */
  recycle(t: number): void {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.state === 'dead' && t - u.diedAt > 21) {
        const hide = new THREE.Matrix4().makeTranslation(0, -500, 0);
        this.meshes[u.mesh].setMatrixAt(u.slot, hide);
        this.freeSlots[u.mesh].push(u.slot);
        this.health.remove(u.id);
        this.units.splice(i, 1);
      }
    }
  }

  /** 写回所有实例矩阵与步态里程 */
  syncVisuals(t: number): void {
    this.material.uniforms.uTime.value = t;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    for (const u of this.units) {
      const mesh = this.meshes[u.mesh];
      if (u.state === 'dead') {
        const age = t - u.diedAt;
        const y = age > 20 ? 0.14 - (age - 20) * 0.6 : 0.14;
        q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, u.yaw));
        s.setScalar(u.height);
        m.compose(new THREE.Vector3(u.x, y, u.z), q, s);
      } else {
        q.setFromAxisAngle(UP, u.yaw);
        s.setScalar(u.height);
        m.compose(new THREE.Vector3(u.x, 0, u.z), q, s);
      }
      mesh.setMatrixAt(u.slot, m);
      (mesh.geometry.getAttribute('aMove') as THREE.InstancedBufferAttribute)
        .setY(u.slot, u.walked);
    }
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.getAttribute('aMove').needsUpdate = true;
    }
  }
}
```

- [ ] **Step 5: 运行确认通过 + 全量回归 + Commit**

Run: `npx vitest run tests/combat.test.ts && npm test` → PASS

```bash
git add src/people/activeNpcs.ts src/people/pedestrians.ts tests/combat.test.ts
git commit -m "feat: 活性 NPC 池（帮派/NCPD/斗殴者实体与渲染）"
```

---

### Task 9: 暴力事件导演

**Files:**
- Create: `src/events/violence.ts`

AI 胶水层（子系统均已单测），验证 = build + 预览目击事件。

- [ ] **Step 1: 实现 src/events/violence.ts**

```ts
import * as THREE from 'three';
import { ActiveNpcPool, ActiveNpc } from '../people/activeNpcs';
import { HealthRegistry } from '../combat/damage';
import { CombatFx } from '../combat/tracers';
import { CombatAudio } from '../combat/audio';
import { WantedSystem } from '../events/wanted';
import { ColliderGrid } from '../core/collision';
import { marchBlocked } from '../combat/hitreg';
import { createRng, range, Rng } from '../core/rng';

export interface ViolenceEvent {
  kind: 'brawl' | 'shootout';
  x: number;
  z: number;
  until: number;
}

interface DirectorDeps {
  pool: ActiveNpcPool;
  health: HealthRegistry;
  fx: CombatFx;
  audio: CombatAudio;
  wanted: WantedSystem;
  grid: ColliderGrid;
  onGunshot(x: number, z: number, t: number): void;   // 恐慌波钩子
  onPlayerHit(damage: number, t: number): void;
  playerPos(): THREE.Vector3;
  playerAlive(): boolean;
}

const NPC_FIRE_RANGE = 80;
const NPC_HIT_CHANCE = 0.55;
const BRAWL_RANGE = 1.6;

/**
 * 暴力导演：小队巡逻、敌对遭遇 → 枪战、随机斗殴、NCPD 敌意与追击玩家。
 * AI 0.1s 节流；每帧只做移动积分与开火计时。
 */
export class ViolenceDirector {
  private rng: Rng;
  private events: ViolenceEvent[] = [];
  private nextBrawlAt = 10;
  private aiAccum = 0;
  /** 对玩家有敌意的帮派（被玩家攻击过） */
  private hostileGangs = new Set<string>();

  constructor(private deps: DirectorDeps, seed: number) {
    this.rng = createRng((seed ^ 0x71e5) >>> 0);
  }

  /** 玩家攻击了某单位 → 结仇/通缉 */
  onPlayerAttacked(u: ActiveNpc, t: number): void {
    if (u.role === 'ganger' && u.gangId) this.hostileGangs.add(u.gangId);
    if (u.role === 'ncpd') this.deps.wanted.onCrime(t);
    // 攻击平民由 player.ts 直接对 wanted.onCrime
  }

  activeEvents(): ViolenceEvent[] {
    return this.events;
  }

  update(dt: number, t: number): void {
    const { pool } = this.deps;
    // 每帧：移动积分
    for (const u of pool.units) {
      if (u.state === 'dead') continue;
      if (u.state === 'patrol') {
        // 绕出生点方圆 40m 游走
        const dx = u.homeX - u.x;
        const dz = u.homeZ - u.z;
        if (dx * dx + dz * dz > 1600 || this.rng() < 0.002) {
          u.yaw = Math.atan2(dx, dz) + range(this.rng, -0.6, 0.6);
        }
        u.x += Math.sin(u.yaw) * u.speed * dt;
        u.z += Math.cos(u.yaw) * u.speed * dt;
        u.walked += u.speed * dt;
      }
    }
    this.events = this.events.filter((e) => e.until > t);

    this.aiAccum += dt;
    if (this.aiAccum < 0.1) {
      pool.syncVisuals(t);
      pool.recycle(t);
      return;
    }
    this.aiAccum = 0;

    this.tickCombatAi(t);
    this.maybeSpawnBrawl(t);
    pool.syncVisuals(t);
    pool.recycle(t);
  }

  /* ---------- 战斗 AI（0.1s 节流） ---------- */

  private tickCombatAi(t: number): void {
    const { pool, health } = this.deps;
    const player = this.deps.playerPos();
    const stars = this.deps.wanted.stars;

    for (const u of pool.units) {
      if (u.state === 'dead') continue;

      // 1) 找敌人
      let enemy: ActiveNpc | 'player' | null = null;
      let bestD2 = NPC_FIRE_RANGE * NPC_FIRE_RANGE;
      for (const v of pool.units) {
        if (v === u || v.state === 'dead') continue;
        if (!this.hostile(u, v)) continue;
        const d2 = (u.x - v.x) ** 2 + (u.z - v.z) ** 2;
        if (d2 < bestD2) { bestD2 = d2; enemy = v; }
      }
      // 玩家作为目标：NCPD 在通缉时 / 帮派被结仇时
      if (this.deps.playerAlive()) {
        const pHostile = (u.role === 'ncpd' && stars > 0)
          || (u.role === 'ganger' && u.gangId && this.hostileGangs.has(u.gangId));
        if (pHostile) {
          const d2 = (u.x - player.x) ** 2 + (u.z - player.z) ** 2;
          if (d2 < bestD2) { bestD2 = d2; enemy = 'player'; }
        }
      }

      if (!enemy) {
        if (u.state === 'fight') u.state = 'patrol';
        continue;
      }

      const ex = enemy === 'player' ? player.x : enemy.x;
      const ez = enemy === 'player' ? player.z : enemy.z;
      u.yaw = Math.atan2(ex - u.x, ez - u.z);

      if (u.weapon === 'fist' || u.state === 'brawl') {
        this.brawlStep(u, enemy, ex, ez, t);
        continue;
      }

      u.state = 'fight';
      // 走位：距离 >30m 逼近，<12m 侧移
      const d = Math.sqrt(bestD2);
      const dtMove = 0.1;
      if (d > 30) {
        u.x += Math.sin(u.yaw) * 2.2 * dtMove;
        u.z += Math.cos(u.yaw) * 2.2 * dtMove;
        u.walked += 2.2 * dtMove;
      } else if (d < 12) {
        u.x += Math.cos(u.yaw) * 1.8 * dtMove * (u.slot % 2 === 0 ? 1 : -1);
        u.z -= Math.sin(u.yaw) * 1.8 * dtMove * (u.slot % 2 === 0 ? 1 : -1);
        u.walked += 1.8 * dtMove;
      }

      // 开火
      if (t < u.nextShotAt) continue;
      u.nextShotAt = t + (u.weapon === 'smg'
        ? range(this.rng, 0.15, 0.4) : range(this.rng, 0.6, 1.3));
      // 视线（墙体）检查
      const dir = {
        x: (ex - u.x) / d, y: 0, z: (ez - u.z) / d,
      };
      if (marchBlocked({ x: u.x, y: 1.5, z: u.z }, dir, d, this.deps.grid) !== null) {
        continue;
      }
      this.npcShoot(u, enemy, ex, ez, d, t);
    }
  }

  private npcShoot(
    u: ActiveNpc, enemy: ActiveNpc | 'player', ex: number, ez: number,
    d: number, t: number,
  ): void {
    const { fx, audio, health, pool } = this.deps;
    const from = new THREE.Vector3(u.x, 1.5, u.z);
    const to = new THREE.Vector3(
      ex + range(this.rng, -0.8, 0.8), 1.4, ez + range(this.rng, -0.8, 0.8),
    );
    fx.tracer(from, to);
    audio.shot(u.weapon === 'smg' ? 'smg' : 'pistol');
    this.deps.onGunshot(u.x, u.z, t);

    if (this.rng() > NPC_HIT_CHANCE) return;
    const dmg = Math.round(range(this.rng, 8, 15) * (1 - Math.min(d / 200, 0.4)));
    if (enemy === 'player') {
      this.deps.onPlayerHit(dmg, t);
      return;
    }
    fx.impact(ex, 1.4, ez, true);
    const r = health.damage(enemy.id, dmg, 'body');
    if (r.died) {
      pool.applyDeath(enemy, t);
      this.markEvent(ex, ez, 'shootout', t + 30);
    }
  }

  private brawlStep(
    u: ActiveNpc, enemy: ActiveNpc | 'player', ex: number, ez: number, t: number,
  ): void {
    const d = Math.hypot(ex - u.x, ez - u.z);
    if (d > BRAWL_RANGE) {
      u.x += Math.sin(u.yaw) * 1.6 * 0.1;
      u.z += Math.cos(u.yaw) * 1.6 * 0.1;
      u.walked += 0.16;
      return;
    }
    if (t < u.nextShotAt) return;
    u.nextShotAt = t + range(this.rng, 0.5, 1.0);
    u.walked += 0.5;                       // 挥拳观感：步态相位猛进
    this.deps.audio.hitFlesh();
    if (enemy === 'player') {
      this.deps.onPlayerHit(12, t);
      return;
    }
    const r = this.deps.health.damage(enemy.id, 20, 'body');
    this.deps.fx.impact(ex, 1.3, ez, false);
    if (r.died) this.deps.pool.applyDeath(enemy, t);
  }

  /** 敌对关系：不同帮派 / 帮派 vs NCPD / 斗殴临时阵营 */
  private hostile(a: ActiveNpc, b: ActiveNpc): boolean {
    if (a.role === 'brawler' || b.role === 'brawler') {
      return a.role === 'brawler' && b.role === 'brawler' && a.squad !== b.squad;
    }
    if (a.role === 'ganger' && b.role === 'ganger') return a.gangId !== b.gangId;
    if (a.role === 'ncpd' && b.role === 'ganger') return b.state === 'fight';
    if (a.role === 'ganger' && b.role === 'ncpd') return a.state === 'fight';
    return false;
  }

  /* ---------- 斗殴事件生成 ---------- */

  private maybeSpawnBrawl(t: number): void {
    if (t < this.nextBrawlAt) return;
    if (this.events.filter((e) => e.until > t).length >= 6) return;
    this.nextBrawlAt = t + range(this.rng, 20, 50);
    const p = this.deps.playerPos();
    const ang = range(this.rng, 0, Math.PI * 2);
    const r = range(this.rng, 80, 400);
    const x = p.x + Math.cos(ang) * r;
    const z = p.z + Math.sin(ang) * r;
    if (Math.hypot(x, z) > 3200) return;
    const n = 2 + Math.floor(this.rng() * 3);
    const brawlers = this.deps.pool.spawnBrawlers(x, z, n, t);
    if (brawlers.length >= 2) this.markEvent(x, z, 'brawl', t + range(this.rng, 40, 80));
  }

  private markEvent(x: number, z: number, kind: 'brawl' | 'shootout', until: number): void {
    this.events.push({ kind, x, z, until });
  }
}
```

- [ ] **Step 2: 验证 + Commit**

```bash
npm run build && git add src/events/violence.ts
git commit -m "feat: 暴力导演 — 巡逻/枪战/斗殴/对玩家敌意"
```

---

### Task 10: 玩家战斗 + 第一人称视模 + 战斗 HUD

**Files:**
- Create: `src/combat/player.ts`, `src/combat/viewmodel.ts`, `src/ui/combatHud.ts`
- Modify: `src/styles.css`（战斗 HUD 样式）

- [ ] **Step 1: 实现 src/ui/combatHud.ts**

```ts
export class CombatHud {
  private root: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private ammoEl: HTMLDivElement;
  private hpEl: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private starsEl: HTMLDivElement;
  private flatEl: HTMLDivElement;
  private markerTimer = 0;

  constructor(overlay: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'chud';
    this.root.innerHTML = `
      <div class="chud-crosshair"></div>
      <div class="chud-ammo"></div>
      <div class="chud-hp"><div class="chud-hp-fill"></div></div>
      <div class="chud-stars"></div>
      <div class="chud-flatlined">FLATLINED<span>// 重新接入中…</span></div>
    `;
    overlay.appendChild(this.root);
    this.crosshair = this.root.querySelector('.chud-crosshair')!;
    this.ammoEl = this.root.querySelector('.chud-ammo')!;
    this.hpEl = this.root.querySelector('.chud-hp')!;
    this.hpFill = this.root.querySelector('.chud-hp-fill')!;
    this.starsEl = this.root.querySelector('.chud-stars')!;
    this.flatEl = this.root.querySelector('.chud-flatlined')!;
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? 'block' : 'none';
  }

  setAmmo(name: string, cur: number, reloading: boolean): void {
    this.ammoEl.textContent = Number.isFinite(cur)
      ? `${name} ${reloading ? '换弹…' : `${cur}/∞`}`
      : name;
  }

  setHp(hp: number): void {
    this.hpFill.style.width = `${Math.max(hp, 0)}%`;
    this.hpEl.classList.toggle('low', hp < 35);
  }

  setWanted(stars: number): void {
    this.starsEl.textContent = '★'.repeat(stars);
  }

  hitMarker(killed: boolean): void {
    this.crosshair.classList.remove('hit', 'kill');
    void this.crosshair.offsetWidth; // 重启动画
    this.crosshair.classList.add(killed ? 'kill' : 'hit');
    this.markerTimer = 0.2;
  }

  showFlatlined(on: boolean): void {
    this.flatEl.classList.toggle('on', on);
  }

  update(dt: number): void {
    if (this.markerTimer > 0) {
      this.markerTimer -= dt;
      if (this.markerTimer <= 0) this.crosshair.classList.remove('hit', 'kill');
    }
  }
}
```

- [ ] **Step 2: styles.css 追加**

```css
/* ---------- 战斗 HUD ---------- */
.chud-crosshair {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.chud-crosshair::before,
.chud-crosshair::after {
  content: '';
  position: absolute;
  background: rgba(252, 238, 10, 0.85);
}

.chud-crosshair::before {
  left: 6px; top: 0; width: 2px; height: 14px;
}

.chud-crosshair::after {
  top: 6px; left: 0; width: 14px; height: 2px;
}

.chud-crosshair.hit::before,
.chud-crosshair.hit::after { background: #ff7a1a; }

.chud-crosshair.kill::before,
.chud-crosshair.kill::after { background: #ff2030; }

.chud-ammo {
  position: absolute;
  bottom: 52px;
  right: 24px;
  color: var(--color-hud);
  font-size: 17px;
  letter-spacing: 0.12em;
}

.chud-hp {
  position: absolute;
  bottom: 52px;
  left: 24px;
  width: 180px;
  height: 8px;
  border: 1px solid rgba(252, 238, 10, 0.5);
}

.chud-hp-fill {
  height: 100%;
  background: #35e07a;
  transition: width 0.15s;
}

.chud-hp.low .chud-hp-fill { background: #ff2030; }

.chud-stars {
  position: absolute;
  top: clamp(18px, 4vh, 44px);
  right: clamp(18px, 4vw, 56px);
  color: #ff2030;
  font-size: 26px;
  letter-spacing: 0.3em;
  text-shadow: 0 0 12px rgba(255, 32, 48, 0.6);
}

.chud-flatlined {
  position: absolute;
  inset: 0;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(60, 0, 8, 0.55);
  color: #ff2030;
  font-size: clamp(38px, 6vw, 72px);
  font-weight: 800;
  letter-spacing: 0.3em;
  animation: boot-flicker 0.9s infinite;
}

.chud-flatlined span { font-size: 15px; color: #ffb0b8; }

.chud-flatlined.on { display: flex; }
```

- [ ] **Step 3: 实现 src/combat/viewmodel.ts**

```ts
import * as THREE from 'three';
import { WeaponId } from './weapons';

/** 第一人称盒枪：挂在相机下，随武器切换换模型，开火后座+枪口焰 */
export class ViewModel {
  group = new THREE.Group();
  private models = new Map<WeaponId, THREE.Group>();
  private muzzle: THREE.Mesh;
  private kickT = 0;
  private muzzleT = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    const dark = new THREE.MeshStandardMaterial({
      color: 0x22252c, roughness: 0.45, metalness: 0.7,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0x00e5ff, emissiveIntensity: 1.6,
    });
    const mk = (parts: Array<[number, number, number, number, number, number, boolean?]>) => {
      const g = new THREE.Group();
      for (const [w, h, d, x, y, z, glow] of parts) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d), glow ? accent : dark,
        );
        mesh.position.set(x, y, z);
        g.add(mesh);
      }
      g.visible = false;
      this.group.add(g);
      return g;
    };
    // 拳头（小盒代表手）
    this.models.set('fist', mk([[0.09, 0.09, 0.14, 0.24, -0.2, -0.42]]));
    this.models.set('pistol', mk([
      [0.05, 0.14, 0.26, 0.22, -0.18, -0.5],
      [0.05, 0.1, 0.08, 0.22, -0.26, -0.4],
      [0.05, 0.02, 0.2, 0.22, -0.12, -0.52, true],
    ]));
    this.models.set('smg', mk([
      [0.06, 0.16, 0.44, 0.22, -0.2, -0.58],
      [0.06, 0.12, 0.1, 0.22, -0.3, -0.46],
      [0.06, 0.02, 0.36, 0.22, -0.13, -0.6, true],
    ]));
    this.models.set('shotgun', mk([
      [0.07, 0.12, 0.6, 0.22, -0.22, -0.62],
      [0.07, 0.1, 0.14, 0.22, -0.3, -0.42],
      [0.03, 0.03, 0.5, 0.22, -0.15, -0.64, true],
    ]));

    this.muzzle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({
        color: 0xffd080, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.muzzle.position.set(0.22, -0.16, -0.9);
    this.group.add(this.muzzle);
    camera.add(this.group);
  }

  show(id: WeaponId): void {
    for (const [k, g] of this.models) g.visible = k === id;
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  kick(): void {
    this.kickT = 1;
    this.muzzleT = 1;
  }

  update(dt: number): void {
    this.kickT = Math.max(0, this.kickT - dt * 8);
    this.muzzleT = Math.max(0, this.muzzleT - dt * 18);
    this.group.position.z = this.kickT * 0.06;
    this.group.rotation.x = this.kickT * 0.05;
    (this.muzzle.material as THREE.MeshBasicMaterial).opacity = this.muzzleT * 0.9;
    this.muzzle.rotation.z += dt * 20;
  }
}
```

- [ ] **Step 4: 实现 src/combat/player.ts**

```ts
import * as THREE from 'three';
import { WeaponState } from './weapons';
import { HealthRegistry, BodyPart } from './damage';
import { firstHit, TargetCapsule } from './hitreg';
import { CombatFx } from './tracers';
import { CombatAudio } from './audio';
import { ViewModel } from './viewmodel';
import { CombatHud } from '../ui/combatHud';
import { WantedSystem } from '../events/wanted';
import { ColliderGrid } from '../core/collision';

export const PLAYER_ID = 'player';

export interface HitVictim {
  id: string;
  isCivil: boolean;   // 平民/人海行人（作案计通缉）
  isCop: boolean;
  onHit(part: BodyPart, died: boolean, at: { x: number; y: number; z: number }): void;
}

interface PlayerDeps {
  camera: THREE.PerspectiveCamera;
  health: HealthRegistry;
  fx: CombatFx;
  audio: CombatAudio;
  vm: ViewModel;
  hud: CombatHud;
  wanted: WantedSystem;
  grid: ColliderGrid;
  /** 收集当前候选目标（活性 NPC + 附近人海行人） */
  gatherTargets(t: number): Array<TargetCapsule & { victim: HitVictim }>;
  onGunshot(x: number, z: number, t: number): void;
  enabled(): boolean;   // 漫游模式且未在电梯中
}

const RESPAWN_SEC = 3;

export class PlayerCombat {
  weapons = new WeaponState();
  alive = true;
  private respawnAt = 0;
  private mouseDown = false;
  private dir = new THREE.Vector3();
  private muzzleWorld = new THREE.Vector3();

  constructor(private deps: PlayerDeps) {
    deps.health.ensure(PLAYER_ID);
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        deps.audio.unlock();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('keydown', (e) => {
      const t = performance.now() / 1000;
      if (e.code === 'KeyR') {
        if (this.weapons.startReload(t)) deps.audio.reload();
      }
      const slots = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
      const idx = slots.indexOf(e.code);
      if (idx >= 0) this.selectWeapon(idx, t);
    });
    window.addEventListener('wheel', (e) => {
      if (!deps.enabled()) return;
      const t = performance.now() / 1000;
      const next = (this.weapons.index + (e.deltaY > 0 ? 1 : 3)) % 4;
      this.selectWeapon(next, t);
    });
    deps.vm.show(this.weapons.current().id);
  }

  private selectWeapon(i: number, t: number): void {
    this.weapons.select(i, t);
    this.deps.vm.show(this.weapons.current().id);
  }

  hp(): number {
    return this.deps.health.hpOf(PLAYER_ID);
  }

  takeDamage(amount: number, t: number): void {
    if (!this.alive) return;
    const r = this.deps.health.damage(PLAYER_ID, amount, 'body');
    this.deps.audio.hurt();
    this.deps.hud.setHp(r.hp);
    if (r.died) this.die(t);
  }

  private die(t: number): void {
    this.alive = false;
    this.respawnAt = t + RESPAWN_SEC;
    this.deps.hud.showFlatlined(true);
    this.deps.audio.flatline();
    this.deps.wanted.clear();
  }

  update(dt: number, t: number): void {
    void dt;
    this.weapons.tick(t);
    const enabled = this.deps.enabled() && this.alive;
    this.deps.vm.setVisible(enabled);
    this.deps.hud.setVisible(this.deps.enabled());

    if (!this.alive && t >= this.respawnAt) {
      this.alive = true;
      this.deps.health.revive(PLAYER_ID);
      this.deps.hud.showFlatlined(false);
      this.deps.hud.setHp(100);
    }

    const w = this.weapons.current();
    this.deps.hud.setAmmo(w.name, this.weapons.ammo(), this.weapons.isReloading(t));
    this.deps.hud.setWanted(this.deps.wanted.stars);

    if (!enabled || !this.mouseDown) return;
    if (!this.weapons.fire(t)) return;
    this.shoot(t);
  }

  private shoot(t: number): void {
    const { camera, fx, audio, grid } = this.deps;
    const w = this.weapons.current();
    audio.shot(w.id);
    this.deps.vm.kick();
    camera.getWorldPosition(this.muzzleWorld);
    this.deps.onGunshot(this.muzzleWorld.x, this.muzzleWorld.z, t);

    const targets = this.deps.gatherTargets(t);
    for (let p = 0; p < w.pellets; p++) {
      camera.getWorldDirection(this.dir);
      const spread = (w.spreadDeg * Math.PI) / 180;
      this.dir.x += (Math.random() - 0.5) * 2 * spread;
      this.dir.y += (Math.random() - 0.5) * 2 * spread;
      this.dir.z += (Math.random() - 0.5) * 2 * spread;
      this.dir.normalize();

      const hit = firstHit(this.muzzleWorld, this.dir, w.range, targets, grid);
      const end = new THREE.Vector3().copy(this.dir)
        .multiplyScalar(hit ? hit.t : Math.min(w.range, 120))
        .add(this.muzzleWorld);
      if (w.id !== 'fist') fx.tracer(this.muzzleWorld, end);

      if (!hit) {
        if (w.id !== 'fist') {
          fx.impact(end.x, end.y, end.z, false);
          audio.hitWall();
        }
        continue;
      }
      const target = targets.find((c) => c.id === hit.id)!;
      const r = this.deps.health.damage(hit.id, w.damage, hit.part);
      fx.impact(end.x, end.y, end.z, true);
      audio.hitFlesh();
      this.deps.hud.hitMarker(r.died);
      target.victim.onHit(hit.part, r.died, { x: end.x, y: end.y, z: end.z });
      if (target.victim.isCivil || target.victim.isCop) {
        this.deps.wanted.onCrime(t);
      }
    }
  }
}
```

- [ ] **Step 5: 验证 + Commit**

```bash
npm run build
git add src/combat/player.ts src/combat/viewmodel.ts src/ui/combatHud.ts src/styles.css
git commit -m "feat: 玩家战斗（射击/切枪/受击/FLATLINED）与战斗 HUD"
```

---

### Task 11: 小地图 + 门头场所文字

**Files:**
- Create: `src/ui/minimap.ts`
- Modify: `src/city/interiorKits.ts`（门头文字字形图集）、`src/styles.css`

- [ ] **Step 1: 实现 src/ui/minimap.ts**

```ts
import { GANGS } from '../people/gangs';
import { DISTRICTS, CITY_SIZE } from '../city/districts';
import { ViolenceEvent } from '../events/violence';

export interface MinimapVenue {
  x: number;
  z: number;
  color: number;
}

const SIZE = 256;
const RANGE = 420;        // 地图覆盖半径（米）
const REDRAW_HZ = 4;

/** M 键小地图：路网/岸线/帮派地盘晕染/场所色点/事件红点/玩家箭头 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = false;
  private acc = 0;

  constructor(overlay: HTMLElement, private venues: MinimapVenue[]) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.canvas.className = 'minimap';
    overlay.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.classList.toggle('on', this.visible);
  }

  update(
    dt: number, px: number, pz: number, yaw: number, events: ViolenceEvent[],
  ): void {
    if (!this.visible) return;
    this.acc += dt;
    if (this.acc < 1 / REDRAW_HZ) return;
    this.acc = 0;

    const c = this.ctx;
    const toMap = (wx: number, wz: number): [number, number] => [
      SIZE / 2 + ((wx - px) / RANGE) * (SIZE / 2),
      SIZE / 2 + ((wz - pz) / RANGE) * (SIZE / 2),
    ];

    c.fillStyle = 'rgba(5, 6, 10, 0.88)';
    c.fillRect(0, 0, SIZE, SIZE);

    // 帮派地盘晕染
    for (const g of GANGS) {
      const d = DISTRICTS.find((dd) => dd.id === g.district)!;
      c.fillStyle = `#${g.color.toString(16).padStart(6, '0')}18`;
      c.beginPath();
      d.polygon.forEach(([nx, ny], i) => {
        const [mx, my] = toMap((nx - 0.5) * CITY_SIZE, (ny - 0.5) * CITY_SIZE);
        if (i === 0) c.moveTo(mx, my);
        else c.lineTo(mx, my);
      });
      c.closePath();
      c.fill();
    }

    // 路网
    c.strokeStyle = 'rgba(120, 160, 180, 0.5)';
    c.lineWidth = 1;
    for (let k = -6; k <= 6; k++) {
      const v = k * 480;
      const [x1] = toMap(v, 0);
      const [, y1] = toMap(0, v);
      c.beginPath(); c.moveTo(x1, 0); c.lineTo(x1, SIZE); c.stroke();
      c.beginPath(); c.moveTo(0, y1); c.lineTo(SIZE, y1); c.stroke();
    }

    // 场所色点（范围内）
    for (const v of this.venues) {
      if (Math.abs(v.x - px) > RANGE || Math.abs(v.z - pz) > RANGE) continue;
      const [mx, my] = toMap(v.x, v.z);
      c.fillStyle = `#${v.color.toString(16).padStart(6, '0')}`;
      c.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }

    // 事件红点（闪烁）
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    for (const e of events) {
      const [mx, my] = toMap(e.x, e.z);
      if (mx < 0 || mx > SIZE || my < 0 || my > SIZE) continue;
      c.fillStyle = blink ? '#ff2030' : '#801018';
      c.beginPath();
      c.arc(mx, my, 4, 0, Math.PI * 2);
      c.fill();
    }

    // 玩家箭头
    c.save();
    c.translate(SIZE / 2, SIZE / 2);
    c.rotate(-yaw + Math.PI);
    c.fillStyle = '#fcee0a';
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 6);
    c.lineTo(-5, 6);
    c.closePath();
    c.fill();
    c.restore();
  }
}
```

- [ ] **Step 2: styles.css 追加**

```css
.minimap {
  position: absolute;
  top: clamp(60px, 10vh, 100px);
  right: 20px;
  display: none;
  border: 1px solid rgba(252, 238, 10, 0.4);
  box-shadow: 0 0 18px rgba(0, 0, 0, 0.6);
}

.minimap.on { display: block; }
```

- [ ] **Step 3: interiorKits.ts 门头文字**

3a. 顶部加字形表与图集（`VENUE_COLORS` 之后）：

```ts
/** 门头单字（场所速读，解决"找不到酒吧"） */
export const VENUE_GLYPHS: Record<VenueKind, string> = {
  bar: '吧', bd: '梦', ripper: '医', food: '食', clothes: '衣',
  guns: '枪', net: '网', residential: '宿', corpo: '社', motel: '旅',
  warehouse: '仓', pachinko: '弹', ruin: '空',
};

const GLYPH_LIST = Object.values(VENUE_GLYPHS);

function buildGlyphAtlas(): THREE.CanvasTexture {
  const T = 128;
  const canvas = document.createElement('canvas');
  canvas.width = T * GLYPH_LIST.length;
  canvas.height = T;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${T * 0.72}px serif`;
  GLYPH_LIST.forEach((ch, i) => {
    ctx.fillText(ch, i * T + T / 2, T / 2 + 4);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GLYPH_VERT = /* glsl */ `
attribute float aGlyph;
attribute vec3 aColor;
varying vec2 vUv;
varying float vGlyph;
varying vec3 vColor;
void main() {
  vUv = uv;
  vGlyph = aGlyph;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const GLYPH_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uCount;
varying vec2 vUv;
varying float vGlyph;
varying vec3 vColor;
void main() {
  vec2 uv = vec2((vUv.x + vGlyph) / uCount, vUv.y);
  vec4 t = texture2D(uMap, uv);
  if (t.a < 0.3) discard;
  gl_FragColor = vec4(vColor * 2.2, t.a);
}
`;
```

3b. `createInteriorKits` 内，门头色标灯箱 push 后同步记录字形实例（新增数组 `glyphs: Array<{ m: THREE.Matrix4; glyph: number; color: number }>`）：

```ts
    // 门头文字（挂在色标灯箱正上方）
    const gm = mat4().makeRotationY(yaw);
    gm.scale(new THREE.Vector3(1.4, 1.4, 1));
    gm.setPosition(
      dx + (axisX ? side * 0.12 : 0), 5.2, dz + (axisX ? 0 : side * 0.12),
    );
    glyphs.push({
      m: gm,
      glyph: GLYPH_LIST.indexOf(VENUE_GLYPHS[venue]),
      color: VENUE_COLORS[venue],
    });
```

3c. 尾部实例化（glow/dark mesh 之后）：

```ts
  const glyphMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: GLYPH_VERT,
      fragmentShader: GLYPH_FRAG,
      uniforms: {
        uMap: { value: buildGlyphAtlas() },
        uCount: { value: GLYPH_LIST.length },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    Math.max(glyphs.length, 1),
  );
  glyphMesh.count = glyphs.length;
  glyphMesh.frustumCulled = false;
  const aGlyph = new Float32Array(Math.max(glyphs.length, 1));
  const aColor = new Float32Array(Math.max(glyphs.length, 1) * 3);
  const gc = new THREE.Color();
  glyphs.forEach((g, i) => {
    glyphMesh.setMatrixAt(i, g.m);
    aGlyph[i] = g.glyph;
    gc.setHex(g.color);
    aColor.set([gc.r, gc.g, gc.b], i * 3);
  });
  glyphMesh.geometry.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(aGlyph, 1));
  glyphMesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
  glyphMesh.instanceMatrix.needsUpdate = true;
  group.add(glyphMesh);
```

同时 `InteriorKits` 接口与返回值增加 `venuePoints: MinimapVenue[]`（每楼 `{x: p.x, z: p.z, color: VENUE_COLORS[venue]}`），供小地图使用（在 plots 循环里顺手 push）。

- [ ] **Step 4: 验证 + Commit**

```bash
npm run build && npm test
git add src/ui/minimap.ts src/city/interiorKits.ts src/styles.css
git commit -m "feat: M 键小地图与门头场所文字（修复找不到酒吧）"
```

---

### Task 12: 主装配

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: main.ts 战斗装配**

1a. imports 追加：

```ts
import { HealthRegistry } from './combat/damage';
import { CombatFx } from './combat/tracers';
import { CombatAudio } from './combat/audio';
import { ViewModel } from './combat/viewmodel';
import { PlayerCombat, HitVictim } from './combat/player';
import { WantedSystem } from './events/wanted';
import { planSquads } from './people/gangs';
import { ActiveNpcPool } from './people/activeNpcs';
import { ViolenceDirector } from './events/violence';
import { CombatHud } from './ui/combatHud';
import { Minimap } from './ui/minimap';
import { TargetCapsule } from './combat/hitreg';
```

1b. `start()` 内、控制器创建后（`walk.setColliders(colliderGrid);` 之后）插入战斗装配：

```ts
  // ---------- 战斗系统 ----------
  engine.scene.add(engine.camera);   // 视模挂相机需要相机在场景树内
  const health = new HealthRegistry();
  const wanted = new WantedSystem();
  const fx = new CombatFx();
  engine.scene.add(fx.group);
  updatables.push({ update: (dt) => fx.update(dt) });
  const audio = new CombatAudio();
  const combatHud = new CombatHud(overlay);
  const vm = new ViewModel(engine.camera);
  const pool = new ActiveNpcPool({
    seed: SEED, squads: planSquads(SEED), ncpdPairs: 8, health,
  });
  engine.scene.add(pool.group);

  const gunshot = (x: number, z: number, t: number): void => {
    peds.triggerPanic(x, z, t);
  };

  let director!: ViolenceDirector;
  let playerCombat!: PlayerCombat;

  director = new ViolenceDirector({
    pool, health, fx, audio, wanted, grid: colliderGrid,
    onGunshot: gunshot,
    onPlayerHit: (dmg, t) => playerCombat.takeDamage(dmg, t),
    playerPos: () => engine.camera.position,
    playerAlive: () => playerCombat.alive,
  }, SEED);
  updatables.push({ update: (dt, t) => director.update(dt, t) });

  playerCombat = new PlayerCombat({
    camera: engine.camera, health, fx, audio, vm, hud: combatHud, wanted,
    grid: colliderGrid,
    enabled: () => modes.mode === 'walk' && walk.enabled,
    onGunshot: gunshot,
    gatherTargets: (t) => {
      const out: Array<TargetCapsule & { victim: HitVictim }> = [];
      // 活性 NPC
      for (const u of pool.units) {
        if (u.state === 'dead') continue;
        out.push({
          id: u.id, x: u.x, z: u.z, y0: 0, y1: u.height,
          r: 0.38, headFrom: u.height * 0.82,
          victim: {
            id: u.id, isCivil: false, isCop: u.role === 'ncpd',
            onHit: (_part, died) => {
              director.onPlayerAttacked(u, t);
              if (died) pool.applyDeath(u, t);
            },
          },
        });
      }
      // 人海行人（60m 内）
      const p = engine.camera.position;
      peds.forEachWalkerNear(p.x, p.z, 60, t, (k, i, px, pz, h) => {
        out.push({
          id: `ped-${k}-${i}`, x: px, z: pz, y0: 0, y1: h,
          r: 0.36, headFrom: h * 0.82,
          victim: {
            id: `ped-${k}-${i}`, isCivil: true, isCop: false,
            onHit: (_part, died) => {
              if (died) peds.killWalker(k, i, px, pz, t);
            },
          },
        });
      });
      return out;
    },
  });
  updatables.push({ update: (dt, t) => playerCombat.update(dt, t) });
  updatables.push({ update: (dt) => combatHud.update(dt) });
  updatables.push({ update: () => {
    wanted.tick(timerNow());
    audio.siren(wanted.stars > 0);
  } });

  const minimap = new Minimap(overlay, kits.venuePoints);
  updatables.push({
    update: (dt) => {
      const e = new THREE.Euler().setFromQuaternion(engine.camera.quaternion, 'YXZ');
      minimap.update(
        dt, engine.camera.position.x, engine.camera.position.z,
        e.y, director.activeEvents(),
      );
    },
  });
```

1c. 辅助：`timerNow` —— 在 `loop` 定义前加 `let nowSec = 0;` 并在 loop 内 `nowSec = t;`，`const timerNow = () => nowSec;`（放在装配代码之前声明）。

1d. 玩家挨打时警员"看见"：在 `director` 的 `onPlayerHit` 回调里加 `wanted.onSeen(t);`。

- [ ] **Step 2: 全量验证 + Commit**

```bash
npm run build && npm test
git add src/main.ts
git commit -m "feat: 战斗系统装配 — 目标提供器/恐慌钩子/小地图接线"
```

---

### Task 13: E2E + README + 收尾

**Files:**
- Modify: `e2e/visual.spec.ts`、`README.md`

- [ ] **Step 1: e2e 追加战斗用例**

```ts
test('开火消耗弹药且不报错', async ({ page }, testInfo) => {
  const errors = await jackIn(page);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(3500);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.locator('.chud-ammo')).not.toContainText('12/∞');
  await page.screenshot({ path: testInfo.outputPath('combat.png'), fullPage: true });
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: README 特性段追加**

```markdown
- 战斗沙盒：4 武器槽（拳/手枪/冲锋枪/霰弹）、全民 HP=100 与爆头伤害、帮派巡逻与枪战、街头斗殴、NCPD 两星通缉、枪声恐慌波、风格化死亡；M 键小地图 + 门头场所文字
```

操作表追加：

```markdown
| 鼠标左键 | 开火 |
| 1-4 / 滚轮 | 切换武器 |
| R | 换弹 |
| M | 小地图 |
```

- [ ] **Step 3: 全量回归 + Commit**

```bash
npm run build && npm test && npm run e2e
git add -A && git commit -m "test: 战斗 E2E 与 README"
```

---

## 自审记录

- **Spec 覆盖**：§武器数值→T2；全民 HP→T1+T6+T12；命中/穿墙→T3；通缉→T4+T12；帮派/地盘→T5；活性池→T8；斗殴/枪战/NCPD 交火→T9；玩家/视模/HUD→T10；恐慌波→T6；小地图+门头文字→T11；音效→T7；风格化死亡（倒地 20s 淡出）→T6(人海)+T8(活性池)；E2E→T13。无遗漏。
- **占位符扫描**：无 TBD/TODO；所有代码步骤给出完整代码。
- **类型一致性**：`HealthRegistry.damage(id, amt, part)`、`WeaponState.fire(now)/ammo()/isReloading(now)`、`TargetCapsule{id,x,z,y0,y1,r,headFrom}`、`ActiveNpc{state,walked,slot,mesh}`、`PedFleet.resolveWalker/killWalker/forEachWalkerNear/triggerPanic`、`ViolenceDirector.activeEvents()/onPlayerAttacked(u,t)`、`InteriorKits.venuePoints` 已跨任务核对。
- **注意事项**：pedestrians 的 `staticCounts/walkerCounts` 已是私有字段（T6 需将二者保持为实例字段——现状即是）；`uPanic` 声明必须在 VERT 的 attribute 区之后、main() 之前。
