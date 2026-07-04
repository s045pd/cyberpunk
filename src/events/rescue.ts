import * as THREE from 'three';
import { createRng, range, Rng } from '../core/rng';
import { IncidentSite } from './incidents';
import { buildVehicleGeometry, createVehicleMaterial } from '../traffic/vehicles';

type Phase = 'idle' | 'inbound' | 'descend' | 'hover' | 'ascend' | 'outbound';

interface Craft {
  phase: Phase;
  timer: number;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  site: IncidentSite | null;
}

const CRUISE_H = 220;
const HOVER_H = 11;
const CRUISE_SPEED = 68;
const VERT_SPEED = 14;

/** 创伤小队式救援 AV：巡航进场 → 降落悬停 → 撤离，循环于各救援现场 */
export class RescueDirector {
  group = new THREE.Group();
  private crafts: Craft[] = [];
  private mesh: THREE.InstancedMesh;
  private material: THREE.ShaderMaterial;
  private rng: Rng;

  constructor(private sites: IncidentSite[], seed: number, count = 2) {
    this.rng = createRng((seed ^ 0x7e5c) >>> 0);
    this.material = createVehicleMaterial();
    this.mesh = new THREE.InstancedMesh(
      buildVehicleGeometry('medevac'), this.material, count,
    );
    this.mesh.frustumCulled = false;

    const aBody = new Float32Array(count * 3);
    const aAccent = new Float32Array(count * 3);
    const aSeed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      aBody.set([0.85, 0.83, 0.78], i * 3);     // 白色机身
      aAccent.set([1.0, 0.35, 0.05], i * 3);    // 橙色推进辉光
      aSeed[i] = range(this.rng, 0, 100);
      this.crafts.push({
        phase: 'idle',
        timer: range(this.rng, 2, 10),
        pos: new THREE.Vector3(range(this.rng, -3000, 3000), CRUISE_H + 120, -4600),
        target: new THREE.Vector3(),
        yaw: 0,
        site: null,
      });
    }
    const geo = this.mesh.geometry;
    geo.setAttribute('aBody', new THREE.InstancedBufferAttribute(aBody, 3));
    geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(aAccent, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
    this.group.add(this.mesh);
  }

  private m = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private scl = new THREE.Vector3(1.6, 1.6, 1.6); // 医疗机比普通 AV 大一圈

  update(dt: number, t: number): void {
    this.material.uniforms.uTime.value = t;
    this.crafts.forEach((c, i) => {
      switch (c.phase) {
        case 'idle':
          c.timer -= dt;
          if (c.timer <= 0 && this.sites.length > 0) {
            c.site = this.sites[Math.floor(this.rng() * this.sites.length)];
            c.target.set(c.site.sx, CRUISE_H, c.site.sz);
            c.phase = 'inbound';
          }
          break;
        case 'inbound':
          if (this.moveToward(c, c.target, CRUISE_SPEED, dt)) {
            c.target.set(c.site!.sx, HOVER_H, c.site!.sz);
            c.phase = 'descend';
          }
          break;
        case 'descend':
          if (this.moveToward(c, c.target, VERT_SPEED, dt)) {
            c.phase = 'hover';
            c.timer = range(this.rng, 8, 13);
          }
          break;
        case 'hover':
          c.timer -= dt;
          c.pos.y = HOVER_H + Math.sin(t * 1.6 + i * 2.1) * 0.5;
          if (c.timer <= 0) {
            c.target.set(c.pos.x, CRUISE_H, c.pos.z);
            c.phase = 'ascend';
          }
          break;
        case 'ascend':
          if (this.moveToward(c, c.target, VERT_SPEED * 1.6, dt)) {
            c.target.set(
              range(this.rng, -3200, 3200), CRUISE_H + 140,
              this.rng() < 0.5 ? -4800 : 4800,
            );
            c.phase = 'outbound';
          }
          break;
        case 'outbound':
          if (this.moveToward(c, c.target, CRUISE_SPEED * 1.3, dt)) {
            c.phase = 'idle';
            c.timer = range(this.rng, 6, 16);
          }
          break;
      }
      this.quat.setFromAxisAngle(UP, c.yaw);
      this.m.compose(c.pos, this.quat, this.scl);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 朝目标移动，抵达返回 true；水平移动时更新机头朝向 */
  private moveToward(c: Craft, target: THREE.Vector3, speed: number, dt: number): boolean {
    const dx = target.x - c.pos.x;
    const dy = target.y - c.pos.y;
    const dz = target.z - c.pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < Math.max(speed * dt, 1.5)) {
      c.pos.copy(target);
      return true;
    }
    const k = (speed * dt) / dist;
    c.pos.x += dx * k;
    c.pos.y += dy * k;
    c.pos.z += dz * k;
    if (Math.hypot(dx, dz) > 4) c.yaw = Math.atan2(dx, dz);
    return false;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
