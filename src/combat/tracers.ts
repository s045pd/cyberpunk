import * as THREE from 'three';

const TRACER_MAX = 64;
const TRACER_LIFE = 0.08;
const PARTICLE_MAX = 512;
const PARTICLE_LIFE = 0.4;

/** 战斗特效池：曳光线段 + 命中火花/红色粒子（风格化，无持久痕迹） */
export class CombatFx {
  group = new THREE.Group();

  private tracerGeo = new THREE.BufferGeometry();
  private tracerPos = new Float32Array(TRACER_MAX * 6);
  private tracerAge = new Float32Array(TRACER_MAX).fill(Infinity);
  private tracerIdx = 0;

  private partGeo = new THREE.BufferGeometry();
  private partPos = new Float32Array(PARTICLE_MAX * 3);
  private partVel = new Float32Array(PARTICLE_MAX * 3);
  private partCol = new Float32Array(PARTICLE_MAX * 3);
  private partAge = new Float32Array(PARTICLE_MAX).fill(Infinity);
  private partIdx = 0;

  constructor() {
    this.partPos.fill(-500);
    this.tracerGeo.setAttribute(
      'position', new THREE.BufferAttribute(this.tracerPos, 3),
    );
    const tracers = new THREE.LineSegments(
      this.tracerGeo,
      new THREE.LineBasicMaterial({
        color: 0xffe9a0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    tracers.frustumCulled = false;
    this.group.add(tracers);

    this.partGeo.setAttribute('position', new THREE.BufferAttribute(this.partPos, 3));
    this.partGeo.setAttribute('color', new THREE.BufferAttribute(this.partCol, 3));
    const parts = new THREE.Points(
      this.partGeo,
      new THREE.PointsMaterial({
        size: 0.14, vertexColors: true, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      }),
    );
    parts.frustumCulled = false;
    this.group.add(parts);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const i = this.tracerIdx;
    this.tracerIdx = (this.tracerIdx + 1) % TRACER_MAX;
    this.tracerPos.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
    this.tracerAge[i] = 0;
  }

  /** 命中效果：blood=true 喷短促红色粒子（击中人体），否则白火花（打墙） */
  impact(x: number, y: number, z: number, blood: boolean): void {
    const n = blood ? 8 : 4;
    for (let k = 0; k < n; k++) {
      const i = this.partIdx;
      this.partIdx = (this.partIdx + 1) % PARTICLE_MAX;
      this.partPos.set([x, y, z], i * 3);
      this.partVel.set([
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4,
      ], i * 3);
      if (blood) this.partCol.set([0.8, 0.06, 0.05], i * 3);
      else this.partCol.set([1.0, 0.9, 0.6], i * 3);
      this.partAge[i] = 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < TRACER_MAX; i++) {
      if (this.tracerAge[i] > TRACER_LIFE) continue;
      this.tracerAge[i] += dt;
      if (this.tracerAge[i] > TRACER_LIFE) this.tracerPos.fill(0, i * 6, i * 6 + 6);
    }
    for (let i = 0; i < PARTICLE_MAX; i++) {
      if (this.partAge[i] > PARTICLE_LIFE) continue;
      this.partAge[i] += dt;
      if (this.partAge[i] > PARTICLE_LIFE) {
        this.partPos.set([0, -500, 0], i * 3);
        continue;
      }
      this.partVel[i * 3 + 1] -= 9.8 * dt;
      this.partPos[i * 3] += this.partVel[i * 3] * dt;
      this.partPos[i * 3 + 1] += this.partVel[i * 3 + 1] * dt;
      this.partPos[i * 3 + 2] += this.partVel[i * 3 + 2] * dt;
    }
    (this.tracerGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.partGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.partGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
