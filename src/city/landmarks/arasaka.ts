import * as THREE from 'three';

const DARK = new THREE.MeshStandardMaterial({
  color: 0x0b0e16, roughness: 0.4, metalness: 0.8,
});

function slab(w: number, h: number, d: number, y: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), DARK);
  m.position.y = y + h / 2;
  return m;
}

function glowBand(w: number, d: number, y: number, color: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: color, emissiveIntensity: 2.5,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), mat);
  m.position.y = y;
  return m;
}

/** 荒坂塔：三段收分阶梯体量 + 红色警示光带，全城制高点 */
export function createArasakaTower(): THREE.Group {
  const g = new THREE.Group();
  g.add(slab(220, 220, 180, 0));
  g.add(slab(160, 180, 130, 220));
  g.add(slab(100, 140, 80, 400));
  g.add(glowBand(224, 184, 218, 0xff2020));
  g.add(glowBand(164, 134, 398, 0xff2020));
  g.add(glowBand(104, 84, 538, 0xff2020));
  // 顶部信标
  const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(14, 30, 14),
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff3030, emissiveIntensity: 4,
    }),
  );
  beacon.position.y = 555;
  g.add(beacon);
  return g;
}
