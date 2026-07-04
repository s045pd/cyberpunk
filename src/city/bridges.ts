import * as THREE from 'three';
import { Plot } from './layout';
import { DISTRICTS } from './districts';
import { createRng, range, pick } from '../core/rng';

const MAX_BRIDGES = 140;
const MIN_H = 70;

/** 楼间天桥：相邻高楼之间的连桥 + 桥底灯带 —— 城市峡谷的立体感 */
export function createBridges(plots: Plot[], seed: number): THREE.Group {
  const rng = createRng((seed ^ 0xb21d) >>> 0);
  const styleById = new Map(DISTRICTS.map((d) => [d.id, d.style]));

  // 空间网格加速邻居查找
  const CELL = 90;
  const grid = new Map<string, Plot[]>();
  const tall = plots.filter((p) => p.h > MIN_H);
  for (const p of tall) {
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
    const list = grid.get(key) ?? [];
    list.push(p);
    grid.set(key, list);
  }

  interface BridgeSpec { a: Plot; b: Plot; y: number; accent: number; }
  const specs: BridgeSpec[] = [];
  for (const p of tall) {
    if (specs.length >= MAX_BRIDGES) break;
    if (rng() > 0.12) continue;
    const cx = Math.floor(p.x / CELL);
    const cz = Math.floor(p.z / CELL);
    let best: Plot | null = null;
    let bestDist = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const q of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (q === p) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d > 34 && d < 85 && d < bestDist) {
            best = q;
            bestDist = d;
          }
        }
      }
    }
    if (!best) continue;
    const top = Math.min(p.h, best.h);
    specs.push({
      a: p,
      b: best,
      y: top * range(rng, 0.4, 0.85),
      accent: pick(rng, styleById.get(p.district)!.neonPalette),
    });
  }

  const group = new THREE.Group();
  if (specs.length === 0) return group;

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x191920, roughness: 0.8, metalness: 0.4,
  });
  const deck = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1), deckMat, specs.length,
  );
  deck.frustumCulled = false;

  // basic 材质无光照，配合 instanceColor 直接输出灯带颜色
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const strips = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1), stripMat, specs.length,
  );
  strips.frustumCulled = false;

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  specs.forEach((s, i) => {
    const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
    const yaw = Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z);
    pos.set((s.a.x + s.b.x) / 2, s.y, (s.a.z + s.b.z) / 2);
    quat.setFromAxisAngle(Y_AXIS, yaw);
    scl.set(4.2, 3.4, len);
    m.compose(pos, quat, scl);
    deck.setMatrixAt(i, m);

    // 桥底灯带
    pos.y = s.y - 2.0;
    scl.set(4.6, 0.35, len);
    m.compose(pos, quat, scl);
    strips.setMatrixAt(i, m);
    color.setHex(s.accent);
    strips.setColorAt(i, color);
  });
  deck.instanceMatrix.needsUpdate = true;
  strips.instanceMatrix.needsUpdate = true;
  if (strips.instanceColor) strips.instanceColor.needsUpdate = true;

  group.add(deck, strips);
  return group;
}
