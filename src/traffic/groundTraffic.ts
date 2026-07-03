import * as THREE from 'three';
import { LightStream, StreamDef } from './lightStream';

const ROAD_SPACING = 480;   // 与 layout.ts 对齐
const CITY_RADIUS = 3400;
const LANE_OFFSET = 9;
const ROAD_Y = 3;

/** 纯几何、可单测：路网直线（双轴向、城市圆内截断、双向双车道） */
export function buildRoadCurves(): THREE.LineCurve3[] {
  const curves: THREE.LineCurve3[] = [];
  for (let k = -6; k <= 6; k++) {
    const c = k * ROAD_SPACING;
    if (Math.abs(c) + LANE_OFFSET >= CITY_RADIUS) continue;
    // 半长按外侧车道计算，保证端点仍在城市半径内
    const half = Math.sqrt(
      CITY_RADIUS * CITY_RADIUS - (Math.abs(c) + LANE_OFFSET) ** 2,
    );
    curves.push(new THREE.LineCurve3(
      new THREE.Vector3(c + LANE_OFFSET, ROAD_Y, -half),
      new THREE.Vector3(c + LANE_OFFSET, ROAD_Y, half),
    ));
    curves.push(new THREE.LineCurve3(
      new THREE.Vector3(c - LANE_OFFSET, ROAD_Y, half),
      new THREE.Vector3(c - LANE_OFFSET, ROAD_Y, -half),
    ));
    curves.push(new THREE.LineCurve3(
      new THREE.Vector3(-half, ROAD_Y, c - LANE_OFFSET),
      new THREE.Vector3(half, ROAD_Y, c - LANE_OFFSET),
    ));
    curves.push(new THREE.LineCurve3(
      new THREE.Vector3(half, ROAD_Y, c + LANE_OFFSET),
      new THREE.Vector3(-half, ROAD_Y, c + LANE_OFFSET),
    ));
  }
  return curves;
}

export function createGroundTraffic(seed: number): LightStream {
  const defs: StreamDef[] = buildRoadCurves().map((curve) => ({
    curve,
    count: 26,
    headColor: 0xffffff,
    tailColor: 0xff2010,
    speedRange: [0.01, 0.03],
  }));
  return new LightStream(defs, (seed ^ 0x60) >>> 0);
}
