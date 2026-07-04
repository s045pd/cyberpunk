import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';

export const CYCLE = 16;        // 信号周期（秒）
export const GREEN_END = 7.4;   // 绿灯结束（之后 0.6s 黄灯 + 全红间隙）

const ROAD_SPACING = 480;
const ROAD_HALF_WIDTH = 14;
const CITY_RADIUS = 3200;
const WEST_LIMIT = -2050;

/**
 * 纯逻辑、可单测：路口 (ix,iz) 对某轴向车流是否绿灯。
 * axisZ = 沿 z 行驶（在 x=常量 的纵路上）。相邻路口相位棋盘交错形成绿波感。
 */
export function greenFor(axisZ: boolean, ix: number, iz: number, t: number): boolean {
  const offset = ((((ix + iz) % 2) + 2) % 2) * (CYCLE / 2);
  const ph = (((t + offset) % CYCLE) + CYCLE) % CYCLE;
  return axisZ ? ph < GREEN_END : (ph >= CYCLE / 2 && ph < CYCLE / 2 + GREEN_END);
}

/** 城区内所有受控路口的索引 */
export function listIntersections(): Array<{ ix: number; iz: number }> {
  const out: Array<{ ix: number; iz: number }> = [];
  for (let ix = -6; ix <= 6; ix++) {
    for (let iz = -6; iz <= 6; iz++) {
      const x = ix * ROAD_SPACING;
      const z = iz * ROAD_SPACING;
      if (Math.hypot(x, z) > CITY_RADIUS) continue;
      if (x < WEST_LIMIT) continue;
      out.push({ ix, iz });
    }
  }
  return out;
}

/* ---------- 灯头可视化：与 greenFor 同公式的 shader ---------- */

const HEAD_VERT = /* glsl */ `
attribute float aOffset;
attribute float aAxis;
varying float vOffset;
varying float vAxis;
varying float vDist;
void main() {
  vOffset = aOffset;
  vAxis = aAxis;
  vec4 world = instanceMatrix * vec4(position, 1.0);
  vec4 view = viewMatrix * world;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const HEAD_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vOffset;
varying float vAxis;
varying float vDist;
void main() {
  float ph = mod(uTime + vOffset, ${CYCLE.toFixed(1)});
  float local = vAxis > 0.5 ? ph : mod(ph + ${(CYCLE / 2).toFixed(1)}, ${CYCLE.toFixed(1)});
  vec3 col;
  if (local < ${GREEN_END.toFixed(1)}) col = vec3(0.15, 2.2, 0.5);        // 绿
  else if (local < ${(CYCLE / 2).toFixed(1)}) col = vec3(2.3, 1.4, 0.1);    // 黄/全红过渡
  else col = vec3(2.5, 0.12, 0.08);                              // 红
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface TrafficLights {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

export function createTrafficLights(): TrafficLights {
  const group = new THREE.Group();
  const inters = listIntersections();

  const headMat = new THREE.ShaderMaterial({
    vertexShader: HEAD_VERT,
    fragmentShader: HEAD_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
    },
  });

  // 每个路口 4 个灯头（对角两杆，各挂控制两个轴向的灯）+ 4 根灯杆
  const headCount = inters.length * 4;
  const heads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.55, 1.25, 0.55), headMat, headCount,
  );
  heads.frustumCulled = false;
  const poles = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 6.2, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.7, metalness: 0.5 }),
    headCount,
  );
  poles.frustumCulled = false;

  const aOffset = new Float32Array(headCount);
  const aAxis = new Float32Array(headCount);
  const m = new THREE.Matrix4();
  const D = ROAD_HALF_WIDTH + 1.6;
  let hi = 0;
  for (const { ix, iz } of inters) {
    const cx = ix * ROAD_SPACING;
    const cz = iz * ROAD_SPACING;
    const offset = ((((ix + iz) % 2) + 2) % 2) * (CYCLE / 2);
    // 四角：两个控 z 向车流，两个控 x 向车流
    const corners: Array<[number, number, number]> = [
      [cx + D, cz - D, 1], [cx - D, cz + D, 1],
      [cx - D, cz - D, 0], [cx + D, cz + D, 0],
    ];
    for (const [x, z, axis] of corners) {
      m.makeTranslation(x, 6.0, z);
      heads.setMatrixAt(hi, m);
      m.makeTranslation(x, 3.1, z);
      poles.setMatrixAt(hi, m);
      aOffset[hi] = offset;
      aAxis[hi] = axis;
      hi++;
    }
  }
  heads.geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 1));
  heads.geometry.setAttribute('aAxis', new THREE.InstancedBufferAttribute(aAxis, 1));
  heads.instanceMatrix.needsUpdate = true;
  poles.instanceMatrix.needsUpdate = true;
  group.add(heads, poles);

  return {
    group,
    update(_dt: number, t: number) {
      headMat.uniforms.uTime.value = t;
    },
  };
}
