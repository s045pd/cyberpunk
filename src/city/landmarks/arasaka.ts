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
    color: 0x000000, emissive: color, emissiveIntensity: 1.5,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), mat);
  m.position.y = y;
  return m;
}

/** 竖向红色光缝（企业塔立面的警示灯槽） */
function seam(h: number, y: number, x: number, z: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xff2020, emissiveIntensity: 2.2,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, 2.4), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}

/** 荒坂塔：四段收分金字塔轮廓 + 红色光带/竖缝，全城制高点（~700m） */
export function createArasakaTower(): THREE.Group {
  const g = new THREE.Group();
  g.add(slab(260, 240, 210, 0));
  g.add(slab(200, 200, 160, 240));
  g.add(slab(140, 160, 110, 440));
  g.add(slab(70, 90, 55, 600));
  g.add(glowBand(261, 211, 238, 0xff2020));
  g.add(glowBand(201, 161, 438, 0xff2020));
  g.add(glowBand(141, 111, 598, 0xff2020));
  g.add(glowBand(71, 56, 688, 0xff2020));
  // 中段四条竖向红缝
  g.add(seam(190, 245, 101.5, 0));
  g.add(seam(190, 245, -101.5, 0));
  g.add(seam(190, 245, 0, 81.5));
  g.add(seam(190, 245, 0, -81.5));
  // 顶部信标
  const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(14, 30, 14),
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff3030, emissiveIntensity: 4,
    }),
  );
  beacon.position.y = 705;
  g.add(beacon);
  return g;
}
