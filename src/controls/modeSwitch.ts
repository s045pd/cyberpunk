import * as THREE from 'three';
import { FlyControls } from './flyControls';
import { WalkControls } from './walkControls';

export type Mode = 'fly' | 'walk';

const TRANSITION_SEC = 1.4;
const EYE_HEIGHT = 1.7;
const TAKEOFF_HEIGHT = 280;

function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

export class ModeManager {
  mode: Mode = 'fly';
  // 用真实时钟驱动过渡：低帧率设备上 dt 会被钳制，按帧累计会拖成慢动作
  private startedAt = -1;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private target: Mode = 'fly';
  private listeners: Array<(m: Mode) => void> = [];

  constructor(
    private camera: THREE.PerspectiveCamera,
    private fly: FlyControls,
    private walk: WalkControls,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF') this.toggle();
    });
  }

  onChange(fn: (m: Mode) => void): void {
    this.listeners.push(fn);
  }

  get transitioning(): boolean {
    return this.startedAt >= 0;
  }

  toggle(): void {
    if (this.transitioning) return;
    this.from.copy(this.camera.position);
    if (this.mode === 'fly') {
      this.target = 'walk';
      this.to.set(this.from.x, EYE_HEIGHT, this.from.z);
    } else {
      this.target = 'fly';
      this.to.set(this.from.x, TAKEOFF_HEIGHT, this.from.z);
    }
    this.fly.enabled = false;
    this.walk.enabled = false;
    this.startedAt = performance.now();
  }

  update(_dt: number): void {
    if (!this.transitioning) return;
    const elapsed = (performance.now() - this.startedAt) / 1000;
    const k = smooth(Math.min(elapsed / TRANSITION_SEC, 1));
    this.camera.position.lerpVectors(this.from, this.to, k);
    if (k >= 1) {
      this.startedAt = -1;
      this.mode = this.target;
      if (this.mode === 'walk') {
        this.walk.syncFromCamera();
        this.walk.enabled = true;
      } else {
        this.fly.syncFromCamera();
        this.fly.enabled = true;
      }
      for (const fn of this.listeners) fn(this.mode);
    }
  }
}
