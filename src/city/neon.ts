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

// ---------- 大型广告屏（夜之城的招牌元素） ----------

const AD_WORDS: Array<[string, string]> = [
  ['NEKO-COLA', '冰爽 · 合成'],
  ['義体診所', 'RIPPERDOC 24H'],
  ['CHROME', 'UPGRADE YOURSELF'],
  ['NEON NOODLE', '深夜営業'],
  ['DATA HEAVEN', 'JACK IN NOW'],
  ['XO-TEK', '軍用規格'],
  ['999 MOTEL', 'NO QUESTIONS'],
  ['NIGHT FM', '107.3 MHz'],
];

const AD_COLORS: Array<[string, string]> = [
  ['#ff2975', '#2b0030'],
  ['#00e5ff', '#001b30'],
  ['#ffe600', '#301a00'],
  ['#b96bff', '#14002b'],
  ['#00ffd5', '#00251c'],
  ['#ff6a00', '#2b0d00'],
  ['#ff4060', '#20000c'],
  ['#7dff45', '#0c2000'],
];

function buildAdAtlas(): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const T = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  AD_WORDS.forEach(([title, sub], i) => {
    const cx = (i % 4) * T;
    const cy = Math.floor(i / 4) * T;
    const [fg, bg] = AD_COLORS[i];
    ctx.save();
    ctx.translate(cx, cy);
    const grad = ctx.createLinearGradient(0, 0, 0, T);
    grad.addColorStop(0, bg);
    grad.addColorStop(1, '#050508');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, T, T);
    ctx.fillStyle = fg;
    ctx.shadowColor = fg;
    ctx.shadowBlur = 26;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${T * 0.16}px sans-serif`;
    ctx.fillText(title, T / 2, T * 0.4, T - 60);
    ctx.font = `500 ${T * 0.07}px sans-serif`;
    ctx.fillStyle = '#e8e8f0';
    ctx.shadowBlur = 10;
    ctx.fillText(sub, T / 2, T * 0.62, T - 80);
    // 底部条码装饰
    ctx.shadowBlur = 0;
    ctx.fillStyle = fg;
    let bx = 40;
    let k = i + 3;
    while (bx < T - 40) {
      const bw = 4 + ((k * 7919) % 14);
      ctx.fillRect(bx, T * 0.82, bw * 0.5, T * 0.08);
      bx += bw;
      k++;
    }
    ctx.strokeStyle = fg;
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, T - 20, T - 20);
    ctx.restore();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const AD_VERT = /* glsl */ `
attribute vec2 aUvOffset;
attribute float aSeed;
varying vec2 vUv;
varying vec2 vUvOffset;
varying float vSeed;
void main() {
  vUv = uv;
  vUvOffset = aUvOffset;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const AD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform vec2 uTileScale;
varying vec2 vUv;
varying vec2 vUvOffset;
varying float vSeed;
void main() {
  vec2 uv = vUv;
  // 偶发水平故障错位
  float glitchGate = step(0.965, fract(uTime * 0.37 + vSeed));
  uv.x += glitchGate * (fract(vSeed * 91.7 + floor(vUv.y * 24.0) * 0.37) - 0.5) * 0.12;
  vec4 t = texture2D(uMap, uv * uTileScale + vUvOffset);
  // 扫描线 + 缓慢滚动亮带 + 呼吸
  float scan = 0.82 + 0.18 * step(0.5, fract(vUv.y * 90.0));
  float sweep = 0.85 + 0.3 * smoothstep(0.12, 0.0,
    abs(fract(vUv.y * 0.9 - uTime * 0.11 + vSeed) - 0.5) - 0.32);
  float pulse = 0.85 + 0.15 * sin(uTime * (0.8 + fract(vSeed) * 1.6) + vSeed);
  gl_FragColor = vec4(t.rgb * scan * sweep * pulse * 1.9, 1.0);
}
`;

/** 竖向巨幕图集：4 张"图像感"广告（人脸/竖排汉字/产品/抽象波），各 512×1024 */
function buildMegaAtlas(): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const TW = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const tile = (i: number, fn: () => void) => {
    ctx.save();
    ctx.translate(i * TW, 0);
    ctx.beginPath();
    ctx.rect(0, 0, TW, H);
    ctx.clip();
    fn();
    ctx.restore();
  };

  // 0: 电子人脸 —— 青蓝底 + 头部剪影 + 发光义眼
  tile(0, () => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#062a3a');
    g.addColorStop(0.6, '#0a4a5e');
    g.addColorStop(1, '#031018');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TW, H);
    ctx.fillStyle = '#04141c';
    ctx.beginPath(); // 头 + 颈 + 肩剪影
    ctx.ellipse(TW / 2, H * 0.34, 130, 175, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(TW / 2 - 55, H * 0.45, 110, H * 0.16);
    ctx.beginPath();
    ctx.ellipse(TW / 2, H * 0.72, 210, 130, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5cf2ff';
    ctx.shadowColor = '#5cf2ff';
    ctx.shadowBlur = 24;
    ctx.fillRect(TW / 2 - 92, H * 0.33, 68, 10); // 义眼光条
    ctx.fillRect(TW / 2 + 26, H * 0.33, 68, 10);
    ctx.shadowBlur = 14;
    ctx.font = `700 ${TW * 0.11}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('KIBO-6', TW / 2, H * 0.9);
  });

  // 1: 竖排汉字灯幕
  tile(1, () => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a0416');
    g.addColorStop(1, '#0c0108');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TW, H);
    ctx.fillStyle = '#ff2975';
    ctx.shadowColor = '#ff2975';
    ctx.shadowBlur = 30;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${TW * 0.34}px serif`;
    ['夜', '未', '来'].forEach((ch, k) => {
      ctx.fillText(ch, TW / 2, H * (0.18 + k * 0.28));
    });
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffd24a';
    ctx.font = `600 ${TW * 0.07}px sans-serif`;
    ctx.fillText('AFTER DARK', TW / 2, H * 0.94);
  });

  // 2: 饮料产品 —— 罐体剪影 + 放射光
  tile(2, () => {
    ctx.fillStyle = '#120a02';
    ctx.fillRect(0, 0, TW, H);
    ctx.strokeStyle = 'rgba(255,158,61,0.35)';
    ctx.lineWidth = 10;
    for (let k = 0; k < 12; k++) { // 放射线
      const a = (k / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(TW / 2, H * 0.4);
      ctx.lineTo(TW / 2 + Math.cos(a) * 600, H * 0.4 + Math.sin(a) * 600);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff9e3d';
    ctx.shadowColor = '#ff9e3d';
    ctx.shadowBlur = 30;
    const rw = 150;
    ctx.fillRect(TW / 2 - rw / 2, H * 0.2, rw, H * 0.42); // 罐体
    ctx.fillRect(TW / 2 - rw / 2 + 18, H * 0.16, rw - 36, 22);
    ctx.fillStyle = '#1a0d00';
    ctx.shadowBlur = 0;
    ctx.font = `900 ${TW * 0.1}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(TW / 2, H * 0.41);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('NEKO', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#ffe600';
    ctx.shadowColor = '#ffe600';
    ctx.shadowBlur = 20;
    ctx.font = `800 ${TW * 0.12}px sans-serif`;
    ctx.fillText('飲め！', TW / 2, H * 0.82);
  });

  // 3: 抽象数据流 —— 双色波纹 + 字符雨
  tile(3, () => {
    const g = ctx.createLinearGradient(0, 0, TW, H);
    g.addColorStop(0, '#10062b');
    g.addColorStop(1, '#031b12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TW, H);
    for (let k = 0; k < 9; k++) { // 波纹
      ctx.strokeStyle = k % 2 === 0 ? 'rgba(185,107,255,0.7)' : 'rgba(0,255,213,0.6)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (let x = 0; x <= TW; x += 16) {
        const y = H * 0.12 + k * H * 0.09 + Math.sin(x * 0.02 + k * 1.7) * 26;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#00ffd5';
    ctx.shadowColor = '#00ffd5';
    ctx.shadowBlur = 16;
    ctx.font = `700 ${TW * 0.075}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('DATASTREAM ¥¥¥', TW / 2, H * 0.93);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 跨十几层楼的竖向巨幕 —— 原作天际线的标志元素 */
function createMegaScreens(plots: Plot[], rng: Rng): THREE.InstancedMesh {
  const candidates = plots
    .filter((p) => p.h > 170)
    .sort((a, b) => b.h - a.h)
    .slice(0, 90);

  interface ScreenSpec { matrix: THREE.Matrix4; uv: [number, number]; seed: number; }
  const specs: ScreenSpec[] = [];
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  for (const p of candidates) {
    if (specs.length >= 48) break;
    if (rng() > 0.62) continue;
    const h = Math.min(p.h * 0.55, 190) * range(rng, 0.8, 1.05);
    const w = h * 0.42;
    const side = Math.floor(rng() * 4);
    const offset = side % 2 === 0 ? p.sz / 2 + 1.4 : p.sx / 2 + 1.4;
    pos.set(p.x, p.h * range(rng, 0.5, 0.68), p.z);
    if (side === 0) pos.z += offset;
    if (side === 1) pos.x += offset;
    if (side === 2) pos.z -= offset;
    if (side === 3) pos.x -= offset;
    quat.setFromAxisAngle(Y_AXIS, (side * Math.PI) / 2);
    scl.set(w, h, 1);
    const tileIdx = Math.floor(rng() * 4);
    specs.push({
      matrix: new THREE.Matrix4().compose(pos, quat, scl),
      uv: [tileIdx * 0.25, 0],
      seed: rng() * 100,
    });
  }

  const material = new THREE.ShaderMaterial({
    vertexShader: AD_VERT,
    fragmentShader: AD_FRAG,
    uniforms: {
      uMap: { value: buildMegaAtlas() },
      uTime: { value: 0 },
      uTileScale: { value: new THREE.Vector2(0.25, 1.0) },
    },
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1), material, specs.length,
  );
  mesh.frustumCulled = false;
  const aUvOffset = new Float32Array(specs.length * 2);
  const aSeed = new Float32Array(specs.length);
  specs.forEach((s, i) => {
    mesh.setMatrixAt(i, s.matrix);
    aUvOffset.set(s.uv, i * 2);
    aSeed[i] = s.seed;
  });
  const geo = mesh.geometry;
  geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(aUvOffset, 2));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function createBillboards(plots: Plot[], rng: Rng): THREE.InstancedMesh {
  const tall = [...plots].sort((a, b) => b.h - a.h).slice(0, 320);

  interface AdSpec { matrix: THREE.Matrix4; uv: [number, number]; seed: number; }
  const specs: AdSpec[] = [];
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();

  for (const p of tall) {
    if (specs.length >= 260) break;
    const tileIdx = Math.floor(rng() * AD_WORDS.length);
    const uv: [number, number] = [
      (tileIdx % 4) * 0.25,
      (1 - Math.floor(tileIdx / 4)) * 0.5,
    ];

    if (rng() < 0.55) {
      // 楼面挂屏
      const w = Math.min(p.sx * 0.95, 36) * range(rng, 0.7, 1.2);
      const h = w * range(rng, 0.8, 1.15);
      const side = Math.floor(rng() * 4);
      const offset = side % 2 === 0 ? p.sz / 2 + 1.0 : p.sx / 2 + 1.0;
      pos.set(p.x, range(rng, 0.45, 0.85) * p.h, p.z);
      if (side === 0) pos.z += offset;
      if (side === 1) pos.x += offset;
      if (side === 2) pos.z -= offset;
      if (side === 3) pos.x -= offset;
      euler.set(0, (side * Math.PI) / 2, 0);
      scl.set(w, h, 1);
    } else {
      // 楼顶立屏（随机朝向 + 轻微俯角）
      const w = Math.min(p.sx * 1.25, 44) * range(rng, 0.7, 1.2);
      const h = w * 0.55;
      pos.set(p.x, p.h + h / 2 + 2, p.z);
      euler.set(-0.1, rng() * Math.PI * 2, 0);
      scl.set(w, h, 1);
    }
    quat.setFromEuler(euler);
    specs.push({
      matrix: new THREE.Matrix4().compose(pos, quat, scl),
      uv,
      seed: rng() * 100,
    });
  }

  const material = new THREE.ShaderMaterial({
    vertexShader: AD_VERT,
    fragmentShader: AD_FRAG,
    uniforms: {
      uMap: { value: buildAdAtlas() },
      uTime: { value: 0 },
      uTileScale: { value: new THREE.Vector2(0.25, 0.5) },
    },
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1), material, specs.length,
  );
  mesh.frustumCulled = false;
  const aUvOffset = new Float32Array(specs.length * 2);
  const aSeed = new Float32Array(specs.length);
  specs.forEach((s, i) => {
    mesh.setMatrixAt(i, s.matrix);
    aUvOffset.set(s.uv, i * 2);
    aSeed[i] = s.seed;
  });
  const geo = mesh.geometry;
  geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(aUvOffset, 2));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
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
  const billboards = createBillboards(plots, rng);
  group.add(billboards);
  const megaScreens = createMegaScreens(plots, rng);
  group.add(megaScreens);
  const holos = createHolos(rng);
  for (const h of holos) group.add(h.mesh);

  return {
    group,
    update(dt: number, t: number) {
      (signs.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      (billboards.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      (megaScreens.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      for (const h of holos) {
        h.mesh.rotation.y += dt * h.speed;
        (h.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      }
    },
  };
}
