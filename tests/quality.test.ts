import { describe, it, expect } from 'vitest';
import { QualityMonitor, QUALITY_PRESETS } from '../src/core/quality';

/** 连续喂 seconds 秒、恒定 fps 的帧 */
function feed(m: QualityMonitor, fps: number, seconds: number): boolean[] {
  const dt = 1 / fps;
  const results: boolean[] = [];
  for (let i = 0; i < Math.ceil(seconds * fps); i++) results.push(m.addFrame(dt));
  return results;
}

describe('QUALITY_PRESETS', () => {
  it('三档且各参数单调不升', () => {
    expect(QUALITY_PRESETS.map((p) => p.name)).toEqual(['ULTRA', 'HIGH', 'LOW']);
    for (let i = 1; i < QUALITY_PRESETS.length; i++) {
      expect(QUALITY_PRESETS[i].renderScale)
        .toBeLessThanOrEqual(QUALITY_PRESETS[i - 1].renderScale);
      expect(QUALITY_PRESETS[i].rainScale)
        .toBeLessThanOrEqual(QUALITY_PRESETS[i - 1].rainScale);
      expect(QUALITY_PRESETS[i].trafficScale)
        .toBeLessThanOrEqual(QUALITY_PRESETS[i - 1].trafficScale);
    }
  });
});

describe('QualityMonitor', () => {
  it('低帧率满窗口后建议降档一次', () => {
    const m = new QualityMonitor(3, 45);
    const results = feed(m, 30, 3.2);
    expect(results.filter(Boolean).length).toBe(1);
    expect(m.level).toBe(1);
  });

  it('高帧率不降档', () => {
    const m = new QualityMonitor(3, 45);
    const results = feed(m, 60, 10);
    expect(results.every((r) => !r)).toBe(true);
    expect(m.level).toBe(0);
  });

  it('持续低帧率最多降到 LOW 档为止', () => {
    const m = new QualityMonitor(3, 45);
    feed(m, 20, 30);
    expect(m.level).toBe(QUALITY_PRESETS.length - 1);
  });

  it('锁定后不再降档', () => {
    const m = new QualityMonitor(3, 45);
    m.lock();
    const results = feed(m, 15, 10);
    expect(results.every((r) => !r)).toBe(true);
    expect(m.level).toBe(0);
  });
});
