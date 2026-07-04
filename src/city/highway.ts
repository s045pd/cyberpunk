import * as THREE from 'three';
import { createRng, range } from '../core/rng';
import { LightStream, StreamDef } from '../traffic/lightStream';

const DECK_SEGMENTS = 240;

export interface Highway {
  group: THREE.Group;
  update(dt: number): void;
  setDensity(fraction: number): void;
}

/** 高架环线曲线：一圆一椭圆，穿行于楼群之间 */
export function buildHighwayCurves(seed: number): THREE.CatmullRomCurve3[] {
  const rng = createRng((seed ^ 0x419a) >>> 0);
  const loops: Array<{ rx: number; rz: number; rot: number; h: number }> = [
    { rx: 1750, rz: 1750, rot: 0, h: 26 },
    { rx: 2600, rz: 1250, rot: 0.55, h: 34 },
  ];
  return loops.map(({ rx, rz, rot, h }) => {
    const pts: THREE.Vector3[] = [];
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * rx;
      const z = Math.sin(a) * rz;
      pts.push(new THREE.Vector3(
        x * Math.cos(rot) - z * Math.sin(rot) + range(rng, -30, 30),
        h + range(rng, -2, 2),
        x * Math.sin(rot) + z * Math.cos(rot) + range(rng, -30, 30),
      ));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  });
}

export function createHighway(seed: number): Highway {
  const group = new THREE.Group();
  const curves = buildHighwayCurves(seed);

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x24242a, roughness: 0.85, metalness: 0.3,
  });
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x1c1c22, roughness: 0.9, metalness: 0.2,
  });

  const deckCount = curves.length * DECK_SEGMENTS;
  const deck = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1), deckMat, deckCount,
  );
  deck.frustumCulled = false;
  const pillarCount = curves.length * (DECK_SEGMENTS / 4);
  const pillars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1), pillarMat, pillarCount,
  );
  pillars.frustumCulled = false;

  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const edgeDots: number[] = [];

  let di = 0;
  let pi = 0;
  for (const curve of curves) {
    const pts = curve.getSpacedPoints(DECK_SEGMENTS);
    for (let i = 0; i < DECK_SEGMENTS; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const mid = a.clone().lerp(b, 0.5);
      const len = a.distanceTo(b);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      quat.setFromAxisAngle(Y_AXIS, yaw);
      scl.set(17, 2.4, len + 0.6);
      m.compose(mid, quat, scl);
      deck.setMatrixAt(di++, m);

      // 护栏灯（两侧交替取样，控制数量）
      if (i % 2 === 0) {
        const nx = (b.z - a.z) / len;
        const nz = -(b.x - a.x) / len;
        edgeDots.push(mid.x + nx * 8, mid.y + 1.6, mid.z + nz * 8);
        edgeDots.push(mid.x - nx * 8, mid.y + 1.6, mid.z - nz * 8);
      }

      // 桥墩
      if (i % 4 === 0) {
        quat.identity();
        scl.set(3.6, mid.y, 3.6);
        m.compose(new THREE.Vector3(mid.x, mid.y / 2 - 1.2, mid.z), quat, scl);
        pillars.setMatrixAt(pi++, m);
      }
    }
  }
  deck.instanceMatrix.needsUpdate = true;
  pillars.instanceMatrix.needsUpdate = true;
  group.add(deck, pillars);

  // 护栏灯点阵（青白色）
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeDots), 3));
  const dotCanvas = document.createElement('canvas');
  dotCanvas.width = 16;
  dotCanvas.height = 16;
  const dctx = dotCanvas.getContext('2d')!;
  const dg = dctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  dg.addColorStop(0, 'rgba(210,240,255,1)');
  dg.addColorStop(1, 'rgba(0,0,0,0)');
  dctx.fillStyle = dg;
  dctx.fillRect(0, 0, 16, 16);
  const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
    size: 4.5,
    map: new THREE.CanvasTexture(dotCanvas),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0x9fd8e8,
    sizeAttenuation: true,
  }));
  dots.frustumCulled = false;
  group.add(dots);

  // 桥面车流（双向）
  const defs: StreamDef[] = curves.flatMap((curve, i): StreamDef[] => [
    {
      curve, count: 60, headColor: 0xfff2d8, tailColor: 0xff3030,
      speedRange: [0.012, 0.02],
    },
    {
      curve: new THREE.CatmullRomCurve3(
        curve.getSpacedPoints(28).reverse().map((p) => p.clone().add(
          new THREE.Vector3(0, 3.5 + i, 0),
        )), true, 'catmullrom', 0.5,
      ),
      count: 60, headColor: 0xd8f0ff, tailColor: 0xff3030,
      speedRange: [0.012, 0.02],
    },
  ]);
  const stream = new LightStream(defs, (seed ^ 0x419b) >>> 0);
  group.add(stream.points);

  return {
    group,
    update(dt: number) { stream.update(dt); },
    setDensity(fraction: number) { stream.setDensity(fraction); },
  };
}
