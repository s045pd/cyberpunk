import * as THREE from 'three';
import { Plot } from './layout';
import { DistrictId } from './districts';
import { doorInfoFor, LOBBY_H } from './lobbies';
import { createRng, range, pick, Rng } from '../core/rng';
import { AABB } from '../core/collision';

/**
 * 楼内场所套件：按区域业态给每栋楼的大堂配一套真实设施
 * （灵感来源：原作的酒吧/超梦店/义体诊所/快餐店/公司大堂/居民楼/仓库等业态）。
 */
export type VenueKind =
  | 'bar' | 'bd' | 'ripper' | 'food' | 'clothes' | 'guns' | 'net'
  | 'residential' | 'corpo' | 'motel' | 'warehouse' | 'pachinko' | 'ruin';

const VENUE_WEIGHTS: Record<DistrictId, Array<[VenueKind, number]>> = {
  watson: [
    ['bar', 0.13], ['bd', 0.11], ['food', 0.16], ['pachinko', 0.09],
    ['clothes', 0.08], ['guns', 0.05], ['net', 0.06], ['ripper', 0.08],
    ['residential', 0.18], ['motel', 0.06],
  ],
  westbrook: [
    ['bar', 0.17], ['bd', 0.1], ['food', 0.14], ['clothes', 0.18],
    ['ripper', 0.06], ['residential', 0.22], ['corpo', 0.07], ['motel', 0.06],
  ],
  'city-center': [
    ['corpo', 0.38], ['clothes', 0.15], ['bar', 0.1], ['bd', 0.06],
    ['food', 0.11], ['residential', 0.12], ['ripper', 0.04], ['net', 0.04],
  ],
  heywood: [
    ['residential', 0.32], ['food', 0.17], ['bar', 0.1], ['clothes', 0.08],
    ['guns', 0.06], ['ripper', 0.07], ['motel', 0.08], ['pachinko', 0.05],
  ],
  'santo-domingo': [
    ['warehouse', 0.34], ['residential', 0.2], ['food', 0.12], ['bar', 0.08],
    ['guns', 0.08], ['ripper', 0.06], ['net', 0.05],
  ],
  pacifica: [
    ['ruin', 0.42], ['residential', 0.16], ['food', 0.1], ['bar', 0.08],
    ['guns', 0.07], ['bd', 0.06], ['warehouse', 0.08],
  ],
};

/** 门头场所色标（也用于内部主光色） */
export const VENUE_COLORS: Record<VenueKind, number> = {
  bar: 0xff2975, bd: 0x00e5ff, ripper: 0x33ff88, food: 0xff7a1a,
  clothes: 0xb96bff, guns: 0xff3030, net: 0x39ff5e, residential: 0xffd9a0,
  corpo: 0x9fd0ff, motel: 0xffe600, warehouse: 0xff9e3d,
  pachinko: 0xff5030, ruin: 0x2a3438,
};

/** 门头单字（场所速读，解决"找不到酒吧"） */
export const VENUE_GLYPHS: Record<VenueKind, string> = {
  bar: '吧', bd: '梦', ripper: '医', food: '食', clothes: '衣',
  guns: '枪', net: '网', residential: '宿', corpo: '社', motel: '旅',
  warehouse: '仓', pachinko: '弹', ruin: '空',
};

const GLYPH_LIST = Object.values(VENUE_GLYPHS);

function buildGlyphAtlas(): THREE.CanvasTexture {
  const T = 128;
  const canvas = document.createElement('canvas');
  canvas.width = T * GLYPH_LIST.length;
  canvas.height = T;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${T * 0.72}px serif`;
  GLYPH_LIST.forEach((ch, i) => {
    ctx.fillText(ch, i * T + T / 2, T / 2 + 4);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GLYPH_VERT = /* glsl */ `
attribute float aGlyph;
attribute vec3 aColor;
varying vec2 vUv;
varying float vGlyph;
varying vec3 vColor;
void main() {
  vUv = uv;
  vGlyph = aGlyph;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const GLYPH_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uCount;
varying vec2 vUv;
varying float vGlyph;
varying vec3 vColor;
void main() {
  vec2 uv = vec2((vUv.x + vGlyph) / uCount, vUv.y);
  vec4 t = texture2D(uMap, uv);
  if (t.a < 0.3) discard;
  gl_FragColor = vec4(vColor * 2.2, t.a);
}
`;

/** 纯逻辑、可单测：按区域业态 + 楼高选场所 */
export function venueFor(district: DistrictId, h: number, roll: number): VenueKind {
  // 市中心超高层几乎都是公司大堂
  if (district === 'city-center' && h > 260 && roll < 0.72) return 'corpo';
  let r = roll;
  for (const [kind, w] of VENUE_WEIGHTS[district]) {
    r -= w;
    if (r <= 0) return kind;
  }
  return 'residential';
}

/* ---------- 套件搭建 ---------- */

interface PropPlacer {
  dark(lx: number, ly: number, lz: number, w: number, h: number, d: number): void;
  glow(lx: number, ly: number, lz: number, w: number, h: number, d: number, color: number): void;
  solid(lx: number, lz: number, w: number, d: number): void; // 碰撞
}

/** 各场所的家具布置（局部坐标：+z 朝门，原点=楼中心，电梯区在 -z 后墙留空） */
function furnish(kind: VenueKind, hx: number, hz: number, rng: Rng, put: PropPlacer): void {
  const accent = VENUE_COLORS[kind];
  const W = Math.min(hx * 0.9, 8);
  switch (kind) {
    case 'bar': {
      // 吧台 + 酒架光墙 + 高脚凳 + 舞池光板
      put.dark(-hx * 0.45, 0.55, -hz * 0.1, 0.9, 1.1, Math.min(hz, 6));
      put.solid(-hx * 0.45, -hz * 0.1, 1.0, Math.min(hz, 6));
      put.glow(-hx * 0.45 - 0.8, 1.5, -hz * 0.1, 0.15, 1.6, Math.min(hz, 5.6), 0xffb35c);
      for (let i = -1; i <= 1; i++) {
        put.dark(-hx * 0.45 + 1.1, 0.35, -hz * 0.1 + i * 1.4, 0.38, 0.7, 0.38);
      }
      put.glow(hx * 0.3, 0.04, 0, 3.2, 0.06, 3.2, accent);      // 舞池
      put.glow(hx * 0.3, 3.4, 0, 2.2, 0.4, 0.1, pick(rng, [0x00e5ff, 0xb96bff]));
      break;
    }
    case 'bd': {
      // 超梦躺椅舱位阵 + 前台
      const rows = Math.min(Math.floor(hz / 2.4), 3);
      for (let r = 0; r < rows; r++) {
        for (const sx of [-1, 1]) {
          put.dark(sx * hx * 0.42, 0.4, -hz * 0.3 + r * 2.4, 0.8, 0.8, 1.9);
          put.glow(sx * hx * 0.42, 0.95, -hz * 0.3 + r * 2.4 - 0.7, 0.5, 0.1, 0.3, accent);
        }
      }
      put.dark(0, 0.55, hz * 0.4, 2.0, 1.1, 0.8);
      put.solid(0, hz * 0.4, 2.2, 1.0);
      break;
    }
    case 'ripper': {
      // 手术椅 + 机械臂 + 监视器光墙 + 药柜
      put.dark(-hx * 0.2, 0.5, 0, 0.95, 1.0, 1.9);
      put.solid(-hx * 0.2, 0, 1.1, 2.1);
      put.dark(-hx * 0.2 + 0.7, 1.6, -0.6, 0.14, 1.6, 0.14);
      put.dark(-hx * 0.2 + 0.35, 2.3, -0.2, 0.9, 0.12, 0.12);
      put.glow(hx * 0.42, 1.5, -hz * 0.2, 0.12, 1.3, 2.4, accent);
      put.dark(hx * 0.42, 0.9, hz * 0.3, 0.5, 1.8, 1.2);
      break;
    }
    case 'food': {
      // 长柜台 + 高脚凳排 + 双菜单光屏 + 后厨块
      put.dark(0, 0.55, -hz * 0.25, W, 1.1, 0.9);
      put.solid(0, -hz * 0.25, W, 1.0);
      for (let i = 0; i < 4; i++) {
        put.dark(-W / 2 + 0.8 + i * (W - 1.6) / 3, 0.35, -hz * 0.25 + 1.2, 0.36, 0.7, 0.36);
      }
      put.glow(-W * 0.22, 2.6, -hz * 0.25 - 0.3, 1.6, 0.9, 0.08, accent);
      put.glow(W * 0.22, 2.6, -hz * 0.25 - 0.3, 1.6, 0.9, 0.08, 0xffe600);
      put.dark(0, 1.0, -hz * 0.25 - 1.6, W * 0.7, 2.0, 0.9);
      break;
    }
    case 'clothes': {
      // 衣架排 + 试衣光镜 + 收银台
      for (let i = 0; i < 3; i++) {
        put.dark(-hx * 0.3 + i * hx * 0.3, 0.85, 0, 0.4, 1.7, Math.min(hz, 4.5));
        put.solid(-hx * 0.3 + i * hx * 0.3, 0, 0.6, Math.min(hz, 4.5));
      }
      put.glow(hx * 0.44, 1.2, hz * 0.3, 0.1, 2.0, 1.0, 0xd8e8f0);
      put.dark(-hx * 0.4, 0.55, hz * 0.35, 1.6, 1.1, 0.7);
      break;
    }
    case 'guns': {
      // 武器墙架 ×2 + 玻璃展柜 + 红色警示光条
      put.dark(-hx * 0.44, 1.4, -hz * 0.2, 0.3, 1.9, Math.min(hz, 5));
      put.dark(hx * 0.44, 1.4, -hz * 0.2, 0.3, 1.9, Math.min(hz, 5));
      put.dark(0, 0.5, 0, Math.min(hx, 3.4), 1.0, 0.8);
      put.solid(0, 0, Math.min(hx, 3.6), 1.0);
      put.glow(0, 1.05, 0, Math.min(hx, 3.2), 0.08, 0.7, accent);
      break;
    }
    case 'net': {
      // 服务器机柜（绿光缝）+ 双屏工作台
      for (let i = 0; i < 3; i++) {
        const z = -hz * 0.3 + i * 1.4;
        put.dark(-hx * 0.42, 1.0, z, 0.8, 2.0, 0.8);
        put.glow(-hx * 0.42 + 0.42, 1.0, z, 0.05, 1.6, 0.5, accent);
      }
      put.solid(-hx * 0.42, -hz * 0.3 + 1.4, 1.0, 4.2);
      put.dark(hx * 0.3, 0.5, 0, 2.0, 1.0, 0.9);
      put.glow(hx * 0.3, 1.5, -0.5, 1.6, 0.8, 0.06, 0x9fffb0);
      break;
    }
    case 'corpo': {
      // 前台长桌 + LOGO 光墙 + 闸机排 + 花池
      put.dark(0, 0.6, -hz * 0.15, Math.min(hx, 6), 1.2, 1.0);
      put.solid(0, -hz * 0.15, Math.min(hx, 6.2), 1.2);
      put.glow(0, 2.4, -hz * 0.15 - 1.2, Math.min(hx, 5), 1.8, 0.12, accent);
      for (let i = -1; i <= 1; i++) {
        put.dark(i * 1.3, 0.55, hz * 0.4, 0.18, 1.1, 0.5);
      }
      put.dark(-hx * 0.42, 0.4, hz * 0.2, 1.0, 0.8, 1.0);
      put.dark(hx * 0.42, 0.4, hz * 0.2, 1.0, 0.8, 1.0);
      break;
    }
    case 'motel': {
      put.dark(-hx * 0.3, 0.55, -hz * 0.2, 2.2, 1.1, 0.8);
      put.solid(-hx * 0.3, -hz * 0.2, 2.4, 1.0);
      put.glow(-hx * 0.3, 2.2, -hz * 0.2 - 0.8, 1.8, 0.6, 0.08, accent);
      put.dark(hx * 0.35, 0.28, 0, 1.8, 0.55, 0.6);
      break;
    }
    case 'warehouse': {
      // 货箱堆 + 长货架 + 笼灯条
      const n = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const cx = range(rng, -hx * 0.6, hx * 0.6);
        const cz = range(rng, -hz * 0.4, hz * 0.5);
        const s = range(rng, 0.7, 1.4);
        put.dark(cx, s / 2, cz, s, s, s);
        if (s > 1.0) put.solid(cx, cz, s, s);
      }
      put.dark(-hx * 0.44, 1.1, 0, 0.5, 2.2, Math.min(hz, 6));
      put.glow(0, LOBBY_H - 0.4, 0, 0.15, 0.08, Math.min(hz, 5), accent);
      break;
    }
    case 'pachinko': {
      // 柏青哥机台双排（多彩闪面）
      const perRow = Math.min(Math.floor(hx / 1.1), 4);
      for (const rowZ of [-hz * 0.25, hz * 0.15]) {
        for (let i = 0; i < perRow; i++) {
          const x = -((perRow - 1) / 2) * 1.1 + i * 1.1;
          put.dark(x, 0.85, rowZ, 0.75, 1.7, 0.55);
          put.glow(x, 1.0, rowZ + 0.31, 0.55, 1.1, 0.04,
            pick(rng, [0xff2975, 0xffe600, 0x00ffd5, 0xff6a00]));
        }
        put.solid(0, rowZ, perRow * 1.1, 0.7);
      }
      break;
    }
    case 'ruin': {
      // 废弃大堂：翻倒的货箱 + 熄灭的招牌 + 一条残光
      for (let i = 0; i < 3; i++) {
        put.dark(range(rng, -hx * 0.5, hx * 0.5), 0.3,
          range(rng, -hz * 0.4, hz * 0.5), range(rng, 0.6, 1.1), 0.6, range(rng, 0.6, 1.1));
      }
      put.dark(hx * 0.3, 0.15, -hz * 0.2, 2.0, 0.3, 0.5);
      put.glow(-hx * 0.35, 0.4, hz * 0.2, 1.4, 0.08, 0.08, 0x1e4a44);
      break;
    }
    default: { // residential：信箱墙 + 售货机 ×2 + 长椅
      put.dark(-hx * 0.44, 1.1, -hz * 0.15, 0.28, 1.6, Math.min(hz, 4));
      put.glow(-hx * 0.44 + 0.16, 1.1, -hz * 0.15, 0.03, 1.2, Math.min(hz, 3.6), 0x556066);
      put.dark(hx * 0.42, 0.95, -hz * 0.25, 0.9, 1.9, 0.85);
      put.glow(hx * 0.42 - 0.48, 1.15, -hz * 0.25, 0.06, 1.3, 0.6, 0xff2975);
      put.dark(hx * 0.42, 0.95, -hz * 0.25 + 1.3, 0.9, 1.9, 0.85);
      put.glow(hx * 0.42 - 0.48, 1.15, -hz * 0.25 + 1.3, 0.06, 1.3, 0.6, 0x00e5ff);
      put.solid(hx * 0.42, -hz * 0.25 + 0.65, 1.1, 2.4);
      put.dark(0, 0.28, hz * 0.3, 2.2, 0.55, 0.6);
      break;
    }
  }
}

export interface MinimapVenuePoint {
  x: number;
  z: number;
  color: number;
}

export interface InteriorKits {
  group: THREE.Group;
  colliders: AABB[];
  venueOf(index: number): VenueKind;
  venuePoints: MinimapVenuePoint[];
}

export function createInteriorKits(plots: Plot[], seed: number): InteriorKits {
  const rng = createRng((seed ^ 0x17e2) >>> 0);
  const group = new THREE.Group();
  const colliders: AABB[] = [];
  const venues: VenueKind[] = [];

  interface DarkSpec { m: THREE.Matrix4; }
  interface GlowSpec { m: THREE.Matrix4; color: number; }
  interface GlyphSpec { m: THREE.Matrix4; glyph: number; color: number; }
  const darks: DarkSpec[] = [];
  const glows: GlowSpec[] = [];
  const glyphs: GlyphSpec[] = [];
  const venuePoints: MinimapVenuePoint[] = [];

  const mat4 = () => new THREE.Matrix4();

  for (const p of plots) {
    const { axisX, side } = doorInfoFor(p);
    const venue = venueFor(p.district, p.h, rng());
    venues.push(venue);
    // 局部系：+z 指向门。yaw 将局部坐标旋到世界
    const yaw = axisX ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const hx = (axisX ? p.sz : p.sx) / 2 - 1.2; // 局部横向半宽
    const hz = (axisX ? p.sx : p.sz) / 2 - 1.2; // 局部纵深半宽（门向）
    if (hx < 2.4 || hz < 2.4) continue;

    const toWorld = (lx: number, lz: number): [number, number] => [
      p.x + lx * cosY + lz * sinY,
      p.z - lx * sinY + lz * cosY,
    ];

    const put: PropPlacer = {
      dark(lx, ly, lz, w, h, d) {
        const [wx, wz] = toWorld(lx, lz);
        const m = mat4().makeRotationY(yaw);
        m.scale(new THREE.Vector3(w, h, d));
        m.setPosition(wx, ly, wz);
        darks.push({ m });
      },
      glow(lx, ly, lz, w, h, d, color) {
        const [wx, wz] = toWorld(lx, lz);
        const m = mat4().makeRotationY(yaw);
        m.scale(new THREE.Vector3(w, h, d));
        m.setPosition(wx, ly, wz);
        glows.push({ m, color });
      },
      solid(lx, lz, w, d) {
        const [wx, wz] = toWorld(lx, lz);
        // yaw 均为 90° 倍数，旋转后仍轴对齐
        const [ww, wd] = (Math.abs(sinY) > 0.5) ? [d, w] : [w, d];
        colliders.push({
          minX: wx - ww / 2, maxX: wx + ww / 2,
          minZ: wz - wd / 2, maxZ: wz + wd / 2,
        });
      },
    };
    furnish(venue, hx, hz, rng, put);

    // 门头场所色标灯箱
    const dx = axisX ? p.x + side * (p.sx / 2 + 0.05) : p.x;
    const dz = axisX ? p.z : p.z + side * (p.sz / 2 + 0.05);
    const m = mat4().makeRotationY(yaw);
    m.scale(new THREE.Vector3(2.6, 0.5, 0.14));
    m.setPosition(dx, 4.0, dz);
    glows.push({ m, color: VENUE_COLORS[venue] });

    // 门头文字（挂在色标灯箱上方，街上一眼可辨业态）
    const gm = mat4().makeRotationY(yaw);
    gm.scale(new THREE.Vector3(1.5, 1.5, 1));
    gm.setPosition(
      dx + (axisX ? side * 0.12 : 0), 5.3, dz + (axisX ? 0 : side * 0.12),
    );
    glyphs.push({
      m: gm,
      glyph: GLYPH_LIST.indexOf(VENUE_GLYPHS[venue]),
      color: VENUE_COLORS[venue] === 0x2a3438 ? 0x4a5a60 : VENUE_COLORS[venue],
    });
    venuePoints.push({ x: p.x, z: p.z, color: VENUE_COLORS[venue] });
  }

  // 两个实例化网格承载全城家具
  const darkMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x171a20, roughness: 0.6, metalness: 0.45 }),
    Math.max(darks.length, 1),
  );
  darkMesh.count = darks.length;
  darkMesh.frustumCulled = false;
  darks.forEach((d, i) => darkMesh.setMatrixAt(i, d.m));
  darkMesh.instanceMatrix.needsUpdate = true;

  const glowMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    Math.max(glows.length, 1),
  );
  glowMesh.count = glows.length;
  glowMesh.frustumCulled = false;
  const c = new THREE.Color();
  glows.forEach((g, i) => {
    glowMesh.setMatrixAt(i, g.m);
    glowMesh.setColorAt(i, c.setHex(g.color));
  });
  glowMesh.instanceMatrix.needsUpdate = true;
  if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;

  const glyphMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: GLYPH_VERT,
      fragmentShader: GLYPH_FRAG,
      uniforms: {
        uMap: { value: buildGlyphAtlas() },
        uCount: { value: GLYPH_LIST.length },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    Math.max(glyphs.length, 1),
  );
  glyphMesh.count = glyphs.length;
  glyphMesh.frustumCulled = false;
  const aGlyph = new Float32Array(Math.max(glyphs.length, 1));
  const aColor = new Float32Array(Math.max(glyphs.length, 1) * 3);
  const gc = new THREE.Color();
  glyphs.forEach((g, i) => {
    glyphMesh.setMatrixAt(i, g.m);
    aGlyph[i] = g.glyph;
    gc.setHex(g.color);
    aColor.set([gc.r, gc.g, gc.b], i * 3);
  });
  glyphMesh.geometry.setAttribute(
    'aGlyph', new THREE.InstancedBufferAttribute(aGlyph, 1),
  );
  glyphMesh.geometry.setAttribute(
    'aColor', new THREE.InstancedBufferAttribute(aColor, 3),
  );
  glyphMesh.instanceMatrix.needsUpdate = true;

  group.add(darkMesh, glowMesh, glyphMesh);
  return {
    group,
    colliders,
    venueOf: (i: number) => venues[i] ?? 'residential',
    venuePoints,
  };
}
