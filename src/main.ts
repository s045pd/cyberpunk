import * as THREE from 'three';
import { createEngine } from './core/engine';
import { createSky } from './atmosphere/sky';
import { createRain } from './atmosphere/rain';
import { LightningDirector } from './atmosphere/lightning';
import { generatePlots } from './city/layout';
import { createBuildings } from './city/buildings';
import { createGround } from './city/ground';
import { createNeon } from './city/neon';
import { createLandmarks } from './city/landmarks/index';
import { createAirTraffic } from './traffic/airTraffic';
import { createGroundTraffic } from './traffic/groundTraffic';
import { FlyControls } from './controls/flyControls';
import { WalkControls } from './controls/walkControls';
import { ModeManager } from './controls/modeSwitch';
import { Hud } from './ui/hud';
import { BootScreen } from './ui/boot';

export interface Updatable {
  update(dt: number, t: number): void;
}

export const SEED = 20770703;

async function start(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
  overlay.textContent = '';
  const boot = new BootScreen(overlay, 6);

  const engine = createEngine(canvas);
  const updatables: Updatable[] = [];

  const sky = createSky();
  engine.scene.add(sky.mesh);

  const plots = await boot.step('解析城区结构 // PARSING DISTRICTS', () =>
    generatePlots(SEED));

  const buildings = await boot.step('浇筑楼群 // EXTRUDING BLOCKS', () =>
    createBuildings(plots, SEED));
  engine.scene.add(buildings.group);
  updatables.push(buildings);

  await boot.step('铺设路网 // PAVING GRID', () => {
    engine.scene.add(createGround());
    engine.scene.add(createLandmarks(SEED));
  });

  const neon = await boot.step('点亮霓虹 // IGNITING NEON', () =>
    createNeon(plots, SEED));
  engine.scene.add(neon.group);
  updatables.push(neon);

  const { airTraffic, groundTraffic } = await boot.step(
    '注入车流 // SPAWNING TRAFFIC',
    () => {
      const air = createAirTraffic(SEED);
      const ground = createGroundTraffic(SEED);
      engine.scene.add(air.points, ground.points);
      updatables.push(
        { update: (dt) => air.update(dt) },
        { update: (dt) => ground.update(dt) },
      );
      return { airTraffic: air, groundTraffic: ground };
    },
  );
  void airTraffic;
  void groundTraffic;

  const { rain, lightning } = await boot.step('召唤雨云 // SEEDING RAIN', () => {
    const r = createRain(SEED);
    engine.scene.add(r.points);
    updatables.push({
      update: (dt, t) => r.update(dt, t, engine.camera.position),
    });
    const l = new LightningDirector(sky, engine.moonLight, 0.35, SEED);
    updatables.push({ update: (dt) => l.update(dt) });
    return { rain: r, lightning: l };
  });
  void rain;
  void lightning;

  const fly = new FlyControls(engine.camera, canvas);
  const walk = new WalkControls(engine.camera, canvas);
  const modes = new ModeManager(engine.camera, fly, walk);
  const hud = new Hud(overlay);
  modes.onChange((m) => hud.setMode(m));
  updatables.push(
    { update: (dt) => fly.update(dt) },
    { update: (dt) => walk.update(dt) },
    { update: (dt) => modes.update(dt) },
    { update: (dt) => hud.update(dt, engine.camera.position) },
  );

  await boot.waitForStart();

  const timer = new THREE.Timer();
  function loop(): void {
    requestAnimationFrame(loop);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    for (const u of updatables) u.update(dt, t);
    engine.render(dt);
  }
  loop();
}

void start();
