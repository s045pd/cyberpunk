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
  isCivil: boolean;   // 平民（作案计通缉）
  isCop: boolean;
  onHit(part: BodyPart, died: boolean, at: { x: number; y: number; z: number }): void;
}

export type PlayerTarget = TargetCapsule & { victim: HitVictim };

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
  gatherTargets(t: number): PlayerTarget[];
  onGunshot(x: number, z: number, t: number): void;
  enabled(): boolean;   // 漫游模式才可用武器
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
      if (!deps.enabled()) return;
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
