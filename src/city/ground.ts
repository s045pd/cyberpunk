import * as THREE from 'three';
import { CITY_SIZE, DISTRICTS } from './districts';
import { createRng, range, pick } from '../core/rng';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';
import { ROAD_SPACING, ROAD_HALF_WIDTH } from './layout';

const CITY_RADIUS = 3400;

/**
 * 烘焙"街区霓虹倒影"贴图：每个区域按自己的霓虹色板撒柔光斑，
 * 采样后叠在湿沥青上 —— 雨夜街道反光的廉价近似。
 */
function bakeCityGlow(seed: number): THREE.CanvasTexture {
  const N = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, N, N);
  ctx.globalCompositeOperation = 'lighter';

  const rng = createRng((seed ^ 0x610f) >>> 0);
  for (const d of DISTRICTS) {
    let minX = 1; let minY = 1; let maxX = 0; let maxY = 0;
    for (const [px, py] of d.polygon) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    const area = (maxX - minX) * (maxY - minY);
    const blobs = Math.round(area * 2200 * d.style.neonDensity + 10);
    for (let i = 0; i < blobs; i++) {
      const px = range(rng, minX, maxX) * N;
      const py = range(rng, minY, maxY) * N;
      const r = range(rng, 14, 46);
      const color = new THREE.Color(pick(rng, d.style.neonPalette));
      const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
      const a = range(rng, 0.08, 0.2);
      grad.addColorStop(0, `rgba(${(color.r * 255) | 0},${(color.g * 255) | 0},${(color.b * 255) | 0},${a})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const VERT = /* glsl */ `
varying vec2 vWorld;
varying float vDist;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  vec4 view = viewMatrix * world;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uGlow;
varying vec2 vWorld;
varying float vDist;

float roadDist(float coord) {
  float r = mod(coord, ${ROAD_SPACING}.0);
  return min(r, ${ROAD_SPACING}.0 - r);
}

void main() {
  float cityMask = 1.0 - smoothstep(${CITY_RADIUS}.0, 4400.0, length(vWorld));

  // 湿沥青（城内偏冷）/ 恶土干土（城外偏棕）
  vec3 col = mix(vec3(0.042, 0.035, 0.026), vec3(0.020, 0.022, 0.030), cityMask);

  float dx = roadDist(vWorld.x);
  float dz = roadDist(vWorld.y);
  float onRoadX = 1.0 - step(${ROAD_HALF_WIDTH}.0, dx);
  float onRoadZ = 1.0 - step(${ROAD_HALF_WIDTH}.0, dz);
  float onRoad = max(onRoadX, onRoadZ);

  // 路面比街区略深
  col *= mix(1.0, 0.75, onRoad * cityMask);

  // 中央车道虚线（昏黄）
  float dashX = onRoadX * step(dx, 0.4) * step(mod(vWorld.y, 14.0), 7.0);
  float dashZ = onRoadZ * step(dz, 0.4) * step(mod(vWorld.x, 14.0), 7.0);
  col += vec3(0.35, 0.28, 0.08) * max(dashX, dashZ) * cityMask;

  // 路缘窄光条（很淡的青色）
  float curbX = smoothstep(1.2, 0.0, abs(dx - ${ROAD_HALF_WIDTH}.0));
  float curbZ = smoothstep(1.2, 0.0, abs(dz - ${ROAD_HALF_WIDTH}.0));
  col += vec3(0.05, 0.22, 0.28) * max(curbX, curbZ) * 0.35 * cityMask;

  // 霓虹倒影：湿路面上晕开的城市光
  vec2 uv = vWorld / ${CITY_SIZE}.0 + 0.5;
  vec3 glow = texture2D(uGlow, uv).rgb;
  col += glow * 0.3 * cityMask;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createGround(seed: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uGlow: { value: bakeCityGlow(seed) },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.1;
  return mesh;
}

/** 沿路网的钠灯点阵（暖橙），取代旧的发光网格线 */
export function createStreetLamps(): THREE.Points {
  const positions: number[] = [];
  const STEP = 55;
  const OFFSET = ROAD_HALF_WIDTH + 1.5;
  for (let k = -6; k <= 6; k++) {
    const c = k * ROAD_SPACING;
    if (Math.abs(c) >= CITY_RADIUS) continue;
    const half = Math.sqrt(CITY_RADIUS * CITY_RADIUS - c * c);
    for (let v = -half; v <= half; v += STEP) {
      const side = (Math.round(v / STEP) % 2 === 0) ? OFFSET : -OFFSET;
      positions.push(c + side, 8.5, v);   // 沿 z 的路
      positions.push(v, 8.5, c - side);   // 沿 x 的路
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,200,130,1)');
  grad.addColorStop(0.5, 'rgba(255,170,80,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);

  const mat = new THREE.PointsMaterial({
    size: 7,
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0xffb060,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}
