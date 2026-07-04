import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, VignetteEffect, ChromaticAberrationEffect,
  ToneMappingEffect, ToneMappingMode,
  HueSaturationEffect, BrightnessContrastEffect,
} from 'postprocessing';

export interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  moonLight: THREE.DirectionalLight;
  bloom: BloomEffect;
  chromatic: ChromaticAberrationEffect;
  setRenderScale(scale: number): void;
  render(dt: number): void;
}

export const FOG_COLOR = 0x0c0a10;
export const FOG_DENSITY = 0.00026;

export function createEngine(canvas: HTMLCanvasElement): Engine {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.toneMapping = THREE.NoToneMapping; // 色调映射在后处理链末端做
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

  const camera = new THREE.PerspectiveCamera(
    60, window.innerWidth / window.innerHeight, 1, 20000,
  );
  camera.position.set(400, 360, 1900);
  camera.lookAt(-400, 220, -900);

  scene.add(new THREE.AmbientLight(0x30364a, 0.7));
  const moonLight = new THREE.DirectionalLight(0x8090ff, 0.35);
  moonLight.position.set(2000, 4000, 1000);
  scene.add(moonLight);

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: 1.35,
    luminanceThreshold: 0.18,
    luminanceSmoothing: 0.3,
    mipmapBlur: true,
  });
  const chromatic = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(0.0008, 0.0008),
    radialModulation: true,
    modulationOffset: 0.35,
  });
  const vignette = new VignetteEffect({ darkness: 0.6, offset: 0.3 });
  const grade = new HueSaturationEffect({ saturation: 0.22 });
  const contrast = new BrightnessContrastEffect({ brightness: -0.02, contrast: 0.14 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  composer.addPass(new EffectPass(camera, bloom, grade, contrast, vignette, chromatic, tone));

  let renderScale = 1;
  const applySize = () => {
    const pr = Math.min(window.devicePixelRatio, 2) * renderScale;
    renderer.setPixelRatio(pr);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  applySize();
  window.addEventListener('resize', applySize);

  return {
    renderer, scene, camera, composer, moonLight, bloom, chromatic,
    setRenderScale(scale: number) { renderScale = scale; applySize(); },
    render(dt: number) { composer.render(dt); },
  };
}
