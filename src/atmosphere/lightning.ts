import * as THREE from 'three';
import { createRng, range, Rng } from '../core/rng';
import { Sky } from './sky';

/** 随机闪电：天空闪光 + 月光强度脉冲 */
export class LightningDirector {
  enabled = true;
  private flash = 0;
  private timer: number;
  private rng: Rng;

  constructor(
    private sky: Sky,
    private light: THREE.DirectionalLight,
    private baseIntensity: number,
    seed: number,
  ) {
    this.rng = createRng((seed ^ 0x11d) >>> 0);
    this.timer = range(this.rng, 6, 18);
  }

  update(dt: number): void {
    if (!this.enabled) {
      this.sky.setFlash(0);
      this.light.intensity = this.baseIntensity;
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.flash = range(this.rng, 0.7, 1.2);
      this.timer = range(this.rng, 8, 22);
    }
    this.flash *= Math.exp(-dt * 6);
    this.sky.setFlash(this.flash * 0.8);
    this.light.intensity = this.baseIntensity + this.flash * 3;
  }
}
