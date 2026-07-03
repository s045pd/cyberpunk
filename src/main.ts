import * as THREE from 'three';
import { createEngine } from './core/engine';
import { createSky } from './atmosphere/sky';
import { createRain } from './atmosphere/rain';
import { LightningDirector } from './atmosphere/lightning';
import { FlyControls } from './controls/flyControls';
import { WalkControls } from './controls/walkControls';
import { ModeManager } from './controls/modeSwitch';
import { generatePlots } from './city/layout';
import { createBuildings } from './city/buildings';
import { createGround } from './city/ground';
import { createNeon } from './city/neon';
import { createLandmarks } from './city/landmarks/index';
import { createAirTraffic } from './traffic/airTraffic';
import { createGroundTraffic } from './traffic/groundTraffic';

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

engine.scene.add(createGround());

const neon = createNeon(plots, SEED);
engine.scene.add(neon.group);
updatables.push(neon);

engine.scene.add(createLandmarks(SEED));

const airTraffic = createAirTraffic(SEED);
const groundTraffic = createGroundTraffic(SEED);
engine.scene.add(airTraffic.points, groundTraffic.points);
updatables.push(
  { update: (dt) => airTraffic.update(dt) },
  { update: (dt) => groundTraffic.update(dt) },
);

const rain = createRain(SEED);
engine.scene.add(rain.points);
updatables.push({
  update: (dt, t) => rain.update(dt, t, engine.camera.position),
});

const lightning = new LightningDirector(sky, engine.moonLight, 0.35, SEED);
updatables.push({ update: (dt) => lightning.update(dt) });

const fly = new FlyControls(engine.camera, canvas);
const walk = new WalkControls(engine.camera, canvas);
const modes = new ModeManager(engine.camera, fly, walk);
updatables.push(
  { update: (dt) => fly.update(dt) },
  { update: (dt) => walk.update(dt) },
  { update: (dt) => modes.update(dt) },
);

const timer = new THREE.Timer();
function loop() {
  requestAnimationFrame(loop);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();
  for (const u of updatables) u.update(dt, t);
  engine.render(dt);
}
loop();
