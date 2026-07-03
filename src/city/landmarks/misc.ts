import * as THREE from 'three';
import { createRng, range } from '../../core/rng';

const DARK = new THREE.MeshStandardMaterial({
  color: 0x0d1018, roughness: 0.5, metalness: 0.6,
});

function emissiveMat(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: color, emissiveIntensity: intensity,
  });
}

/** Konpeki Plaza：细长塔 + 青色冠部 */
export function createKonpeki(): THREE.Group {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.BoxGeometry(70, 240, 70), DARK);
  tower.position.y = 120;
  g.add(tower);
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(76, 10, 76), emissiveMat(0x00e5ff, 3),
  );
  crown.position.y = 245;
  g.add(crown);
  return g;
}

/** Kabuki 市场穹顶 */
export function createKabukiDome(): THREE.Group {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x131018, roughness: 0.4, metalness: 0.7,
    }),
  );
  g.add(dome);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(90, 1.6, 8, 48), emissiveMat(0xff2975, 2.5),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 24;
  g.add(ring);
  return g;
}

/** Pacifica 烂尾大酒店：歪斜暗楼 + 极少灯 */
export function createPacificaRuin(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(160, 190, 110),
    new THREE.MeshStandardMaterial({
      color: 0x0a0c0c, roughness: 0.9, metalness: 0.2,
    }),
  );
  body.position.y = 95;
  body.rotation.z = 0.015;
  g.add(body);
  const cross = new THREE.Mesh(
    new THREE.BoxGeometry(60, 8, 4), emissiveMat(0x00ffd5, 1.5),
  );
  cross.position.set(0, 170, 57);
  g.add(cross);
  return g;
}

/** 恶土：风电桅杆 + 警示灯链 */
export function createBadlandsProps(seed: number): THREE.Group {
  const g = new THREE.Group();
  const rng = createRng((seed ^ 0xbad5) >>> 0);
  const lampMat = emissiveMat(0xff4020, 2);
  for (let i = 0; i < 40; i++) {
    const ang = range(rng, 0, Math.PI * 2);
    const r = range(rng, 4600, 7000);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const mast = new THREE.Mesh(new THREE.BoxGeometry(4, 90, 4), DARK);
    mast.position.set(x, 45, z);
    g.add(mast);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), lampMat);
    lamp.position.set(x, 92, z);
    g.add(lamp);
  }
  return g;
}
