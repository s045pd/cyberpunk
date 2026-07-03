import * as THREE from 'three';
import { Plot } from './layout';
import { DISTRICTS } from './districts';
import { LANDMARK_ANCHORS } from './anchors';
import { createRng, range, pick, Rng } from '../core/rng';

const ATLAS_N = 4;              // 4x4 tiles
const MAX_SIGNS = 4000;
const WORDS = [
  '夜之城', '電脳', '義体', 'ネオン', 'サムライ', 'NOODLE',
  'BAR', 'XOTIC', 'NET', 'DATA', 'クローム', '武士',
  'RIPPER', 'ドール', '777', 'MOTEL',
];

function buildAtlas(): THREE.CanvasTexture {
  const size = 1024;
  const tile = size / ATLAS_N;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  WORDS.forEach((word, i) => {
    const cx = (i % ATLAS_N) * tile;
    const cy = Math.floor(i / ATLAS_N) * tile;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 6;
    if (i % 3 === 0) ctx.strokeRect(14, 14, tile - 28, tile - 28);
    const cjk = /[　-鿿＀-￯]/.test(word);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (cjk && word.length <= 4) {
      // 竖排
      ctx.font = `bold ${tile * 0.3}px sans-serif`;
      const step = tile / (word.length + 1);
      [...word].forEach((ch, k) => {
        ctx.fillText(ch, tile / 2, step * (k + 1));
      });
    } else {
      ctx.font = `bold ${tile * 0.22}px sans-serif`;
      ctx.fillText(word, tile / 2, tile / 2, tile - 40);
    }
    ctx.restore();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// InstancedMesh + ShaderMaterial：instanceMatrix 由 three 自动声明，勿重复声明
const SIGN_VERT = /* glsl */ `
attribute vec2 aUvOffset;
attribute vec3 aColor;
attribute float aSeed;
varying vec2 vUv;
varying vec2 vUvOffset;
varying vec3 vColor;
varying float vSeed;
void main() {
  vUv = uv;
  vUvOffset = aUvOffset;
  vColor = aColor;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const SIGN_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
varying vec2 vUv;
varying vec2 vUvOffset;
varying vec3 vColor;
varying float vSeed;
void main() {
  vec4 t = texture2D(uMap, vUv / ${ATLAS_N}.0 + vUvOffset);
  float pulse = 0.78 + 0.22 * sin(uTime * (1.5 + fract(vSeed) * 3.0) + vSeed);
  // 偶发硬闪断电
  float blink = step(0.04, fract(vSeed * 13.7 + uTime * 0.21));
  vec3 col = t.rgb * vColor * pulse * blink * 2.4;
  gl_FragColor = vec4(col, t.a * 0.92);
}
`;

function createSigns(plots: Plot[], rng: Rng): THREE.InstancedMesh {
  const styleById = new Map(DISTRICTS.map((d) => [d.id, d.style]));
  const eligible = plots.filter((p) => p.h > 28);

  interface SignSpec {
    matrix: THREE.Matrix4;
    uv: [number, number];
    color: THREE.Color;
    seed: number;
  }
  const specs: SignSpec[] = [];
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  for (const p of eligible) {
    if (specs.length >= MAX_SIGNS) break;
    const style = styleById.get(p.district)!;
    const count = rng() < style.neonDensity ? (rng() < 0.35 ? 2 : 1) : 0;
    for (let k = 0; k < count && specs.length < MAX_SIGNS; k++) {
      const vertical = rng() < 0.55;
      const w = vertical ? range(rng, 5, 9) : range(rng, 14, 26);
      const h = vertical ? range(rng, 18, 38) : range(rng, 5, 9);
      // 面朝 ±x 或 ±z，贴楼皮外 0.6m
      const side = Math.floor(rng() * 4);
      const yaw = (side * Math.PI) / 2;
      const offset = side % 2 === 0 ? p.sz / 2 + 0.6 : p.sx / 2 + 0.6;
      const along = range(rng, -0.3, 0.3) * (side % 2 === 0 ? p.sx : p.sz);
      pos.set(p.x, range(rng, 0.3, 0.85) * p.h, p.z);
      if (side === 0) { pos.z += offset; pos.x += along; }
      if (side === 1) { pos.x += offset; pos.z += along; }
      if (side === 2) { pos.z -= offset; pos.x += along; }
      if (side === 3) { pos.x -= offset; pos.z += along; }
      quat.setFromAxisAngle(Y_AXIS, yaw);
      scl.set(w, h, 1);
      const matrix = new THREE.Matrix4().compose(pos, quat, scl);
      const tileIdx = Math.floor(rng() * WORDS.length);
      specs.push({
        matrix,
        uv: [(tileIdx % ATLAS_N) / ATLAS_N, Math.floor(tileIdx / ATLAS_N) / ATLAS_N],
        color: new THREE.Color(pick(rng, style.neonPalette)),
        seed: range(rng, 0, 100),
      });
    }
  }

  const material = new THREE.ShaderMaterial({
    vertexShader: SIGN_VERT,
    fragmentShader: SIGN_FRAG,
    uniforms: { uMap: { value: buildAtlas() }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1), material, specs.length,
  );
  mesh.frustumCulled = false;
  const aUvOffset = new Float32Array(specs.length * 2);
  const aColor = new Float32Array(specs.length * 3);
  const aSeed = new Float32Array(specs.length);
  specs.forEach((s, i) => {
    mesh.setMatrixAt(i, s.matrix);
    aUvOffset.set(s.uv, i * 2);
    aColor.set([s.color.r, s.color.g, s.color.b], i * 3);
    aSeed[i] = s.seed;
  });
  const geo = mesh.geometry;
  geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(aUvOffset, 2));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

const HOLO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HOLO_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float scan = 0.6 + 0.4 * step(0.5, fract(vUv.y * 60.0 - uTime * 4.0));
  float band = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  // 人形剪影近似：中轴对称宽度包络
  float torso = smoothstep(0.34, 0.30, abs(vUv.x - 0.5) - 0.06 * sin(vUv.y * 9.0));
  float alpha = band * torso * scan * 0.55;
  gl_FragColor = vec4(uColor * 2.0, alpha);
}
`;

interface Holo { mesh: THREE.Mesh; speed: number; }

function createHolos(rng: Rng): Holo[] {
  const colors = [0x00e5ff, 0xff2975, 0xb96bff, 0xffd24a, 0x00ffd5, 0xff6a00];
  return LANDMARK_ANCHORS.map((a, i) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(colors[i % colors.length]) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(90, 150), mat);
    mesh.position.set(
      a.x + range(rng, -60, 60),
      range(rng, 180, 320),
      a.z + range(rng, -60, 60),
    );
    mesh.frustumCulled = false;
    return { mesh, speed: range(rng, 0.15, 0.4) };
  });
}

export interface Neon {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

export function createNeon(plots: Plot[], seed: number): Neon {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const group = new THREE.Group();
  const signs = createSigns(plots, rng);
  group.add(signs);
  const holos = createHolos(rng);
  for (const h of holos) group.add(h.mesh);

  return {
    group,
    update(dt: number, t: number) {
      (signs.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      for (const h of holos) {
        h.mesh.rotation.y += dt * h.speed;
        (h.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      }
    },
  };
}
