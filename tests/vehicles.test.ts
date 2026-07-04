import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VehicleFleet, LaneDef } from '../src/traffic/vehicles';

function makeLanes(): LaneDef[] {
  return [
    {
      curve: new THREE.LineCurve3(
        new THREE.Vector3(-500, 0, 0),
        new THREE.Vector3(500, 0, 0),
      ),
      count: 10,
      speedRange: [10, 20],
    },
    {
      curve: new THREE.LineCurve3(
        new THREE.Vector3(0, 0, -500),
        new THREE.Vector3(0, 0, 500),
      ),
      count: 6,
      speedRange: [10, 20],
      dir: -1,
    },
  ];
}

describe('VehicleFleet', () => {
  it('实例总数等于各车道 count 之和', () => {
    const fleet = new VehicleFleet({
      lanes: makeLanes(), kinds: ['sedan', 'van', 'sport'], seed: 42,
    });
    const total = fleet.meshes.reduce((n, m) => n + m.count, 0);
    expect(total).toBe(16);
  });

  it('相同种子构建结果确定', () => {
    const a = new VehicleFleet({ lanes: makeLanes(), kinds: ['sedan'], seed: 7 });
    const b = new VehicleFleet({ lanes: makeLanes(), kinds: ['sedan'], seed: 7 });
    a.update(0.016, 0.016);
    b.update(0.016, 0.016);
    const ma = new THREE.Matrix4();
    const mb = new THREE.Matrix4();
    a.meshes[0].getMatrixAt(0, ma);
    b.meshes[0].getMatrixAt(0, mb);
    expect(ma.equals(mb)).toBe(true);
  });

  it('update 后车辆位置前进且保持有限值', () => {
    const fleet = new VehicleFleet({ lanes: makeLanes(), kinds: ['sedan'], seed: 3 });
    fleet.update(0.016, 0.016);
    const before = new THREE.Matrix4();
    fleet.meshes[0].getMatrixAt(0, before);
    for (let i = 0; i < 60; i++) fleet.update(0.1, i * 0.1);
    const after = new THREE.Matrix4();
    fleet.meshes[0].getMatrixAt(0, after);
    expect(after.equals(before)).toBe(false);
    const pos = new THREE.Vector3().setFromMatrixPosition(after);
    expect(Number.isFinite(pos.x)).toBe(true);
    expect(Math.abs(pos.x)).toBeLessThanOrEqual(520);
    expect(Math.abs(pos.z)).toBeLessThanOrEqual(520);
  });

  it('setDensity 按比例缩减可见实例', () => {
    const fleet = new VehicleFleet({
      lanes: makeLanes(), kinds: ['sedan', 'van'], seed: 9,
    });
    const full = fleet.meshes.reduce((n, m) => n + m.count, 0);
    fleet.setDensity(0.5);
    const half = fleet.meshes.reduce((n, m) => n + m.count, 0);
    expect(half).toBeLessThan(full);
    expect(half).toBeGreaterThan(0);
    fleet.setDensity(1);
    expect(fleet.meshes.reduce((n, m) => n + m.count, 0)).toBe(full);
  });
});
