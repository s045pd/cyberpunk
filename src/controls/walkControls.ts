import * as THREE from 'three';
import { ColliderGrid } from '../core/collision';

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 7;
const SPRINT_MULT = 2.2;

export class WalkControls {
  enabled = false;
  private colliders: ColliderGrid | null = null;

  setColliders(grid: ColliderGrid): void {
    this.colliders = grid;
  }
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - e.movementY * 0.0022, -1.5, 1.5,
      );
    });
  }

  syncFromCamera(): void {
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);

    const fwd = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const speed = WALK_SPEED * (this.keys.has('ShiftLeft') ? SPRINT_MULT : 1);

    // 只在水平面移动
    const dir = new THREE.Vector3(right, 0, -fwd);
    dir.applyAxisAngle(this.up, this.yaw);
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(speed * dt);

    const p = this.camera.position;
    p.add(dir);
    p.y = EYE_HEIGHT;
    if (this.colliders) {
      const [rx, rz] = this.colliders.resolve(p.x, p.z, 0.45);
      p.x = rx;
      p.z = rz;
    }
    const r = Math.hypot(p.x, p.z);
    if (r > 5600) {
      const k = 5600 / r;
      p.x *= k;
      p.z *= k;
    }
  }
}
