import * as THREE from 'three';

const BOOST_MULT = 5;
const BASE_SPEED = 160;

export class FlyControls {
  enabled = true;
  private yaw = 0;
  private pitch = -0.12;
  private vel = new THREE.Vector3();
  private keys = new Set<string>();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('click', () => {
      if (this.enabled && document.pointerLockElement !== dom) {
        dom.requestPointerLock();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - e.movementY * 0.0022, -1.45, 1.45,
      );
    });
  }

  /** 供模式切换时同步视角 */
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
    const up = Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));
    const speed = BASE_SPEED * (this.keys.has('ShiftLeft') ? BOOST_MULT : 1);

    const target = new THREE.Vector3(right, 0, -fwd)
      .applyQuaternion(this.camera.quaternion);
    target.y += up;
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(speed);

    this.vel.lerp(target, 1 - Math.exp(-dt * 6));
    this.camera.position.addScaledVector(this.vel, dt);

    // 边界软约束
    const p = this.camera.position;
    p.y = THREE.MathUtils.clamp(p.y, 4, 1600);
    const r = Math.hypot(p.x, p.z);
    if (r > 5600) {
      const k = 5600 / r;
      p.x *= k; p.z *= k;
    }
  }
}
