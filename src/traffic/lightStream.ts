import * as THREE from 'three';
import { createRng, range, Rng } from '../core/rng';

export interface StreamDef {
  curve: THREE.Curve<THREE.Vector3>;
  count: number;
  headColor: number;
  tailColor: number;
  speedRange: [number, number]; // 每秒推进的曲线参数比例
}

interface Vehicle {
  curveIdx: number;
  t: number;
  speed: number;
}

const SAMPLES = 512;

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const tmp = new THREE.Vector3();
function sampleAt(pts: THREE.Vector3[], t: number): THREE.Vector3 {
  const f = t * (pts.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  return tmp.copy(pts[i]).lerp(pts[Math.min(i + 1, pts.length - 1)], k);
}

/** 光点车流：每车 2 点（车头亮色 + 车尾红色），单 Points 一次 draw */
export class LightStream {
  points: THREE.Points;
  private vehicles: Vehicle[] = [];
  private samples: THREE.Vector3[][] = [];
  private positions: Float32Array;
  private visibleVehicles: number;

  constructor(defs: StreamDef[], seed: number) {
    const rng: Rng = createRng(seed >>> 0);
    const total = defs.reduce((n, d) => n + d.count, 0);
    this.positions = new Float32Array(total * 2 * 3);
    const colors = new Float32Array(total * 2 * 3);
    const head = new THREE.Color();
    const tail = new THREE.Color();

    let vi = 0;
    defs.forEach((def, ci) => {
      this.samples.push(def.curve.getSpacedPoints(SAMPLES));
      head.setHex(def.headColor);
      tail.setHex(def.tailColor);
      for (let k = 0; k < def.count; k++) {
        this.vehicles.push({
          curveIdx: ci,
          t: rng(),
          speed: range(rng, def.speedRange[0], def.speedRange[1]),
        });
        colors.set([head.r, head.g, head.b], vi * 6);
        colors.set([tail.r, tail.g, tail.b], vi * 6 + 3);
        vi++;
      }
    });
    this.visibleVehicles = this.vehicles.length;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 12,
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** 质量降档：只更新/显示前 fraction 比例的车辆 */
  setDensity(fraction: number): void {
    this.visibleVehicles = Math.floor(this.vehicles.length * fraction);
    this.points.geometry.setDrawRange(0, this.visibleVehicles * 2);
  }

  update(dt: number): void {
    const TAIL_GAP = 0.004;
    for (let i = 0; i < this.visibleVehicles; i++) {
      const v = this.vehicles[i];
      v.t = (v.t + v.speed * dt) % 1;
      const pts = this.samples[v.curveIdx];
      const headPos = sampleAt(pts, v.t);
      this.positions.set([headPos.x, headPos.y, headPos.z], i * 6);
      const tailPos = sampleAt(pts, (v.t - TAIL_GAP + 1) % 1);
      this.positions.set([tailPos.x, tailPos.y, tailPos.z], i * 6 + 3);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute)
      .needsUpdate = true;
  }
}
