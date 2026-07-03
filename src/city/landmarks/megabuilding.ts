import * as THREE from 'three';

/** Megabuilding H10：巨型收分巨构 + 层间光槽 */
export function createMegabuilding(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color: 0x11141c, roughness: 0.6, metalness: 0.5,
  });
  const widths = [300, 260, 220, 180];
  let y = 0;
  widths.forEach((w, i) => {
    const h = 55;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.85), body);
    m.position.y = y + h / 2;
    g.add(m);
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(w + 4, 2.5, w * 0.85 + 4),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: i % 2 === 0 ? 0xffa030 : 0x30c8ff,
        emissiveIntensity: 2,
      }),
    );
    slot.position.y = y + h;
    g.add(slot);
    y += h;
  });
  return g;
}
