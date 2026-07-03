import * as THREE from 'three';
import { districtAt, BADLANDS_LABEL } from '../city/districts';
import type { Mode } from '../controls/modeSwitch';

const TYPE_INTERVAL = 0.045;
const SCRAMBLE = '█▓▒░<>/\\|=+*';

export class Hud {
  private districtEl: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private keysEl: HTMLDivElement;
  private current = '';
  private reveal = 0;
  private typeTimer = 0;
  private pollTimer = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fpsText = '--';

  constructor(overlay: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="hud-district"></div>
      <div class="hud-keys"></div>
      <div class="hud-stats"></div>
    `;
    overlay.appendChild(root);
    this.districtEl = root.querySelector<HTMLDivElement>('.hud-district')!;
    this.keysEl = root.querySelector<HTMLDivElement>('.hud-keys')!;
    this.statsEl = root.querySelector<HTMLDivElement>('.hud-stats')!;
    this.setMode('fly');
  }

  setMode(mode: Mode): void {
    this.keysEl.textContent = mode === 'fly'
      ? 'WASD 移动 · QE 升降 · SHIFT 加速 · F 降落 · 点击画面锁定视角'
      : 'WASD 行走 · SHIFT 疾跑 · F 起飞 · 点击画面锁定视角';
  }

  setQualityName(name: string): void {
    this.statsEl.dataset.quality = name;
  }

  update(dt: number, cam: THREE.Vector3): void {
    // FPS 统计
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fpsText = String(Math.round(this.fpsFrames / this.fpsAcc));
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.statsEl.textContent =
      `FPS ${this.fpsText} · ${this.statsEl.dataset.quality ?? 'ULTRA'}`;

    // 区域轮询
    this.pollTimer -= dt;
    if (this.pollTimer <= 0) {
      this.pollTimer = 0.4;
      const label = districtAt(cam.x, cam.z)?.style.label ?? BADLANDS_LABEL;
      if (label !== this.current) {
        this.current = label;
        this.reveal = 0;
      }
    }

    // 打字机 + 扰码
    if (this.reveal < this.current.length) {
      this.typeTimer -= dt;
      if (this.typeTimer <= 0) {
        this.typeTimer = TYPE_INTERVAL;
        this.reveal++;
        const done = this.current.slice(0, this.reveal);
        const noise = this.reveal < this.current.length
          ? SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]
          : '';
        this.districtEl.textContent = done + noise;
      }
    }
  }
}
