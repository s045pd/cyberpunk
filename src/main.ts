import * as THREE from 'three';
import { createEngine } from './core/engine';
import { createSky } from './atmosphere/sky';
import { FlyControls } from './controls/flyControls';

export interface Updatable {
  update(dt: number, t: number): void;
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const engine = createEngine(canvas);
const updatables: Updatable[] = [];

const sky = createSky();
engine.scene.add(sky.mesh);

// 临时参照物：中心一个发光盒，确认渲染与飞行正常（T6 移除）
const probe = new THREE.Mesh(
  new THREE.BoxGeometry(100, 300, 100),
  new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: 0x00e5ff, emissiveIntensity: 2,
  }),
);
probe.position.y = 150;
engine.scene.add(probe);

const fly = new FlyControls(engine.camera, canvas);
updatables.push({ update: (dt) => fly.update(dt) });

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  for (const u of updatables) u.update(dt, t);
  engine.render(dt);
}
loop();
