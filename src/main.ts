import * as THREE from 'three';
import { BlendFunction } from 'postprocessing';
import { createEngine } from './core/engine';
import { QualityMonitor, QUALITY_PRESETS } from './core/quality';
import { createSky } from './atmosphere/sky';
import { createRain } from './atmosphere/rain';
import { LightningDirector } from './atmosphere/lightning';
import { generatePlots } from './city/layout';
import { createBuildings } from './city/buildings';
import { createGround, createStreetLamps } from './city/ground';
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

function showFatal(overlay: HTMLElement, title: string, body: string): void {
  overlay.innerHTML = `
    <div class="fatal">
      <div class="fatal-title">${title}</div>
      <div class="fatal-body">${body}</div>
    </div>`;
  overlay.style.pointerEvents = 'auto';
}

async function start(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
  overlay.textContent = '';

  if (!document.createElement('canvas').getContext('webgl2')) {
    showFatal(
      overlay,
      '// SIGNAL LOST',
      '此浏览器不支持 WebGL2。请使用最新版 Chrome / Edge / Safari / Firefox。',
    );
    return;
  }

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
    engine.scene.add(createGround(SEED));
    engine.scene.add(createStreetLamps());
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

  const monitor = new QualityMonitor();
  const applyQuality = () => {
    const q = QUALITY_PRESETS[monitor.level];
    engine.setRenderScale(q.renderScale);
    engine.bloom.intensity = q.bloomIntensity;
    engine.chromatic.blendMode.setBlendFunction(
      q.chromatic ? BlendFunction.NORMAL : BlendFunction.SKIP,
    );
    rain.setDensity(q.rainScale);
    airTraffic.setDensity(q.trafficScale);
    groundTraffic.setDensity(q.trafficScale);
    lightning.enabled = q.lightning;
    hud.setQualityName(q.name);
  };
  applyQuality();

  await boot.waitForStart();

  const timer = new THREE.Timer();
  let frameErrors = 0;
  function loop(): void {
    requestAnimationFrame(loop);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    try {
      for (const u of updatables) u.update(dt, t);
      if (monitor.addFrame(dt)) applyQuality();
      engine.render(dt);
      frameErrors = 0;
    } catch (err) {
      frameErrors++;
      console.error('[night-city] frame error', err);
      if (frameErrors > 30) {
        showFatal(
          overlay,
          '// FLATLINED',
          '渲染循环连续出错，请刷新页面。详情见控制台。',
        );
        throw err;
      }
    }
  }
  loop();
}

void start();
