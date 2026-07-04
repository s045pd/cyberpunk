import * as THREE from 'three';
import { BlendFunction } from 'postprocessing';
import { createEngine } from './core/engine';
import { QualityMonitor, QUALITY_PRESETS } from './core/quality';
import { createSky } from './atmosphere/sky';
import { createRain } from './atmosphere/rain';
import { LightningDirector } from './atmosphere/lightning';
import { generatePlots } from './city/layout';
import { createBuildings } from './city/buildings';
import { createGround, createStreetLamps, bakeCityGlow } from './city/ground';
import { createWater } from './city/water';
import { partitionOpenPlots, createInteriors } from './city/interiors';
import { createVendors } from './city/vendors';
import { PedFleet, buildSidewalkPaths } from './people/pedestrians';
import { pickIncidentSites, createIncidents } from './events/incidents';
import { RescueDirector } from './events/rescue';
import { ColliderGrid } from './core/collision';
import { createHighway } from './city/highway';
import { createBridges } from './city/bridges';
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

  const boot = new BootScreen(overlay, 7);

  const engine = createEngine(canvas);
  const updatables: Updatable[] = [];

  const sky = createSky();
  engine.scene.add(sky.mesh);
  updatables.push({ update: (_dt, t) => sky.update(t) });

  const plots = await boot.step('解析城区结构 // PARSING DISTRICTS', () =>
    generatePlots(SEED));
  // 可进入建筑从实心楼群中分拣出来单独建壳
  const { open, closed } = partitionOpenPlots(plots, SEED);

  const interiors = await boot.step('浇筑楼群 // EXTRUDING BLOCKS', () => {
    const buildings = createBuildings(closed, SEED);
    engine.scene.add(buildings.group);
    updatables.push(buildings);
    const inner = createInteriors(open, SEED);
    engine.scene.add(inner.group);
    return inner;
  });

  const highway = await boot.step('铺设路网 // PAVING GRID', () => {
    const glowTex = bakeCityGlow(SEED);
    engine.scene.add(createGround(SEED, glowTex));
    const water = createWater(glowTex);
    engine.scene.add(water.mesh);
    updatables.push(water);
    engine.scene.add(createStreetLamps());
    engine.scene.add(createLandmarks(SEED));
    engine.scene.add(createBridges(closed, SEED));
    const hw = createHighway(SEED);
    engine.scene.add(hw.group);
    updatables.push({ update: (dt, t) => hw.update(dt, t) });
    return hw;
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
      engine.scene.add(air.group, ground.group);
      updatables.push(
        { update: (dt, t) => air.update(dt, t) },
        { update: (dt, t) => ground.update(dt, t) },
      );
      return { airTraffic: air, groundTraffic: ground };
    },
  );

  const peds = await boot.step('注入生命 // SPAWNING LIFE', () => {
    const sites = pickIncidentSites(SEED);
    (window as unknown as Record<string, unknown>).__ncSites = sites;
    const incidents = createIncidents(sites, SEED);
    engine.scene.add(incidents.group);
    updatables.push(incidents);
    const vendors = createVendors(SEED);
    engine.scene.add(vendors.group);
    const rescue = new RescueDirector(
      sites.filter((st) => st.kind === 'rescue'), SEED,
    );
    engine.scene.add(rescue.group);
    updatables.push({ update: (dt, t) => rescue.update(dt, t) });
    const fleet = new PedFleet({
      paths: buildSidewalkPaths(),
      countPerPath: 55,
      seed: SEED ^ 0x9ed,
      statics: [...incidents.statics, ...vendors.statics],
    });
    engine.scene.add(fleet.group);
    updatables.push({ update: (dt, t) => fleet.update(dt, t) });
    return fleet;
  });

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
  // 漫游碰撞：实心楼群 + 大堂墙体/内饰
  const colliderGrid = new ColliderGrid(64);
  for (const pl of closed) {
    if (pl.h < 3) continue;
    colliderGrid.add({
      minX: pl.x - pl.sx / 2, maxX: pl.x + pl.sx / 2,
      minZ: pl.z - pl.sz / 2, maxZ: pl.z + pl.sz / 2,
    });
  }
  for (const c of interiors.colliders) colliderGrid.add(c);
  walk.setColliders(colliderGrid);
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
    highway.setDensity(q.trafficScale);
    peds.setDensity(q.trafficScale);
    lightning.enabled = q.lightning;
    hud.setQualityName(q.name);
  };
  applyQuality();

  // 开发调试句柄（E2E/预览用于机位摆放）
  (window as unknown as Record<string, unknown>).__nc = {
    camera: engine.camera, fly, walk, monitor,
  };

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
