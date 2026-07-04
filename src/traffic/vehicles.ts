import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range, pick, Rng } from '../core/rng';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';

export type VehicleKind = 'sedan' | 'van' | 'sport' | 'av';

export interface LaneDef {
  curve: THREE.Curve<THREE.Vector3>;
  count: number;
  /** 米/秒（内部按曲线长度换算） */
  speedRange: [number, number];
  /** 沿行进方向右侧的水平偏移（米） */
  lateralOffset?: number;
  /** 相对曲线点的高度偏移（米） */
  yOffset?: number;
  /** -1 反向行驶 */
  dir?: 1 | -1;
}

export interface FleetOptions {
  lanes: LaneDef[];
  kinds: VehicleKind[];
  seed: number;
  /** 悬浮起伏幅度（AV 用，米） */
  bob?: number;
}

/* ---------- 车体几何：分区发光（aPart 顶点属性） ---------- */
// 0 车身 / 1 车头灯 / 2 车尾灯 / 3 玻璃 / 4 氛围底光 / 5 推进器 / 6 警示闪灯

function partBox(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  part: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const n = g.getAttribute('position').count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  return g;
}

/** 车头朝 +z；底部贴 y=0 */
function buildVehicleGeometry(kind: VehicleKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  switch (kind) {
    case 'van':
      parts.push(
        partBox(2.1, 1.9, 5.0, 0, 1.15, 0, 0),          // 厢体
        partBox(1.9, 0.6, 0.1, 0, 1.6, 2.5, 3),          // 前风挡
        partBox(0.5, 0.22, 0.12, -0.7, 0.7, 2.52, 1),    // 头灯 ×2
        partBox(0.5, 0.22, 0.12, 0.7, 0.7, 2.52, 1),
        partBox(1.7, 0.2, 0.1, 0, 0.8, -2.52, 2),        // 尾灯条
      );
      break;
    case 'sport':
      parts.push(
        partBox(2.1, 0.55, 4.4, 0, 0.5, 0, 0),           // 低矮车身
        partBox(1.7, 0.45, 1.9, 0, 0.98, -0.3, 3),       // 座舱玻璃
        partBox(0.42, 0.14, 0.12, -0.72, 0.55, 2.2, 1),
        partBox(0.42, 0.14, 0.12, 0.72, 0.55, 2.2, 1),
        partBox(1.9, 0.14, 0.1, 0, 0.62, -2.22, 2),      // 贯穿尾灯
        partBox(1.9, 0.06, 3.9, 0, 0.2, 0, 4),           // 氛围底光
      );
      break;
    case 'av':
      parts.push(
        partBox(2.4, 1.2, 5.4, 0, 1.0, 0, 0),            // 主舱
        partBox(2.0, 0.7, 1.8, 0, 1.75, 1.2, 3),         // 前座舱罩
        partBox(0.7, 0.9, 1.6, -1.55, 0.9, -0.4, 0),     // 侧吊舱 ×2
        partBox(0.7, 0.9, 1.6, 1.55, 0.9, -0.4, 0),
        partBox(0.6, 0.1, 1.4, -1.55, 0.4, -0.4, 5),     // 推进器 ×2
        partBox(0.6, 0.1, 1.4, 1.55, 0.4, -0.4, 5),
        partBox(1.8, 0.18, 0.12, 0, 0.9, 2.72, 1),       // 前灯条
        partBox(2.0, 0.18, 0.12, 0, 0.9, -2.72, 2),      // 尾灯条
        partBox(0.16, 0.16, 0.16, 0, 1.7, -2.4, 6),      // 顶部警示闪灯
      );
      break;
    default: // sedan
      parts.push(
        partBox(2.0, 0.85, 4.6, 0, 0.72, 0, 0),          // 底盘车身
        partBox(1.8, 0.62, 2.3, 0, 1.45, -0.35, 3),      // 座舱玻璃
        partBox(0.45, 0.18, 0.12, -0.68, 0.75, 2.32, 1),
        partBox(0.45, 0.18, 0.12, 0.68, 0.75, 2.32, 1),
        partBox(1.6, 0.16, 0.1, 0, 0.8, -2.32, 2),
      );
  }
  return mergeGeometries(parts);
}

/* ---------- 材质：分区发光 + 雾 ---------- */

const VERT = /* glsl */ `
attribute float aPart;
attribute vec3 aBody;
attribute vec3 aAccent;
attribute float aSeed;
varying float vPart;
varying vec3 vBody;
varying vec3 vAccent;
varying float vSeed;
varying vec3 vNormal;
varying float vDist;
void main() {
  vPart = aPart;
  vBody = aBody;
  vAccent = aAccent;
  vSeed = aSeed;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  vec4 world = instanceMatrix * vec4(position, 1.0);
  vec4 view = viewMatrix * world;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vPart;
varying vec3 vBody;
varying vec3 vAccent;
varying float vSeed;
varying vec3 vNormal;
varying float vDist;

void main() {
  vec3 n = normalize(vNormal);
  vec3 col;
  if (vPart < 0.5) {
    // 车漆：暗色 + 顶面街光泛光
    col = vBody * (0.35 + 0.5 * max(n.y, 0.0))
        + vec3(0.35, 0.22, 0.10) * max(n.y, 0.0) * 0.12;
  } else if (vPart < 1.5) {
    col = vec3(2.2, 2.1, 1.75);                    // 头灯
  } else if (vPart < 2.5) {
    col = vec3(2.4, 0.10, 0.08);                   // 尾灯
  } else if (vPart < 3.5) {
    col = vec3(0.02, 0.03, 0.05) + vBody * 0.08;   // 玻璃
  } else if (vPart < 4.5) {
    col = vAccent * 1.7;                           // 氛围底光
  } else if (vPart < 5.5) {
    float pulse = 1.5 + 0.5 * sin(uTime * 26.0 + vSeed * 20.0);
    col = vAccent * pulse;                         // 推进器
  } else {
    float blink = step(0.62, fract(uTime * 1.1 + vSeed));
    col = vec3(2.2, 0.15, 0.12) * blink;           // 警示闪灯
  }
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------- 车队 ---------- */

const BODY_PALETTE = [
  0x1a1c20, 0x24262c, 0x101418, 0x0e1a22,
  0x5a1616, 0x143a4a, 0x2c2436, 0xb8901e, // 最后一个是出租车黄
];
const ACCENT_PALETTE = [0x00e5ff, 0xff2975, 0xb96bff, 0x00ffd5, 0xff6a00];
const SAMPLES = 512;

interface Vehicle {
  laneIdx: number;
  t: number;
  speed: number;      // 曲线参数比例/秒（含方向符号）
  lateral: number;
  yOffset: number;
  bobPhase: number;
}

export class VehicleFleet {
  group = new THREE.Group();
  meshes: THREE.InstancedMesh[] = [];
  private byKind: Vehicle[][] = [];
  private fullCounts: number[] = [];
  private samples: THREE.Vector3[][] = [];
  private material: THREE.ShaderMaterial;
  private bob: number;

  constructor(opts: FleetOptions) {
    const rng: Rng = createRng(opts.seed >>> 0);
    this.bob = opts.bob ?? 0;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: new THREE.Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
      },
    });

    // 车辆生成并按车型分桶
    this.byKind = opts.kinds.map(() => []);
    opts.lanes.forEach((lane, laneIdx) => {
      this.samples.push(lane.curve.getSpacedPoints(SAMPLES));
      const length = Math.max(lane.curve.getLength(), 1);
      const dir = lane.dir ?? 1;
      for (let i = 0; i < lane.count; i++) {
        const kindIdx = Math.floor(rng() * opts.kinds.length);
        this.byKind[kindIdx].push({
          laneIdx,
          t: rng(),
          speed: (range(rng, lane.speedRange[0], lane.speedRange[1]) / length) * dir,
          lateral: lane.lateralOffset ?? 0,
          yOffset: lane.yOffset ?? 0,
          bobPhase: range(rng, 0, Math.PI * 2),
        });
      }
    });

    // 每车型一个 InstancedMesh + 每实例外观属性
    const body = new THREE.Color();
    const accent = new THREE.Color();
    opts.kinds.forEach((kind, kindIdx) => {
      const list = this.byKind[kindIdx];
      const n = Math.max(list.length, 1);
      const mesh = new THREE.InstancedMesh(buildVehicleGeometry(kind), this.material, n);
      mesh.count = list.length;
      mesh.frustumCulled = false;
      const aBody = new Float32Array(n * 3);
      const aAccent = new Float32Array(n * 3);
      const aSeed = new Float32Array(n);
      for (let i = 0; i < list.length; i++) {
        body.setHex(pick(rng, BODY_PALETTE));
        aBody.set([body.r, body.g, body.b], i * 3);
        // 地面车约 1/4 有氛围底光；AV/跑车必亮
        const glowOn = kind === 'av' || kind === 'sport' || rng() < 0.25;
        accent.setHex(glowOn ? pick(rng, ACCENT_PALETTE) : 0x000000);
        aAccent.set([accent.r, accent.g, accent.b], i * 3);
        aSeed[i] = range(rng, 0, 100);
      }
      const geo = mesh.geometry;
      geo.setAttribute('aBody', new THREE.InstancedBufferAttribute(aBody, 3));
      geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(aAccent, 3));
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
      this.fullCounts.push(list.length);
      this.meshes.push(mesh);
      this.group.add(mesh);
    });

    this.update(0, 0); // 初始摆位
  }

  setDensity(fraction: number): void {
    this.meshes.forEach((mesh, k) => {
      mesh.count = Math.max(1, Math.floor(this.fullCounts[k] * fraction));
    });
  }

  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private scl = new THREE.Vector3(1, 1, 1);
  private m = new THREE.Matrix4();
  private ahead = new THREE.Vector3();

  update(dt: number, t: number): void {
    this.material.uniforms.uTime.value = t;
    const EPS = 2 / SAMPLES;
    this.meshes.forEach((mesh, kindIdx) => {
      const list = this.byKind[kindIdx];
      const visible = mesh.count;
      for (let i = 0; i < visible; i++) {
        const v = list[i];
        v.t = ((v.t + v.speed * dt) % 1 + 1) % 1;
        const pts = this.samples[v.laneIdx];
        sampleAt(pts, v.t, this.pos);
        sampleAt(pts, ((v.t + EPS * Math.sign(v.speed || 1)) % 1 + 1) % 1, this.ahead);
        const dx = this.ahead.x - this.pos.x;
        const dz = this.ahead.z - this.pos.z;
        const yaw = Math.atan2(dx, dz);
        // 车道横向偏移（行进方向右侧）
        const len = Math.hypot(dx, dz) || 1;
        this.pos.x += (dz / len) * v.lateral;
        this.pos.z += (-dx / len) * v.lateral;
        this.pos.y += v.yOffset
          + (this.bob > 0 ? Math.sin(t * 1.9 + v.bobPhase) * this.bob : 0);
        this.quat.setFromAxisAngle(UP, yaw);
        this.m.compose(this.pos, this.quat, this.scl);
        mesh.setMatrixAt(i, this.m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
}

const UP = new THREE.Vector3(0, 1, 0);

const tmpA = new THREE.Vector3();
function sampleAt(pts: THREE.Vector3[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const f = t * (pts.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  tmpA.copy(pts[Math.min(i + 1, pts.length - 1)]);
  return out.copy(pts[i]).lerp(tmpA, k);
}
