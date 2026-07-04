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
  walked: number;        // 驱动步态相位
  speed: number;
  homeX: number;
  homeZ: number;
  targetId: string | null;
  nextShotAt: number;
  diedAt: number;
  slot: number;
  mesh: 0 | 1;           // 0=平民体型（帮派/斗殴） 1=警察体型
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
  private freeSlots: [number[], number[]];

  constructor(opts: ActivePoolOptions) {
    this.rng = createRng((opts.seed ^ 0xac71) >>> 0);
    this.health = opts.health;

    const mk = (arch: 'man' | 'cop', cap: number): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(
        buildHumanGeometry(ARCHETYPES[arch]), this.material, cap,
      );
      mesh.count = cap;
      mesh.frustumCulled = false;
      const zero = new THREE.Matrix4().makeTranslation(0, -500, 0);
      const fill = (name: string, size: number, v: number[]) => {
        const arr = new Float32Array(cap * size);
        for (let i = 0; i < cap; i++) arr.set(v, i * size);
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

    // 帮派巡逻小队
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
    const clothesAttr = mesh.geometry.getAttribute('aClothes') as THREE.InstancedBufferAttribute;
    const accentAttr = mesh.geometry.getAttribute('aAccent') as THREE.InstancedBufferAttribute;
    (clothesAttr.array as Float32Array).set([c.r, c.g, c.b], slot * 3);
    (accentAttr.array as Float32Array).set([a.r, a.g, a.b], slot * 3);
    clothesAttr.needsUpdate = true;
    accentAttr.needsUpdate = true;
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

  /** 回收死亡超过 21s 的单位（槽位归还） */
  recycle(t: number): void {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.state === 'dead' && t - u.diedAt > 21) {
        const hide = new THREE.Matrix4().makeTranslation(0, -500, 0);
        this.meshes[u.mesh].setMatrixAt(u.slot, hide);
        this.meshes[u.mesh].instanceMatrix.needsUpdate = true;
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
    for (const u of this.units) {
      const mesh = this.meshes[u.mesh];
      if (u.state === 'dead') {
        const age = t - u.diedAt;
        const y = age > 20 ? 0.14 - (age - 20) * 0.6 : 0.14;
        q.setFromEuler(EULER.set(-Math.PI / 2, 0, u.yaw));
        s.setScalar(u.height);
        m.compose(POS.set(u.x, y, u.z), q, s);
      } else {
        q.setFromAxisAngle(UP, u.yaw);
        s.setScalar(u.height);
        m.compose(POS.set(u.x, 0, u.z), q, s);
      }
      mesh.setMatrixAt(u.slot, m);
      const move = mesh.geometry.getAttribute('aMove') as THREE.InstancedBufferAttribute;
      (move.array as Float32Array)[u.slot * 4 + 1] = u.walked;
    }
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.getAttribute('aMove').needsUpdate = true;
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const EULER = new THREE.Euler();
const POS = new THREE.Vector3();
