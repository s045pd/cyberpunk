import * as THREE from 'three';
import { WeaponId } from './weapons';

type BoxSpec = [number, number, number, number, number, number, boolean?];

/** 第一人称盒枪：挂在相机下，随武器切换换模型，开火后座 + 枪口焰 */
export class ViewModel {
  group = new THREE.Group();
  private models = new Map<WeaponId, THREE.Group>();
  private muzzle: THREE.Mesh;
  private kickT = 0;
  private muzzleT = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    const dark = new THREE.MeshStandardMaterial({
      color: 0x22252c, roughness: 0.45, metalness: 0.7,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0x00e5ff, emissiveIntensity: 1.6,
    });
    const mk = (parts: BoxSpec[]): THREE.Group => {
      const g = new THREE.Group();
      for (const [w, h, d, x, y, z, glow] of parts) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d), glow ? accent : dark,
        );
        mesh.position.set(x, y, z);
        g.add(mesh);
      }
      g.visible = false;
      this.group.add(g);
      return g;
    };
    this.models.set('fist', mk([[0.09, 0.09, 0.14, 0.24, -0.2, -0.42]]));
    this.models.set('pistol', mk([
      [0.05, 0.14, 0.26, 0.22, -0.18, -0.5],
      [0.05, 0.1, 0.08, 0.22, -0.26, -0.4],
      [0.05, 0.02, 0.2, 0.22, -0.12, -0.52, true],
    ]));
    this.models.set('smg', mk([
      [0.06, 0.16, 0.44, 0.22, -0.2, -0.58],
      [0.06, 0.12, 0.1, 0.22, -0.3, -0.46],
      [0.06, 0.02, 0.36, 0.22, -0.13, -0.6, true],
    ]));
    this.models.set('shotgun', mk([
      [0.07, 0.12, 0.6, 0.22, -0.22, -0.62],
      [0.07, 0.1, 0.14, 0.22, -0.3, -0.42],
      [0.03, 0.03, 0.5, 0.22, -0.15, -0.64, true],
    ]));

    this.muzzle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({
        color: 0xffd080, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.muzzle.position.set(0.22, -0.16, -0.9);
    this.group.add(this.muzzle);
    camera.add(this.group);
  }

  show(id: WeaponId): void {
    for (const [k, g] of this.models) g.visible = k === id;
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  kick(): void {
    this.kickT = 1;
    this.muzzleT = 1;
  }

  update(dt: number): void {
    this.kickT = Math.max(0, this.kickT - dt * 8);
    this.muzzleT = Math.max(0, this.muzzleT - dt * 18);
    this.group.position.z = this.kickT * 0.06;
    this.group.rotation.x = this.kickT * 0.05;
    (this.muzzle.material as THREE.MeshBasicMaterial).opacity = this.muzzleT * 0.9;
    this.muzzle.rotation.z += dt * 20;
  }
}
