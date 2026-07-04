import * as THREE from 'three';
import { VehicleFleet, LaneDef } from './vehicles';

const WEST_LIMIT = -2050; // 岸线最东 -2080，见 water.ts coastXAt

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
    // 纵路：位于西侧海湾中的整条跳过
    if (c > WEST_LIMIT) {
      curves.push(new THREE.LineCurve3(
        new THREE.Vector3(c + LANE_OFFSET, ROAD_Y, -half),
        new THREE.Vector3(c + LANE_OFFSET, ROAD_Y, half),
      ));
      curves.push(new THREE.LineCurve3(
        new THREE.Vector3(c - LANE_OFFSET, ROAD_Y, half),
        new THREE.Vector3(c - LANE_OFFSET, ROAD_Y, -half),
      ));
    }
    // 横路：西端截断到岸线以东
    const x0 = Math.max(-half, WEST_LIMIT);
    if (x0 < half - 50) {
      curves.push(new THREE.LineCurve3(
        new THREE.Vector3(x0, ROAD_Y, c - LANE_OFFSET),
        new THREE.Vector3(half, ROAD_Y, c - LANE_OFFSET),
      ));
      curves.push(new THREE.LineCurve3(
        new THREE.Vector3(half, ROAD_Y, c + LANE_OFFSET),
        new THREE.Vector3(x0, ROAD_Y, c + LANE_OFFSET),
      ));
    }
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
    signalized: true,          // 受路口红绿灯控制
  }));
  return new VehicleFleet({
    lanes,
    kinds: ['sedan', 'van', 'sport', 'police'],
    kindWeights: [0.44, 0.22, 0.22, 0.12],   // NCPD 巡逻车混入车流
    seed: (seed ^ 0x60) >>> 0,
  });
}
