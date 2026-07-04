import * as THREE from 'three';
import { VehicleFleet, LaneDef } from './vehicles';

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

/** 地面车流：真实车体（轿车/厢货/跑车），贴地行驶 */
export function createGroundTraffic(seed: number): VehicleFleet {
  const lanes: LaneDef[] = buildRoadCurves().map((curve) => ({
    curve,
    count: 40,
    speedRange: [9, 20],       // 米/秒，市区速度
    yOffset: -ROAD_Y + 0.05,   // 曲线在 y=3，车轮贴回路面
  }));
  return new VehicleFleet({
    lanes, kinds: ['sedan', 'van', 'sport'], seed: (seed ^ 0x60) >>> 0,
  });
}
