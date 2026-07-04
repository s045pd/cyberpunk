import * as THREE from 'three';
import { ActiveNpcPool, ActiveNpc } from '../people/activeNpcs';
import { HealthRegistry } from '../combat/damage';
import { CombatFx } from '../combat/tracers';
import { CombatAudio } from '../combat/audio';
import { WantedSystem } from './wanted';
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
const AI_TICK = 0.1;

/**
 * 暴力导演：小队巡逻、敌对遭遇 → 枪战、随机斗殴、NCPD 敌意与追击玩家。
 * AI 0.1s 节流；每帧只做巡逻移动积分。
 */
export class ViolenceDirector {
  private rng: Rng;
  private events: ViolenceEvent[] = [];
  private nextBrawlAt = 10;
  private aiAccum = 0;
  /** 被玩家攻击过的帮派（结仇） */
  private hostileGangs = new Set<string>();

  constructor(private deps: DirectorDeps, seed: number) {
    this.rng = createRng((seed ^ 0x71e5) >>> 0);
  }

  /** 玩家攻击了某单位 → 结仇/通缉 */
  onPlayerAttacked(u: ActiveNpc, t: number): void {
    if (u.role === 'ganger' && u.gangId) this.hostileGangs.add(u.gangId);
    if (u.role === 'ncpd') this.deps.wanted.onCrime(t);
  }

  activeEvents(): ViolenceEvent[] {
    return this.events;
  }

  update(dt: number, t: number): void {
    const { pool } = this.deps;
    // 每帧：巡逻移动积分
    for (const u of pool.units) {
      if (u.state !== 'patrol') continue;
      const dx = u.homeX - u.x;
      const dz = u.homeZ - u.z;
      if (dx * dx + dz * dz > 1600 || this.rng() < 0.002) {
        u.yaw = Math.atan2(dx, dz) + range(this.rng, -0.6, 0.6);
      }
      u.x += Math.sin(u.yaw) * u.speed * dt;
      u.z += Math.cos(u.yaw) * u.speed * dt;
      u.walked += u.speed * dt;
    }
    this.events = this.events.filter((e) => e.until > t);

    this.aiAccum += dt;
    if (this.aiAccum >= AI_TICK) {
      this.aiAccum = 0;
      this.tickCombatAi(t);
      this.maybeSpawnBrawl(t);
    }
    pool.syncVisuals(t);
    pool.recycle(t);
  }

  /* ---------- 战斗 AI（0.1s 节流） ---------- */

  private tickCombatAi(t: number): void {
    const { pool } = this.deps;
    const player = this.deps.playerPos();
    const stars = this.deps.wanted.stars;

    for (const u of pool.units) {
      if (u.state === 'dead') continue;

      // 找最近敌人（含玩家）
      let enemy: ActiveNpc | 'player' | null = null;
      let bestD2 = NPC_FIRE_RANGE * NPC_FIRE_RANGE;
      for (const v of pool.units) {
        if (v === u || v.state === 'dead') continue;
        if (!this.hostile(u, v)) continue;
        const d2 = (u.x - v.x) ** 2 + (u.z - v.z) ** 2;
        if (d2 < bestD2) { bestD2 = d2; enemy = v; }
      }
      if (this.deps.playerAlive()) {
        const pHostile = (u.role === 'ncpd' && stars > 0)
          || (u.role === 'ganger' && u.gangId !== undefined
            && this.hostileGangs.has(u.gangId));
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
      const d = Math.sqrt(bestD2) || 1;

      if (u.weapon === 'fist' || u.state === 'brawl') {
        this.brawlStep(u, enemy, ex, ez, d, t);
        continue;
      }

      u.state = 'fight';
      // 走位：远则逼近，太近则侧移
      if (d > 30) {
        u.x += Math.sin(u.yaw) * 2.2 * AI_TICK;
        u.z += Math.cos(u.yaw) * 2.2 * AI_TICK;
        u.walked += 2.2 * AI_TICK;
      } else if (d < 12) {
        const side = u.slot % 2 === 0 ? 1 : -1;
        u.x += Math.cos(u.yaw) * 1.8 * AI_TICK * side;
        u.z -= Math.sin(u.yaw) * 1.8 * AI_TICK * side;
        u.walked += 1.8 * AI_TICK;
      }

      if (t < u.nextShotAt) continue;
      u.nextShotAt = t + (u.weapon === 'smg'
        ? range(this.rng, 0.15, 0.4) : range(this.rng, 0.6, 1.3));
      const dir = { x: (ex - u.x) / d, y: 0, z: (ez - u.z) / d };
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
    FROM.set(u.x, 1.5, u.z);
    TO.set(
      ex + range(this.rng, -0.8, 0.8), 1.4, ez + range(this.rng, -0.8, 0.8),
    );
    fx.tracer(FROM, TO);
    audio.shot(u.weapon === 'smg' ? 'smg' : 'pistol');
    this.deps.onGunshot(u.x, u.z, t);

    if (this.rng() > NPC_HIT_CHANCE) return;
    const dmg = Math.round(range(this.rng, 8, 15) * (1 - Math.min(d / 200, 0.4)));
    if (enemy === 'player') {
      this.deps.onPlayerHit(dmg, t);
      this.deps.wanted.onSeen(t);
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
    u: ActiveNpc, enemy: ActiveNpc | 'player', ex: number, ez: number,
    d: number, t: number,
  ): void {
    if (d > BRAWL_RANGE) {
      u.x += Math.sin(u.yaw) * 1.6 * AI_TICK;
      u.z += Math.cos(u.yaw) * 1.6 * AI_TICK;
      u.walked += 1.6 * AI_TICK;
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
    if (this.events.length >= 6) return;
    this.nextBrawlAt = t + range(this.rng, 20, 50);
    const p = this.deps.playerPos();
    const ang = range(this.rng, 0, Math.PI * 2);
    const r = range(this.rng, 80, 400);
    const x = p.x + Math.cos(ang) * r;
    const z = p.z + Math.sin(ang) * r;
    if (Math.hypot(x, z) > 3200) return;
    const n = 2 + Math.floor(this.rng() * 3);
    const brawlers = this.deps.pool.spawnBrawlers(x, z, n, t);
    if (brawlers.length >= 2) {
      this.markEvent(x, z, 'brawl', t + range(this.rng, 40, 80));
    }
  }

  private markEvent(
    x: number, z: number, kind: 'brawl' | 'shootout', until: number,
  ): void {
    this.events.push({ kind, x, z, until });
  }
}

const FROM = new THREE.Vector3();
const TO = new THREE.Vector3();
