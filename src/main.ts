import * as THREE from 'three';
import { createEngine } from './core/engine';
import { createSky } from './atmosphere/sky';
import { FlyControls } from './controls/flyControls';
import { generatePlots } from './city/layout';
import { createBuildings } from './city/buildings';

export interface Updatable {
  update(dt: number, t: number): void;
}

export const SEED = 20770703;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const engine = createEngine(canvas);
const updatables: Updatable[] = [];

const sky = createSky();
engine.scene.add(sky.mesh);

const plots = generatePlots(SEED);
const buildings = createBuildings(plots, SEED);
engine.scene.add(buildings.group);
updatables.push(buildings);

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
