import * as THREE from 'three';
import { createRng, range } from '../core/rng';
import { VehicleFleet, LaneDef } from './vehicles';

/** 纯几何、可单测：3 条环线 + 3 条穿城环，全部闭合 CatmullRom */
export function buildAirCurves(seed: number): THREE.CatmullRomCurve3[] {
  const rng = createRng((seed ^ 0xa17) >>> 0);
  const curves: THREE.CatmullRomCurve3[] = [];

  const ring = (radius: number, height: number, reverse: boolean) => {
    const pts: THREE.Vector3[] = [];
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = ((i / n) * Math.PI * 2) * (reverse ? -1 : 1);
      pts.push(new THREE.Vector3(
        Math.cos(a) * radius + range(rng, -40, 40),
        height + range(rng, -18, 18),
        Math.sin(a) * radius + range(rng, -40, 40),
      ));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  };

  curves.push(ring(2700, 260, false));
  curves.push(ring(2000, 380, true));
  curves.push(ring(1200, 460, false));

  // 穿城环：城内随机 6 点闭环
  for (let k = 0; k < 3; k++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      pts.push(new THREE.Vector3(
        range(rng, -2600, 2600),
        range(rng, 300, 460),
        range(rng, -2600, 2600),
      ));
    }
    curves.push(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.4));
  }
  return curves;
}

/** 空中车流：有体积的 AV 飞行器（推进器辉光 + 警示闪灯 + 悬浮起伏） */
export function createAirTraffic(seed: number): VehicleFleet {
  const lanes: LaneDef[] = buildAirCurves(seed).map((curve, i) => ({
    curve,
    count: 30,
    speedRange: [28, 55],           // 米/秒
    lateralOffset: (i % 2) * 8 - 4, // 同环双车道错开
  }));
  return new VehicleFleet({
    lanes, kinds: ['av'], seed: (seed ^ 0xa2) >>> 0, bob: 1.3,
  });
}
