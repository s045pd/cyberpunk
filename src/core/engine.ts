import * as THREE from 'three';
import { EffectComposer, RenderPass } from 'postprocessing';

export interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  moonLight: THREE.DirectionalLight;
  setRenderScale(scale: number): void;
  render(dt: number): void;
}

export const FOG_COLOR = 0x070812;
export const FOG_DENSITY = 0.00022;

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
  camera.position.set(0, 350, 3200);
  camera.lookAt(0, 150, 0);

  scene.add(new THREE.AmbientLight(0x30364a, 0.7));
  const moonLight = new THREE.DirectionalLight(0x8090ff, 0.35);
  moonLight.position.set(2000, 4000, 1000);
  scene.add(moonLight);

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

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
    renderer, scene, camera, composer, moonLight,
    setRenderScale(scale: number) { renderScale = scale; applySize(); },
    render(dt: number) { composer.render(dt); },
  };
}
