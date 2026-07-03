export interface QualityParams {
  name: 'ULTRA' | 'HIGH' | 'LOW';
  renderScale: number;
  rainScale: number;
  trafficScale: number;
  bloomIntensity: number;
  chromatic: boolean;
  lightning: boolean;
}

export const QUALITY_PRESETS: QualityParams[] = [
  {
    name: 'ULTRA', renderScale: 1.0, rainScale: 1.0, trafficScale: 1.0,
    bloomIntensity: 1.15, chromatic: true, lightning: true,
  },
  {
    name: 'HIGH', renderScale: 0.85, rainScale: 0.6, trafficScale: 0.6,
    bloomIntensity: 1.0, chromatic: false, lightning: true,
  },
  {
    name: 'LOW', renderScale: 0.7, rainScale: 0.3, trafficScale: 0.3,
    bloomIntensity: 0.55, chromatic: false, lightning: false,
  },
];

/** 按窗口统计 FPS，低于阈值时建议降档（每窗口至多一次） */
export class QualityMonitor {
  level = 0;
  locked = false;
  private acc = 0;
  private frames = 0;

  constructor(
    private windowSec = 3,
    private minFps = 45,
  ) {}

  lock(): void {
    this.locked = true;
  }

  /** 返回 true 表示本帧触发了降档，调用方应用 QUALITY_PRESETS[level] */
  addFrame(dt: number): boolean {
    if (this.locked || this.level >= QUALITY_PRESETS.length - 1) return false;
    this.acc += dt;
    this.frames++;
    if (this.acc < this.windowSec) return false;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (fps < this.minFps) {
      this.level++;
      return true;
    }
    return false;
  }
}
