# Night City Web 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在浏览器中用原生 Three.js 构建复刻官方地图布局的赛博朋克夜之城：六大区 + 恶土、程序化楼群 + 参数化地标、霓虹/车流/雨夜、飞行 + 漫游双模式。

**Architecture:** 生成逻辑（纯函数，Vitest 可测）与渲染（Three 对象）严格分离。全城楼群用 InstancedMesh + 自定义 shader（窗格发光），全部资产程序化生成、零外部资源。postprocessing 库做 Bloom/ACES 后处理，质量三档自动降级。

**Tech Stack:** Vite + TypeScript + Three.js（原生）+ postprocessing + Vitest + Playwright

**Spec:** `docs/superpowers/specs/2026-07-03-night-city-3d-design.md`

---

## 文件结构总览

| 文件 | 职责 |
|---|---|
| `index.html` / `src/styles.css` | 入口页、HUD/启动画面样式 |
| `src/main.ts` | 启动流程、主循环、模块装配 |
| `src/core/rng.ts` | 可播种伪随机（mulberry32） |
| `src/core/engine.ts` | renderer / scene / camera / composer / 灯光 / resize |
| `src/core/quality.ts` | 质量档位预设 + FPS 监控自动降档（纯逻辑） |
| `src/city/districts.ts` | 区域多边形数据、point-in-polygon、districtAt（纯函数） |
| `src/city/anchors.ts` | 地标锚点世界坐标 + 楼群净空区 |
| `src/city/layout.ts` | 地块生成 generatePlots（纯函数） |
| `src/city/buildings.ts` | 楼群 InstancedMesh + 窗格发光 shader |
| `src/city/neon.ts` | 霓虹招牌图集 + 实例化招牌 + 全息广告 |
| `src/city/ground.ts` | 地面 + 发光路网 shader |
| `src/city/landmarks/arasaka.ts` | 荒坂塔 |
| `src/city/landmarks/megabuilding.ts` | Megabuilding H10 |
| `src/city/landmarks/misc.ts` | Konpeki / Kabuki 穹顶 / Pacifica 废墟 / 恶土风电 |
| `src/city/landmarks/index.ts` | 地标装配 |
| `src/traffic/lightStream.ts` | 通用光点车流系统（Points + 曲线采样） |
| `src/traffic/airTraffic.ts` | 空中 AV 车流路径定义 |
| `src/traffic/groundTraffic.ts` | 地面路网车流定义 |
| `src/atmosphere/sky.ts` | 夜空穹顶 shader（渐变/星/月/闪电闪光） |
| `src/atmosphere/rain.ts` | GPU 雨粒子 |
| `src/atmosphere/lightning.ts` | 闪电调度器 |
| `src/controls/flyControls.ts` | 飞行模式控制 |
| `src/controls/walkControls.ts` | 第一人称漫游控制 |
| `src/controls/modeSwitch.ts` | 模式切换 + 降落/起飞过渡 |
| `src/ui/hud.ts` | 区域名打字机、按键提示、FPS/档位 |
| `src/ui/boot.ts` | 启动画面 + 生成进度 |
| `tests/*.test.ts` | Vitest 单元测试（纯函数模块） |
| `e2e/visual.spec.ts` | Playwright 截图验证 |

约定：
- 场景 1 单位 = 1 米；城市映射到 `[-4000, 4000]²`，y 向上。
- 所有"生成"模块不持有 Three 渲染对象引用之外的状态；`districts.ts`、`layout.ts`、`quality.ts`、`rng.ts` 为纯逻辑，是单测对象。
- 动态模块统一暴露 `update(dt: number, t: number): void`，由 main 收集调用。
- 提交信息遵循 `<type>: <描述>`（用户全局规范，无 attribution 尾注）。

---

### Task 1: 工程骨架

**Files:**
- Create: `package.json`, `tsconfig.json`, `index.html`, `src/styles.css`, `src/main.ts`, `.gitignore`, `tests/smoke.test.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "night-city-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "e2e": "playwright test"
  }
}
```

- [ ] **Step 2: 安装依赖**

```bash
npm install three postprocessing
npm install -D typescript vite vitest @types/three
```

预期：安装成功，无 peer 冲突。

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "e2e"]
}
```

- [ ] **Step 4: 创建 index.html**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NIGHT CITY // 夜之城</title>
  <link rel="stylesheet" href="/src/styles.css" />
</head>
<body>
  <canvas id="scene"></canvas>
  <div id="overlay"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 5: 创建 src/styles.css（基础层，HUD 样式后续任务补充）**

```css
:root {
  --color-hud: #fcee0a;
  --color-hud-dim: rgba(252, 238, 10, 0.55);
  --color-bg: #050507;
  --color-accent: #00e5ff;
  --font-mono: "SF Mono", "Cascadia Code", "JetBrains Mono", ui-monospace, monospace;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body { height: 100%; overflow: hidden; background: var(--color-bg); }

#scene { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }

#overlay { position: fixed; inset: 0; pointer-events: none; font-family: var(--font-mono); }
```

- [ ] **Step 6: 创建 src/main.ts 占位**

```ts
const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
overlay.textContent = 'NIGHT CITY // BOOTING…';
```

- [ ] **Step 7: 创建 .gitignore**

```
node_modules/
dist/
test-results/
playwright-report/
```

- [ ] **Step 8: 创建 vitest 冒烟测试 tests/smoke.test.ts**

```ts
import { describe, it, expect } from 'vitest';

describe('工程骨架', () => {
  it('vitest 正常运行', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 9: 验证构建与测试**

```bash
npm run build && npm test
```

预期：build 成功产出 `dist/`；vitest 1 passed。

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "chore: Vite + TS + Three.js 工程骨架"
```

---

### Task 2: 可播种 RNG（TDD）

**Files:**
- Create: `src/core/rng.ts`
- Test: `tests/rng.test.ts`

- [ ] **Step 1: 写失败测试 tests/rng.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { createRng, range, rangeInt, pick } from '../src/core/rng';

describe('createRng', () => {
  it('相同种子产生相同序列', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('不同种子产生不同序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });

  it('输出始终落在 [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('辅助函数', () => {
  it('range 输出在 [min, max)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const v = range(rng, 5, 9);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(9);
    }
  });

  it('rangeInt 覆盖闭区间端点', () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rangeInt(rng, 1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('pick 只返回数组内元素', () => {
    const rng = createRng(5);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) expect(arr).toContain(pick(rng, arr));
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/rng.test.ts
```

预期：FAIL，`Cannot find module '../src/core/rng'`。

- [ ] **Step 3: 实现 src/core/rng.ts（mulberry32）**

```ts
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function rangeInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/rng.test.ts
```

预期：PASS，6 tests。

- [ ] **Step 5: Commit**

```bash
git add src/core/rng.ts tests/rng.test.ts
git commit -m "feat: 可播种伪随机 rng（mulberry32）"
```

---

### Task 3: 区域数据与归属判定（TDD）

**Files:**
- Create: `src/city/districts.ts`
- Test: `tests/districts.test.ts`

- [ ] **Step 1: 写失败测试 tests/districts.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import {
  CITY_SIZE, DISTRICTS, pointInPolygon, districtAt, normToWorld,
} from '../src/city/districts';

describe('pointInPolygon', () => {
  const square: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];

  it('内部点为 true', () => {
    expect(pointInPolygon(0.5, 0.5, square)).toBe(true);
  });

  it('外部点为 false', () => {
    expect(pointInPolygon(1.5, 0.5, square)).toBe(false);
    expect(pointInPolygon(-0.1, 0.5, square)).toBe(false);
  });

  it('凹多边形正确判定', () => {
    const lShape: Array<[number, number]> = [
      [0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2],
    ];
    expect(pointInPolygon(0.5, 1.5, lShape)).toBe(true);
    expect(pointInPolygon(1.5, 1.5, lShape)).toBe(false);
  });
});

describe('DISTRICTS 数据', () => {
  it('包含六大区', () => {
    expect(DISTRICTS.map((d) => d.id).sort()).toEqual([
      'city-center', 'heywood', 'pacifica', 'santo-domingo', 'watson', 'westbrook',
    ]);
  });

  it('每区多边形至少 4 个顶点且坐标归一化', () => {
    for (const d of DISTRICTS) {
      expect(d.polygon.length).toBeGreaterThanOrEqual(4);
      for (const [x, y] of d.polygon) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('楼高范围与密度合法', () => {
    for (const d of DISTRICTS) {
      const [lo, hi] = d.style.heightRange;
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeGreaterThan(lo);
      expect(d.style.density).toBeGreaterThan(0);
      expect(d.style.density).toBeLessThanOrEqual(1);
    }
  });
});

describe('districtAt（世界坐标）', () => {
  // 每区一个已知内部点（归一化）
  const probes: Array<[string, number, number]> = [
    ['watson', 0.5, 0.2],
    ['westbrook', 0.8, 0.25],
    ['city-center', 0.4, 0.47],
    ['heywood', 0.62, 0.55],
    ['santo-domingo', 0.82, 0.6],
    ['pacifica', 0.38, 0.7],
  ];

  it.each(probes)('%s 内部点归属正确', (id, nx, ny) => {
    const [wx, wz] = normToWorld(nx, ny);
    expect(districtAt(wx, wz)?.id).toBe(id);
  });

  it('城区外返回 null（恶土）', () => {
    expect(districtAt(-CITY_SIZE / 2 + 10, -CITY_SIZE / 2 + 10)).toBeNull();
    expect(districtAt(CITY_SIZE, CITY_SIZE)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/districts.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 src/city/districts.ts**

```ts
export const CITY_SIZE = 8000;

export type DistrictId =
  | 'watson' | 'westbrook' | 'city-center'
  | 'heywood' | 'santo-domingo' | 'pacifica';

export interface DistrictStyle {
  label: string;
  heightRange: [number, number];
  heightBias: number;       // >1 偏矮，<1 偏高
  cellSize: number;         // 地块网格尺寸（米）
  density: number;          // 地块生成概率 0..1
  windowLitRate: number;    // 窗亮率 0..1
  facadeColor: number;      // 立面基色
  neonDensity: number;      // 霓虹密度 0..1
  neonPalette: number[];    // 霓虹色板
}

export interface District {
  id: DistrictId;
  style: DistrictStyle;
  polygon: Array<[number, number]>; // 归一化 [0,1]²，x→东，y→南
}

export const BADLANDS_LABEL = 'BADLANDS';

export const DISTRICTS: District[] = [
  {
    id: 'watson',
    style: {
      label: 'WATSON', heightRange: [40, 190], heightBias: 1.6, cellSize: 58,
      density: 0.93, windowLitRate: 0.5, facadeColor: 0x18202c,
      neonDensity: 1.0, neonPalette: [0xff2975, 0x00ffd5, 0xffe600, 0xff6a00],
    },
    polygon: [[0.28, 0.04], [0.66, 0.06], [0.68, 0.34], [0.44, 0.40], [0.28, 0.32]],
  },
  {
    id: 'westbrook',
    style: {
      label: 'WESTBROOK', heightRange: [60, 250], heightBias: 1.4, cellSize: 70,
      density: 0.82, windowLitRate: 0.55, facadeColor: 0x1b1826,
      neonDensity: 0.8, neonPalette: [0xff7ad9, 0xb96bff, 0x00e5ff],
    },
    polygon: [[0.66, 0.06], [0.94, 0.12], [0.92, 0.44], [0.68, 0.42], [0.68, 0.34]],
  },
  {
    id: 'city-center',
    style: {
      label: 'CITY CENTER', heightRange: [120, 450], heightBias: 2.0, cellSize: 88,
      density: 0.85, windowLitRate: 0.6, facadeColor: 0x101724,
      neonDensity: 0.5, neonPalette: [0x00e5ff, 0xffd24a, 0xff2975],
    },
    polygon: [[0.28, 0.32], [0.44, 0.40], [0.58, 0.44], [0.56, 0.62], [0.26, 0.58]],
  },
  {
    id: 'heywood',
    style: {
      label: 'HEYWOOD', heightRange: [30, 130], heightBias: 1.7, cellSize: 62,
      density: 0.88, windowLitRate: 0.45, facadeColor: 0x201c18,
      neonDensity: 0.35, neonPalette: [0xffd24a, 0xff6a00, 0x00ffd5],
    },
    polygon: [[0.58, 0.44], [0.68, 0.42], [0.72, 0.64], [0.56, 0.72], [0.56, 0.62]],
  },
  {
    id: 'santo-domingo',
    style: {
      label: 'SANTO DOMINGO', heightRange: [20, 95], heightBias: 1.8, cellSize: 96,
      density: 0.62, windowLitRate: 0.35, facadeColor: 0x241d14,
      neonDensity: 0.25, neonPalette: [0xff9e3d, 0xffd24a],
    },
    polygon: [[0.68, 0.42], [0.92, 0.44], [0.94, 0.86], [0.72, 0.84], [0.72, 0.64]],
  },
  {
    id: 'pacifica',
    style: {
      label: 'PACIFICA', heightRange: [15, 75], heightBias: 1.9, cellSize: 66,
      density: 0.5, windowLitRate: 0.15, facadeColor: 0x161a1a,
      neonDensity: 0.12, neonPalette: [0x00ffd5, 0xff2975],
    },
    polygon: [[0.26, 0.58], [0.56, 0.62], [0.56, 0.72], [0.50, 0.88], [0.24, 0.80]],
  },
];

export function pointInPolygon(
  x: number, y: number, poly: Array<[number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function normToWorld(nx: number, ny: number): [number, number] {
  return [(nx - 0.5) * CITY_SIZE, (ny - 0.5) * CITY_SIZE];
}

export function districtAt(wx: number, wz: number): District | null {
  const nx = wx / CITY_SIZE + 0.5;
  const ny = wz / CITY_SIZE + 0.5;
  for (const d of DISTRICTS) {
    if (pointInPolygon(nx, ny, d.polygon)) return d;
  }
  return null;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/districts.test.ts
```

预期：PASS，全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/city/districts.ts tests/districts.test.ts
git commit -m "feat: 六大区多边形数据与区域归属判定"
```

---

### Task 4: 引擎核心 + 夜空 + 飞行相机（可飞的空场景）

**Files:**
- Create: `src/core/engine.ts`, `src/atmosphere/sky.ts`, `src/controls/flyControls.ts`
- Modify: `src/main.ts`（整体替换）

渲染胶水代码，无单测；验证 = `npm run build` + dev 目视（能在雾夜中飞行，可见夜空渐变与星点）。

- [ ] **Step 1: 实现 src/core/engine.ts**

```ts
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
```

- [ ] **Step 2: 实现 src/atmosphere/sky.ts**

```ts
import * as THREE from 'three';

export interface Sky {
  mesh: THREE.Mesh;
  setFlash(v: number): void;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vDir;
uniform float uFlash;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  // 地平线：城市光污染的紫红辉光 → 天顶深蓝黑
  vec3 zenith = vec3(0.008, 0.010, 0.030);
  vec3 horizon = vec3(0.16, 0.06, 0.18);
  vec3 col = mix(horizon, zenith, pow(h, 0.45));

  // 星点（高处才可见）
  vec2 cell = floor(vDir.xz / max(vDir.y, 0.08) * 240.0);
  float star = step(0.9975, hash21(cell)) * smoothstep(0.15, 0.5, h);
  col += vec3(0.7, 0.8, 1.0) * star * 0.6;

  // 月亮
  vec3 moonDir = normalize(vec3(0.45, 0.55, 0.2));
  float moon = smoothstep(0.9992, 0.9997, dot(vDir, moonDir));
  col += vec3(0.75, 0.8, 0.95) * moon * 1.4;

  // 闪电闪光
  col += vec3(0.55, 0.6, 0.9) * uFlash;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky(): Sky {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uFlash: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    setFlash(v: number) { mat.uniforms.uFlash.value = v; },
  };
}
```

- [ ] **Step 3: 实现 src/controls/flyControls.ts**

```ts
import * as THREE from 'three';

const BOOST_MULT = 5;
const BASE_SPEED = 160;

export class FlyControls {
  enabled = true;
  private yaw = 0;
  private pitch = -0.12;
  private vel = new THREE.Vector3();
  private keys = new Set<string>();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('click', () => {
      if (this.enabled && document.pointerLockElement !== dom) {
        dom.requestPointerLock();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - e.movementY * 0.0022, -1.45, 1.45,
      );
    });
  }

  /** 供模式切换时同步视角 */
  syncFromCamera(): void {
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);

    const fwd = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const up = Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));
    const speed = BASE_SPEED * (this.keys.has('ShiftLeft') ? BOOST_MULT : 1);

    const target = new THREE.Vector3(right, 0, -fwd)
      .applyQuaternion(this.camera.quaternion);
    target.y += up;
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(speed);

    this.vel.lerp(target, 1 - Math.exp(-dt * 6));
    this.camera.position.addScaledVector(this.vel, dt);

    // 边界软约束
    const p = this.camera.position;
    p.y = THREE.MathUtils.clamp(p.y, 4, 1600);
    const r = Math.hypot(p.x, p.z);
    if (r > 5600) {
      const k = 5600 / r;
      p.x *= k; p.z *= k;
    }
  }
}
```

- [ ] **Step 4: 重写 src/main.ts**

```ts
import * as THREE from 'three';
import { createEngine } from './core/engine';
import { createSky } from './atmosphere/sky';
import { FlyControls } from './controls/flyControls';

export interface Updatable {
  update(dt: number, t: number): void;
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const engine = createEngine(canvas);
const updatables: Updatable[] = [];

const sky = createSky();
engine.scene.add(sky.mesh);

// 临时参照物：中心一个发光盒，确认渲染与飞行正常（Task 6 移除）
const probe = new THREE.Mesh(
  new THREE.BoxGeometry(100, 300, 100),
  new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x00e5ff, emissiveIntensity: 2 }),
);
probe.position.y = 150;
engine.scene.add(probe);

const fly = new FlyControls(engine.camera, canvas);
updatables.push({ update: (dt) => fly.update(dt) });

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  for (const u of updatables) u.update(dt, t);
  engine.render(dt);
}
loop();
```

- [ ] **Step 5: 验证**

```bash
npm run build
```

预期：构建成功。`npm run dev` 目视检查：暗夜天空渐变 + 星点 + 月亮，中心青色发光盒，点击画布锁定鼠标后 WASD/QE/Shift 可自由飞行。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: 渲染引擎核心、夜空穹顶与飞行相机"
```

---

### Task 5: 地标锚点 + 地块生成（TDD）

**Files:**
- Create: `src/city/anchors.ts`, `src/city/layout.ts`
- Test: `tests/layout.test.ts`

- [ ] **Step 1: 实现 src/city/anchors.ts（纯数据，供 layout 净空与地标定位共用）**

```ts
/** 地标锚点（世界坐标）与楼群净空半径 */
export interface LandmarkAnchor {
  id: string;
  x: number;
  z: number;
  r: number; // 净空半径（米）
}

export const LANDMARK_ANCHORS: LandmarkAnchor[] = [
  { id: 'arasaka', x: -760, z: -240, r: 300 },   // 市中心 荒坂塔
  { id: 'corpo-twins', x: -1300, z: 240, r: 200 }, // 市中心 双塔
  { id: 'megabuilding-h10', x: 0, z: -2400, r: 240 }, // Watson H10
  { id: 'kabuki-dome', x: 960, z: -2800, r: 170 },    // Watson Kabuki 市场穹顶
  { id: 'konpeki', x: 400, z: -640, r: 150 },         // 市中心边缘 Konpeki
  { id: 'pacifica-ruin', x: -800, z: 2000, r: 230 },  // Pacifica 烂尾大酒店
];

export const LANDMARK_CLEARINGS = LANDMARK_ANCHORS.map(({ x, z, r }) => ({ x, z, r }));
```

- [ ] **Step 2: 写失败测试 tests/layout.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { generatePlots, distToRoad, ROAD_HALF_WIDTH } from '../src/city/layout';
import { DISTRICTS, pointInPolygon, CITY_SIZE } from '../src/city/districts';
import { LANDMARK_CLEARINGS } from '../src/city/anchors';

const SEED = 20770703;

describe('generatePlots', () => {
  const plots = generatePlots(SEED);
  const byId = new Map(DISTRICTS.map((d) => [d.id, d]));

  it('相同种子结果确定', () => {
    const again = generatePlots(SEED);
    expect(again.length).toBe(plots.length);
    expect(again[0]).toEqual(plots[0]);
    expect(again[again.length - 1]).toEqual(plots[plots.length - 1]);
  });

  it('产出规模在预期区间（全城）', () => {
    expect(plots.length).toBeGreaterThan(8000);
    expect(plots.length).toBeLessThan(60000);
  });

  it('每个地块中心都在所属区域多边形内', () => {
    for (const p of plots) {
      const d = byId.get(p.district)!;
      const nx = p.x / CITY_SIZE + 0.5;
      const nz = p.z / CITY_SIZE + 0.5;
      expect(pointInPolygon(nx, nz, d.polygon)).toBe(true);
    }
  });

  it('楼高落在区域风格范围内（含市中心超高层加成上限 460）', () => {
    for (const p of plots) {
      const [lo, hi] = byId.get(p.district)!.style.heightRange;
      expect(p.h).toBeGreaterThanOrEqual(lo);
      expect(p.h).toBeLessThanOrEqual(Math.max(hi, 460));
    }
  });

  it('地块避开路网', () => {
    for (const p of plots) {
      expect(distToRoad(p.x)).toBeGreaterThanOrEqual(ROAD_HALF_WIDTH);
      expect(distToRoad(p.z)).toBeGreaterThanOrEqual(ROAD_HALF_WIDTH);
    }
  });

  it('地块避开地标净空区', () => {
    for (const p of plots) {
      for (const c of LANDMARK_CLEARINGS) {
        const dist = Math.hypot(p.x - c.x, p.z - c.z);
        expect(dist).toBeGreaterThanOrEqual(c.r);
      }
    }
  });

  it('六大区均有产出', () => {
    const ids = new Set(plots.map((p) => p.district));
    expect(ids.size).toBe(6);
  });
});
```

- [ ] **Step 3: 运行确认失败**

```bash
npx vitest run tests/layout.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 4: 实现 src/city/layout.ts**

```ts
import {
  CITY_SIZE, DISTRICTS, DistrictId, pointInPolygon,
} from './districts';
import { LANDMARK_CLEARINGS } from './anchors';
import { createRng, range } from '../core/rng';

export const ROAD_SPACING = 480;
export const ROAD_HALF_WIDTH = 26;

export interface Plot {
  x: number; z: number;   // 中心（世界坐标）
  sx: number; sz: number; // 底面尺寸
  h: number;              // 楼高
  district: DistrictId;
  kind: number;           // 建筑形体 0..4
  litRate: number;        // 该楼窗亮率
}

/** 到最近路网中心线的距离（路网位于 ROAD_SPACING 整数倍坐标处） */
export function distToRoad(v: number): number {
  const r = ((v % ROAD_SPACING) + ROAD_SPACING) % ROAD_SPACING;
  return Math.min(r, ROAD_SPACING - r);
}

function inClearing(x: number, z: number): boolean {
  for (const c of LANDMARK_CLEARINGS) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < c.r * c.r) return true;
  }
  return false;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generatePlots(seed: number): Plot[] {
  const plots: Plot[] = [];
  for (const d of DISTRICTS) {
    const rng = createRng((seed ^ hashId(d.id)) >>> 0);
    const s = d.style;

    let minX = 1; let minY = 1; let maxX = 0; let maxY = 0;
    for (const [px, py] of d.polygon) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    const x0 = (minX - 0.5) * CITY_SIZE;
    const x1 = (maxX - 0.5) * CITY_SIZE;
    const z0 = (minY - 0.5) * CITY_SIZE;
    const z1 = (maxY - 0.5) * CITY_SIZE;

    for (let gx = x0; gx < x1; gx += s.cellSize) {
      for (let gz = z0; gz < z1; gz += s.cellSize) {
        if (rng() > s.density) continue;
        const x = gx + range(rng, 0.25, 0.75) * s.cellSize;
        const z = gz + range(rng, 0.25, 0.75) * s.cellSize;

        const margin = ROAD_HALF_WIDTH + s.cellSize * 0.3;
        if (distToRoad(x) < margin || distToRoad(z) < margin) continue;

        const nx = x / CITY_SIZE + 0.5;
        const nz = z / CITY_SIZE + 0.5;
        if (!pointInPolygon(nx, nz, d.polygon)) continue;
        if (inClearing(x, z)) continue;

        const [hLo, hHi] = s.heightRange;
        let h = hLo + (hHi - hLo) * Math.pow(rng(), s.heightBias);
        if (d.id === 'city-center' && rng() < 0.05) {
          h = Math.min(h * 1.8, 460); // 少量超高层
        }

        plots.push({
          x, z,
          sx: s.cellSize * range(rng, 0.42, 0.68),
          sz: s.cellSize * range(rng, 0.42, 0.68),
          h,
          district: d.id,
          kind: Math.floor(rng() * 5),
          litRate: Math.min(1, s.windowLitRate * range(rng, 0.7, 1.25)),
        });
      }
    }
  }
  return plots;
}
```

- [ ] **Step 5: 运行确认通过**

```bash
npx vitest run tests/layout.test.ts
```

预期：PASS 全部（首次运行如规模断言失败，微调 cellSize/density 使 plots > 8000 —— 这是唯一允许调整的参数）。

- [ ] **Step 6: 全量测试回归 + Commit**

```bash
npm test
git add src/city/anchors.ts src/city/layout.ts tests/layout.test.ts
git commit -m "feat: 地标锚点与全城地块生成（路网避让/净空区）"
```

---

### Task 6: 楼群 InstancedMesh + 窗格发光 shader（灰盒城市点亮）

**Files:**
- Create: `src/city/buildings.ts`
- Modify: `src/main.ts`（接入楼群，移除临时参照盒）

渲染模块，无单测；验证 = build + dev 目视（全城楼群成型、窗格发光、少量闪烁）。

- [ ] **Step 1: 实现 src/city/buildings.ts**

要点：
- 5 种形体（0 直筒 / 1 阶梯塔 / 2 天线塔 / 3 板楼 / 4 双子楼），单位几何（底面 1×1、高 1、底部 y=0），实例缩放 `aScale = (sx, h, sz)`。
- `instanceMatrix` 只含平移；缩放走 `aScale` attribute，shader 里 `position * aScale` 得到米制局部坐标，直接用于窗格网格计算（窗宽 4m、层高 3.6m）。
- ShaderMaterial 需手动声明 `attribute mat4 instanceMatrix;` 并手动实现指数雾（与 scene.fog 参数一致）。
- `frustumCulled = false`（实例散布全城，包围球不可用）。

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Plot } from './layout';
import { DISTRICTS } from './districts';
import { createRng, range } from '../core/rng';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';

const KIND_COUNT = 5;

const VERT = /* glsl */ `
attribute mat4 instanceMatrix;
attribute vec3 aScale;
attribute vec3 aTint;
attribute float aLit;
attribute float aSeed;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vTint;
varying float vLit;
varying float vSeed;
varying float vDist;

void main() {
  vLocal = position * aScale;
  vNormal = normal;
  vTint = aTint;
  vLit = aLit;
  vSeed = aSeed;
  vec4 world = instanceMatrix * vec4(vLocal, 1.0);
  vec4 view = viewMatrix * world;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vTint;
varying float vLit;
varying float vSeed;
varying float vDist;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec3 n = normalize(vNormal);
  // 暗立面基色 + 微弱顶面光
  vec3 col = vTint * (0.35 + 0.5 * max(n.y, 0.0));

  // 侧面窗格
  if (abs(n.y) < 0.5) {
    vec2 wallUV = abs(n.x) > 0.5 ? vLocal.zy : vLocal.xy;
    vec2 cellSize = vec2(4.0, 3.6);
    vec2 cell = floor(wallUV / cellSize);
    vec2 f = fract(wallUV / cellSize);
    float rnd = hash21(cell + vSeed);
    float lit = step(1.0 - vLit, rnd);
    float frame = step(0.18, f.x) * step(f.x, 0.82)
                * step(0.22, f.y) * step(f.y, 0.88);
    float warm = hash21(cell + vSeed + 7.0);
    vec3 winCol = mix(vec3(0.35, 0.72, 1.0), vec3(1.0, 0.72, 0.38), step(0.55, warm));
    float flicker = 1.0;
    if (rnd > 0.986) {
      flicker = 0.4 + 0.6 * step(0.0, sin(uTime * (8.0 + warm * 40.0) + vSeed * 10.0));
    }
    col += winCol * lit * frame * flicker * 1.7;
  }

  // 近地面压暗（假 AO）
  col *= clamp(vLocal.y / 25.0 + 0.35, 0.35, 1.0);

  // 指数平方雾（与 scene.fog 一致）
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

function unitBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

function archetypeGeometry(kind: number): THREE.BufferGeometry {
  switch (kind) {
    case 1: { // 阶梯塔：主体 + 收分顶部
      const top = unitBox();
      top.scale(0.62, 0.32, 0.62);
      top.translate(0, 1.0, 0);
      return mergeGeometries([unitBox(), top]);
    }
    case 2: { // 天线塔
      const mast = new THREE.BoxGeometry(0.05, 0.4, 0.05);
      mast.translate(0, 1.2, 0);
      return mergeGeometries([unitBox(), mast]);
    }
    case 3: { // 板楼（矮宽）
      const g = unitBox();
      g.scale(1.35, 0.62, 0.75);
      return g;
    }
    case 4: { // 双子楼
      const a = unitBox(); a.scale(0.42, 1.0, 0.9); a.translate(-0.28, 0, 0);
      const b = unitBox(); b.scale(0.42, 0.82, 0.9); b.translate(0.28, 0, 0);
      return mergeGeometries([a, b]);
    }
    default:
      return unitBox();
  }
}

export interface Buildings {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

export function createBuildings(plots: Plot[], seed: number): Buildings {
  const styleById = new Map(DISTRICTS.map((d) => [d.id, d.style]));
  const rng = createRng(seed);
  const group = new THREE.Group();

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
    },
  });

  const byKind: Plot[][] = Array.from({ length: KIND_COUNT }, () => []);
  for (const p of plots) byKind[p.kind].push(p);

  const tint = new THREE.Color();
  const m = new THREE.Matrix4();

  byKind.forEach((list, kind) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(archetypeGeometry(kind), material, list.length);
    mesh.frustumCulled = false;

    const aScale = new Float32Array(list.length * 3);
    const aTint = new Float32Array(list.length * 3);
    const aLit = new Float32Array(list.length);
    const aSeed = new Float32Array(list.length);

    list.forEach((p, i) => {
      m.makeTranslation(p.x, 0, p.z);
      mesh.setMatrixAt(i, m);
      aScale.set([p.sx, p.h, p.sz], i * 3);
      tint.setHex(styleById.get(p.district)!.facadeColor);
      const jitter = range(rng, 0.8, 1.2);
      aTint.set([tint.r * jitter, tint.g * jitter, tint.b * jitter], i * 3);
      aLit[i] = p.litRate;
      aSeed[i] = range(rng, 0, 100);
    });

    const geo = mesh.geometry as THREE.BufferGeometry;
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 3));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 3));
    geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(aLit, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  });

  return {
    group,
    update(_dt: number, t: number) {
      material.uniforms.uTime.value = t;
    },
  };
}
```

注意：每种形体的 `archetypeGeometry` 返回新几何但共享同一 material —— 全城楼体 5 个 draw call。
InstancedMesh + ShaderMaterial 时 three 会自动定义 `USE_INSTANCING`，但 **不会** 注入 attribute 声明，所以 shader 顶部手动声明 `attribute mat4 instanceMatrix;` 是必须的、也是安全的（不会重复声明）。

- [ ] **Step 2: 修改 src/main.ts —— 移除临时参照盒，接入楼群**

删除 `probe` 相关 3 行与 `MeshStandardMaterial` 导入依赖，替换为：

```ts
import { generatePlots } from './city/layout';
import { createBuildings } from './city/buildings';

export const SEED = 20770703;

const plots = generatePlots(SEED);
const buildings = createBuildings(plots, SEED);
engine.scene.add(buildings.group);
updatables.push(buildings);
```

（`SEED` 定义放在文件顶部常量区；后续任务复用。）

- [ ] **Step 3: 验证**

```bash
npm run build && npm test
```

预期：build 成功、既有测试全绿。`npm run dev` 目视：万栋级楼群按六区分布成型，夜色中窗格发光、偶发闪烁，远景没入雾中。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: 全城楼群实例化渲染与窗格发光 shader"
```

---

### Task 7: 地面与发光路网

**Files:**
- Create: `src/city/ground.ts`
- Modify: `src/main.ts`（接入地面）

- [ ] **Step 1: 实现 src/city/ground.ts**

```ts
import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';

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
varying vec2 vWorld;
varying float vDist;

float roadGlow(float coord, float spacing, float width) {
  float r = mod(coord, spacing);
  float d = min(r, spacing - r);
  return smoothstep(width, 0.0, d);
}

void main() {
  float cityMask = 1.0 - smoothstep(3400.0, 4400.0, length(vWorld));

  // 城内湿沥青偏蓝，城外恶土偏棕
  vec3 col = mix(vec3(0.05, 0.042, 0.034), vec3(0.030, 0.034, 0.052), cityMask);

  // 路网灯带（与 layout ROAD_SPACING=480 对齐）
  float g = max(roadGlow(vWorld.x, 480.0, 7.0), roadGlow(vWorld.y, 480.0, 7.0));
  col += vec3(0.12, 0.55, 0.85) * g * 0.4 * cityMask;

  // 路口加亮
  float gx = roadGlow(vWorld.x, 480.0, 7.0);
  float gy = roadGlow(vWorld.y, 480.0, 7.0);
  col += vec3(0.9, 0.75, 0.4) * gx * gy * 0.5 * cityMask;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createGround(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.1;
  return mesh;
}
```

- [ ] **Step 2: 修改 src/main.ts 接入**

```ts
import { createGround } from './city/ground';

engine.scene.add(createGround());
```

- [ ] **Step 3: 验证 + Commit**

```bash
npm run build && npm test
git add -A && git commit -m "feat: 地面与发光路网"
```

预期：dev 目视地面出现青色路网灯带、路口暖光、城外渐变为恶土色。

---

### Task 8: Bloom 后处理链（霓虹辉光的灵魂）

**Files:**
- Modify: `src/core/engine.ts`（补全效果链，暴露效果引用供质量档位调节）

- [ ] **Step 1: 修改 src/core/engine.ts**

在 imports 中扩充：

```ts
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, VignetteEffect, ChromaticAberrationEffect,
  ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
```

`Engine` 接口补充字段：

```ts
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
```

`createEngine` 中，`composer.addPass(new RenderPass(scene, camera));` 之后追加：

```ts
  const bloom = new BloomEffect({
    intensity: 1.15,
    luminanceThreshold: 0.22,
    luminanceSmoothing: 0.25,
    mipmapBlur: true,
  });
  const chromatic = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(0.0008, 0.0008),
    radialModulation: true,
    modulationOffset: 0.35,
  });
  const vignette = new VignetteEffect({ darkness: 0.55, offset: 0.32 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  composer.addPass(new EffectPass(camera, bloom, vignette, chromatic, tone));
```

return 对象补充 `bloom, chromatic`。

- [ ] **Step 2: 验证**

```bash
npm run build && npm test
```

预期：build 成功。dev 目视：窗光/路网产生柔和辉光，整体 ACES 电影感对比，边缘暗角 + 轻微色差。若画面过曝，将 `luminanceThreshold` 上调至 0.3（唯一允许的调整）。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: Bloom/ACES/暗角/色差后处理链"
```

---

### Task 9: 霓虹招牌 + 全息广告

**Files:**
- Create: `src/city/neon.ts`
- Modify: `src/main.ts`（接入霓虹）

- [ ] **Step 1: 实现 src/city/neon.ts**

三部分：canvas 招牌图集（4×4 tile，白字白框，实例色相乘）、实例化招牌（单 draw call，最多 4000 面）、6 面旋转全息广告。

```ts
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
    if (cjk && word.length <= 4) {
      // 竖排
      ctx.font = 'bold ' + tile * 0.3 + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const step = tile / (word.length + 1);
      [...word].forEach((ch, k) => {
        ctx.fillText(ch, tile / 2, step * (k + 1));
      });
    } else {
      ctx.font = 'bold ' + tile * 0.22 + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word, tile / 2, tile / 2, tile - 40);
    }
    ctx.restore();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const SIGN_VERT = /* glsl */ `
attribute mat4 instanceMatrix;
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
  vec4 t = texture2D(uMap, vUv / 4.0 + vUvOffset);
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
  const geo = mesh.geometry as THREE.BufferGeometry;
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
```

- [ ] **Step 2: 修改 src/main.ts 接入**

```ts
import { createNeon } from './city/neon';

const neon = createNeon(plots, SEED);
engine.scene.add(neon.group);
updatables.push(neon);
```

- [ ] **Step 3: 验证 + Commit**

```bash
npm run build && npm test
git add -A && git commit -m "feat: 实例化霓虹招牌与全息广告"
```

预期：dev 目视 Watson/Japantown 招牌密集、bloom 辉光生效、偶发断电闪烁；地标上空有旋转全息投影。

---

### Task 10: 地标建筑 + 恶土装置

**Files:**
- Create: `src/city/landmarks/arasaka.ts`, `src/city/landmarks/megabuilding.ts`, `src/city/landmarks/misc.ts`, `src/city/landmarks/index.ts`
- Modify: `src/main.ts`

地标用 MeshStandardMaterial（自动受雾影响）+ emissive 条带（进 bloom）。

- [ ] **Step 1: 实现 src/city/landmarks/arasaka.ts**

```ts
import * as THREE from 'three';

const DARK = new THREE.MeshStandardMaterial({
  color: 0x0b0e16, roughness: 0.4, metalness: 0.8,
});

function slab(w: number, h: number, d: number, y: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), DARK);
  m.position.y = y + h / 2;
  return m;
}

function glowBand(w: number, d: number, y: number, color: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: color, emissiveIntensity: 2.5,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), mat);
  m.position.y = y;
  return m;
}

/** 荒坂塔：三段收分阶梯体量 + 红色警示光带，全城制高点 */
export function createArasakaTower(): THREE.Group {
  const g = new THREE.Group();
  g.add(slab(220, 220, 180, 0));
  g.add(slab(160, 180, 130, 220));
  g.add(slab(100, 140, 80, 400));
  g.add(glowBand(224, 184, 218, 0xff2020));
  g.add(glowBand(164, 134, 398, 0xff2020));
  g.add(glowBand(104, 84, 538, 0xff2020));
  // 顶部信标
  const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(14, 30, 14),
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff3030, emissiveIntensity: 4,
    }),
  );
  beacon.position.y = 555;
  g.add(beacon);
  return g;
}
```

- [ ] **Step 2: 实现 src/city/landmarks/megabuilding.ts**

```ts
import * as THREE from 'three';

/** Megabuilding H10：巨型收分巨构 + 层间光槽 */
export function createMegabuilding(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color: 0x11141c, roughness: 0.6, metalness: 0.5,
  });
  const widths = [300, 260, 220, 180];
  let y = 0;
  widths.forEach((w, i) => {
    const h = 55;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.85), body);
    m.position.y = y + h / 2;
    g.add(m);
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(w + 4, 2.5, w * 0.85 + 4),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: i % 2 === 0 ? 0xffa030 : 0x30c8ff,
        emissiveIntensity: 2,
      }),
    );
    slot.position.y = y + h;
    g.add(slot);
    y += h;
  });
  return g;
}
```

- [ ] **Step 3: 实现 src/city/landmarks/misc.ts**

```ts
import * as THREE from 'three';
import { createRng, range } from '../../core/rng';

const DARK = new THREE.MeshStandardMaterial({
  color: 0x0d1018, roughness: 0.5, metalness: 0.6,
});

function emissiveMat(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: color, emissiveIntensity: intensity,
  });
}

/** Konpeki Plaza：细长塔 + 青色冠部 */
export function createKonpeki(): THREE.Group {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.BoxGeometry(70, 240, 70), DARK);
  tower.position.y = 120;
  g.add(tower);
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(76, 10, 76), emissiveMat(0x00e5ff, 3),
  );
  crown.position.y = 245;
  g.add(crown);
  return g;
}

/** Kabuki 市场穹顶 */
export function createKabukiDome(): THREE.Group {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x131018, roughness: 0.4, metalness: 0.7,
    }),
  );
  g.add(dome);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(90, 1.6, 8, 48), emissiveMat(0xff2975, 2.5),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 24;
  g.add(ring);
  return g;
}

/** Pacifica 烂尾大酒店：歪斜暗楼 + 极少灯 */
export function createPacificaRuin(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(160, 190, 110),
    new THREE.MeshStandardMaterial({
      color: 0x0a0c0c, roughness: 0.9, metalness: 0.2,
    }),
  );
  body.position.y = 95;
  body.rotation.z = 0.015;
  g.add(body);
  const cross = new THREE.Mesh(
    new THREE.BoxGeometry(60, 8, 4), emissiveMat(0x00ffd5, 1.5),
  );
  cross.position.set(0, 170, 57);
  g.add(cross);
  return g;
}

/** 恶土：风电桅杆 + 警示灯链 */
export function createBadlandsProps(seed: number): THREE.Group {
  const g = new THREE.Group();
  const rng = createRng((seed ^ 0xbad5) >>> 0);
  const lampMat = emissiveMat(0xff4020, 2);
  for (let i = 0; i < 40; i++) {
    const ang = range(rng, 0, Math.PI * 2);
    const r = range(rng, 4600, 7000);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const mast = new THREE.Mesh(new THREE.BoxGeometry(4, 90, 4), DARK);
    mast.position.set(x, 45, z);
    g.add(mast);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), lampMat);
    lamp.position.set(x, 92, z);
    g.add(lamp);
  }
  return g;
}
```

- [ ] **Step 4: 实现 src/city/landmarks/index.ts**

```ts
import * as THREE from 'three';
import { LANDMARK_ANCHORS } from '../anchors';
import { createArasakaTower } from './arasaka';
import { createMegabuilding } from './megabuilding';
import {
  createKonpeki, createKabukiDome, createPacificaRuin, createBadlandsProps,
} from './misc';

export function createLandmarks(seed: number): THREE.Group {
  const group = new THREE.Group();
  const byId = new Map(LANDMARK_ANCHORS.map((a) => [a.id, a]));

  const place = (id: string, obj: THREE.Group) => {
    const a = byId.get(id)!;
    obj.position.set(a.x, 0, a.z);
    group.add(obj);
  };

  place('arasaka', createArasakaTower());
  place('megabuilding-h10', createMegabuilding());
  place('konpeki', createKonpeki());
  place('kabuki-dome', createKabukiDome());
  place('pacifica-ruin', createPacificaRuin());

  // 双塔：复用荒坂体量缩放
  const twins = byId.get('corpo-twins')!;
  const twinA = createArasakaTower();
  twinA.scale.setScalar(0.55);
  twinA.position.set(twins.x - 90, 0, twins.z);
  const twinB = createArasakaTower();
  twinB.scale.setScalar(0.45);
  twinB.position.set(twins.x + 90, 0, twins.z + 40);
  group.add(twinA, twinB);

  group.add(createBadlandsProps(seed));
  return group;
}
```

- [ ] **Step 5: 修改 src/main.ts 接入**

```ts
import { createLandmarks } from './city/landmarks/index';

engine.scene.add(createLandmarks(SEED));
```

- [ ] **Step 6: 验证 + Commit**

```bash
npm run build && npm test
git add -A && git commit -m "feat: 荒坂塔/H10 等参数化地标与恶土装置"
```

预期：dev 目视市中心荒坂塔天际线制高点 + 红色光带，Watson 巨构，城外风电灯链。

---

### Task 11: 车流系统（路径采样测试 + 空中/地面车流）

**Files:**
- Create: `src/traffic/lightStream.ts`, `src/traffic/airTraffic.ts`, `src/traffic/groundTraffic.ts`
- Test: `tests/traffic.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 写失败测试 tests/traffic.test.ts（路径几何纯逻辑）**

```ts
import { describe, it, expect } from 'vitest';
import { buildAirCurves } from '../src/traffic/airTraffic';
import { buildRoadCurves } from '../src/traffic/groundTraffic';

describe('buildAirCurves', () => {
  const curves = buildAirCurves(20770703);

  it('至少 5 条闭合环线', () => {
    expect(curves.length).toBeGreaterThanOrEqual(5);
  });

  it('采样点高度在 200~540m 空层内', () => {
    for (const c of curves) {
      for (const p of c.getSpacedPoints(100)) {
        expect(p.y).toBeGreaterThan(200);
        expect(p.y).toBeLessThan(540);
      }
    }
  });

  it('采样连续（相邻点距不超过 260m）', () => {
    for (const c of curves) {
      const pts = c.getSpacedPoints(200);
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i].distanceTo(pts[i - 1])).toBeLessThan(260);
      }
    }
  });
});

describe('buildRoadCurves', () => {
  const curves = buildRoadCurves();

  it('覆盖两个轴向的多条道路', () => {
    expect(curves.length).toBeGreaterThan(20);
  });

  it('全部贴地（y = 3）且在城市半径内', () => {
    for (const c of curves) {
      for (const p of c.getSpacedPoints(10)) {
        expect(p.y).toBeCloseTo(3, 5);
        expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(3401);
      }
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/traffic.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 src/traffic/lightStream.ts**

```ts
import * as THREE from 'three';
import { createRng, range, Rng } from '../core/rng';

export interface StreamDef {
  curve: THREE.Curve<THREE.Vector3>;
  count: number;
  headColor: number;
  tailColor: number;
  speedRange: [number, number]; // 每秒推进的曲线参数比例
}

interface Vehicle {
  curveIdx: number;
  t: number;
  speed: number;
}

const SAMPLES = 512;

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const tmp = new THREE.Vector3();
function sampleAt(pts: THREE.Vector3[], t: number): THREE.Vector3 {
  const f = t * (pts.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  return tmp.copy(pts[i]).lerp(pts[Math.min(i + 1, pts.length - 1)], k);
}

/** 光点车流：每车 2 点（车头亮色 + 车尾红色），单 Points 一次 draw */
export class LightStream {
  points: THREE.Points;
  private vehicles: Vehicle[] = [];
  private samples: THREE.Vector3[][] = [];
  private positions: Float32Array;
  private visibleVehicles: number;

  constructor(defs: StreamDef[], seed: number) {
    const rng: Rng = createRng(seed >>> 0);
    const total = defs.reduce((n, d) => n + d.count, 0);
    this.positions = new Float32Array(total * 2 * 3);
    const colors = new Float32Array(total * 2 * 3);
    const head = new THREE.Color();
    const tail = new THREE.Color();

    let vi = 0;
    defs.forEach((def, ci) => {
      this.samples.push(def.curve.getSpacedPoints(SAMPLES));
      head.setHex(def.headColor);
      tail.setHex(def.tailColor);
      for (let k = 0; k < def.count; k++) {
        this.vehicles.push({
          curveIdx: ci,
          t: rng(),
          speed: range(rng, def.speedRange[0], def.speedRange[1]),
        });
        colors.set([head.r, head.g, head.b], vi * 6);
        colors.set([tail.r, tail.g, tail.b], vi * 6 + 3);
        vi++;
      }
    });
    this.visibleVehicles = this.vehicles.length;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 12,
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** 质量降档：只更新/显示前 fraction 比例的车辆 */
  setDensity(fraction: number): void {
    this.visibleVehicles = Math.floor(this.vehicles.length * fraction);
    this.points.geometry.setDrawRange(0, this.visibleVehicles * 2);
  }

  update(dt: number): void {
    const TAIL_GAP = 0.004;
    for (let i = 0; i < this.visibleVehicles; i++) {
      const v = this.vehicles[i];
      v.t = (v.t + v.speed * dt) % 1;
      const pts = this.samples[v.curveIdx];
      const headPos = sampleAt(pts, v.t);
      this.positions.set([headPos.x, headPos.y, headPos.z], i * 6);
      const tailPos = sampleAt(pts, (v.t - TAIL_GAP + 1) % 1);
      this.positions.set([tailPos.x, tailPos.y, tailPos.z], i * 6 + 3);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute)
      .needsUpdate = true;
  }
}
```

- [ ] **Step 4: 实现 src/traffic/airTraffic.ts**

```ts
import * as THREE from 'three';
import { createRng, range } from '../core/rng';
import { LightStream, StreamDef } from './lightStream';

/** 纯几何、可单测：3 条环线 + 3 条穿城环，全部闭合 CatmullRom */
export function buildAirCurves(seed: number): THREE.CatmullRomCurve3[] {
  const rng = createRng((seed ^ 0xa17) >>> 0);
  const curves: THREE.CatmullRomCurve3[] = [];

  const ring = (radius: number, height: number, reverse: boolean) => {
    const pts: THREE.Vector3[] = [];
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = ((i / n) * Math.PI * 2) * (reverse ? -1 : 1);
      pts.push(new THREE.Vector3(
        Math.cos(a) * radius + range(rng, -40, 40),
        height + range(rng, -18, 18),
        Math.sin(a) * radius + range(rng, -40, 40),
      ));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  };

  curves.push(ring(2700, 260, false));
  curves.push(ring(2000, 380, true));
  curves.push(ring(1200, 460, false));

  // 穿城环：城内随机 6 点闭环
  for (let k = 0; k < 3; k++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      pts.push(new THREE.Vector3(
        range(rng, -2600, 2600),
        range(rng, 300, 460),
        range(rng, -2600, 2600),
      ));
    }
    curves.push(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.4));
  }
  return curves;
}

export function createAirTraffic(seed: number): LightStream {
  const defs: StreamDef[] = buildAirCurves(seed).map((curve, i) => ({
    curve,
    count: 55,
    headColor: i % 2 === 0 ? 0xfff4d8 : 0xd8f4ff,
    tailColor: 0xff3344,
    speedRange: [0.008, 0.02],
  }));
  return new LightStream(defs, (seed ^ 0xa2) >>> 0);
}
```

- [ ] **Step 5: 实现 src/traffic/groundTraffic.ts**

```ts
import * as THREE from 'three';
import { LightStream, StreamDef } from './lightStream';

const ROAD_SPACING = 480;   // 与 layout.ts 对齐
const CITY_RADIUS = 3400;
const LANE_OFFSET = 9;
const ROAD_Y = 3;

/** 纯几何、可单测：路网直线（双轴向、城市圆内截断、双向双车道） */
export function buildRoadCurves(): THREE.LineCurve3[] {
  const curves: THREE.LineCurve3[] = [];
  for (let k = -6; k <= 6; k++) {
    const c = k * ROAD_SPACING;
    if (Math.abs(c) >= CITY_RADIUS) continue;
    const half = Math.sqrt(CITY_RADIUS * CITY_RADIUS - c * c);
    curves.push(new THREE.LineCurve3(
      new THREE.Vector3(c + LANE_OFFSET, ROAD_Y, -half),
      new THREE.Vector3(c + LANE_OFFSET, ROAD_Y, half),
    ));
    curves.push(new THREE.LineCurve3(
      new THREE.Vector3(c - LANE_OFFSET, ROAD_Y, half),
      new THREE.Vector3(c - LANE_OFFSET, ROAD_Y, -half),
    ));
    curves.push(new THREE.LineCurve3(
      new THREE.Vector3(-half, ROAD_Y, c - LANE_OFFSET),
      new THREE.Vector3(half, ROAD_Y, c - LANE_OFFSET),
    ));
    curves.push(new THREE.LineCurve3(
      new THREE.Vector3(half, ROAD_Y, c + LANE_OFFSET),
      new THREE.Vector3(-half, ROAD_Y, c + LANE_OFFSET),
    ));
  }
  return curves;
}

export function createGroundTraffic(seed: number): LightStream {
  const defs: StreamDef[] = buildRoadCurves().map((curve) => ({
    curve,
    count: 26,
    headColor: 0xffffff,
    tailColor: 0xff2010,
    speedRange: [0.01, 0.03],
  }));
  return new LightStream(defs, (seed ^ 0x60) >>> 0);
}
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npx vitest run tests/traffic.test.ts
```

预期：PASS。

- [ ] **Step 7: 修改 src/main.ts 接入**

```ts
import { createAirTraffic } from './traffic/airTraffic';
import { createGroundTraffic } from './traffic/groundTraffic';

const airTraffic = createAirTraffic(SEED);
const groundTraffic = createGroundTraffic(SEED);
engine.scene.add(airTraffic.points, groundTraffic.points);
updatables.push(
  { update: (dt) => airTraffic.update(dt) },
  { update: (dt) => groundTraffic.update(dt) },
);
```

- [ ] **Step 8: 全量验证 + Commit**

```bash
npm run build && npm test
git add -A && git commit -m "feat: 空中 AV 车流与地面路网车流"
```

预期：dev 目视多层空中光点车流穿行楼间、地面路网白/红光带流动。

---

### Task 12: 雨粒子 + 闪电

**Files:**
- Create: `src/atmosphere/rain.ts`, `src/atmosphere/lightning.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 实现 src/atmosphere/rain.ts（GPU 位移，CPU 零更新）**

```ts
import * as THREE from 'three';
import { createRng, range } from '../core/rng';

const COUNT = 45000;
const BOX = { x: 520, y: 380, z: 520 };
const FALL_SPEED = 95;

const VERT = /* glsl */ `
attribute vec3 aOffset;
uniform float uTime;
uniform vec3 uCam;
varying float vAlpha;

const vec3 BOX = vec3(${BOX.x}.0, ${BOX.y}.0, ${BOX.z}.0);

void main() {
  vec3 p;
  p.x = uCam.x + mod(aOffset.x - uCam.x, BOX.x) - BOX.x * 0.5;
  p.z = uCam.z + mod(aOffset.z - uCam.z, BOX.z) - BOX.z * 0.5;
  p.y = uCam.y + mod(aOffset.y - uTime * ${FALL_SPEED}.0 - uCam.y, BOX.y) - BOX.y * 0.5;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vAlpha = smoothstep(${BOX.x}.0 * 0.55, 60.0, dist) * 0.45;
  gl_PointSize = clamp(160.0 / dist, 1.0, 3.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  // 竖向雨丝：横向快速衰减
  vec2 c = gl_PointCoord - 0.5;
  float streak = smoothstep(0.5, 0.0, abs(c.x)) * smoothstep(0.55, 0.1, abs(c.y));
  gl_FragColor = vec4(vec3(0.62, 0.72, 0.86), vAlpha * streak);
}
`;

export interface Rain {
  points: THREE.Points;
  update(dt: number, t: number, cam: THREE.Vector3): void;
  setDensity(fraction: number): void;
}

export function createRain(seed: number): Rain {
  const rng = createRng((seed ^ 0x2a12) >>> 0);
  const offsets = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    offsets.set([
      range(rng, 0, BOX.x),
      range(rng, 0, BOX.y),
      range(rng, 0, BOX.z),
    ], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  // position 必须存在（three 需要）但实际位置全在 shader 里算
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  return {
    points,
    update(_dt: number, t: number, cam: THREE.Vector3) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uCam.value.copy(cam);
    },
    setDensity(fraction: number) {
      geo.setDrawRange(0, Math.floor(COUNT * fraction));
    },
  };
}
```

- [ ] **Step 2: 实现 src/atmosphere/lightning.ts**

```ts
import * as THREE from 'three';
import { createRng, range, Rng } from '../core/rng';
import { Sky } from './sky';

/** 随机闪电：天空闪光 + 月光强度脉冲 */
export class LightningDirector {
  enabled = true;
  private flash = 0;
  private timer: number;
  private rng: Rng;

  constructor(
    private sky: Sky,
    private light: THREE.DirectionalLight,
    private baseIntensity: number,
    seed: number,
  ) {
    this.rng = createRng((seed ^ 0x11d) >>> 0);
    this.timer = range(this.rng, 6, 18);
  }

  update(dt: number): void {
    if (!this.enabled) {
      this.sky.setFlash(0);
      this.light.intensity = this.baseIntensity;
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.flash = range(this.rng, 0.7, 1.2);
      this.timer = range(this.rng, 8, 22);
    }
    this.flash *= Math.exp(-dt * 6);
    this.sky.setFlash(this.flash * 0.8);
    this.light.intensity = this.baseIntensity + this.flash * 3;
  }
}
```

- [ ] **Step 3: 修改 src/main.ts 接入**

```ts
import { createRain } from './atmosphere/rain';
import { LightningDirector } from './atmosphere/lightning';

const rain = createRain(SEED);
engine.scene.add(rain.points);
updatables.push({
  update: (dt, t) => rain.update(dt, t, engine.camera.position),
});

const lightning = new LightningDirector(sky, engine.moonLight, 0.35, SEED);
updatables.push({ update: (dt) => lightning.update(dt) });
```

- [ ] **Step 4: 验证 + Commit**

```bash
npm run build && npm test
git add -A && git commit -m "feat: GPU 雨粒子与闪电调度"
```

预期：dev 目视相机周围雨丝随移动跟随、不见边界；每 8~22 秒天空闪白 + 场景瞬间提亮。

---

### Task 13: 漫游模式 + 模式切换

**Files:**
- Create: `src/controls/walkControls.ts`, `src/controls/modeSwitch.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 实现 src/controls/walkControls.ts**

```ts
import * as THREE from 'three';

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 7;
const SPRINT_MULT = 2.2;

export class WalkControls {
  enabled = false;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - e.movementY * 0.0022, -1.5, 1.5,
      );
    });
  }

  syncFromCamera(): void {
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);

    const fwd = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const speed = WALK_SPEED * (this.keys.has('ShiftLeft') ? SPRINT_MULT : 1);

    // 只在水平面移动
    const dir = new THREE.Vector3(right, 0, -fwd);
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(speed * dt);

    const p = this.camera.position;
    p.add(dir);
    p.y = EYE_HEIGHT;
    const r = Math.hypot(p.x, p.z);
    if (r > 5600) {
      const k = 5600 / r;
      p.x *= k;
      p.z *= k;
    }
  }
}
```

- [ ] **Step 2: 实现 src/controls/modeSwitch.ts**

```ts
import * as THREE from 'three';
import { FlyControls } from './flyControls';
import { WalkControls } from './walkControls';

export type Mode = 'fly' | 'walk';

const TRANSITION_SEC = 1.4;
const EYE_HEIGHT = 1.7;
const TAKEOFF_HEIGHT = 280;

function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

export class ModeManager {
  mode: Mode = 'fly';
  private remaining = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private target: Mode = 'fly';
  private listeners: Array<(m: Mode) => void> = [];

  constructor(
    private camera: THREE.PerspectiveCamera,
    private fly: FlyControls,
    private walk: WalkControls,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF') this.toggle();
    });
  }

  onChange(fn: (m: Mode) => void): void {
    this.listeners.push(fn);
  }

  get transitioning(): boolean {
    return this.remaining > 0;
  }

  toggle(): void {
    if (this.transitioning) return;
    this.from.copy(this.camera.position);
    if (this.mode === 'fly') {
      this.target = 'walk';
      this.to.set(this.from.x, EYE_HEIGHT, this.from.z);
    } else {
      this.target = 'fly';
      this.to.set(this.from.x, TAKEOFF_HEIGHT, this.from.z);
    }
    this.fly.enabled = false;
    this.walk.enabled = false;
    this.remaining = TRANSITION_SEC;
  }

  update(dt: number): void {
    if (!this.transitioning) return;
    this.remaining = Math.max(0, this.remaining - dt);
    const k = smooth(1 - this.remaining / TRANSITION_SEC);
    this.camera.position.lerpVectors(this.from, this.to, k);
    if (this.remaining === 0) {
      this.mode = this.target;
      if (this.mode === 'walk') {
        this.walk.syncFromCamera();
        this.walk.enabled = true;
      } else {
        this.fly.syncFromCamera();
        this.fly.enabled = true;
      }
      for (const fn of this.listeners) fn(this.mode);
    }
  }
}
```

- [ ] **Step 3: 修改 src/main.ts 接入**

在 FlyControls 创建之后补充：

```ts
import { WalkControls } from './controls/walkControls';
import { ModeManager } from './controls/modeSwitch';

const walk = new WalkControls(engine.camera, canvas);
const modes = new ModeManager(engine.camera, fly, walk);
updatables.push(
  { update: (dt) => walk.update(dt) },
  { update: (dt) => modes.update(dt) },
);
```

- [ ] **Step 4: 验证 + Commit**

```bash
npm run build && npm test
git add -A && git commit -m "feat: 第一人称漫游与飞行/漫游模式切换"
```

预期：dev 中按 F 平滑降落到街道，1.7m 视高走动感受楼群尺度，再按 F 升空。

---

### Task 14: HUD + 启动画面

**Files:**
- Create: `src/ui/hud.ts`, `src/ui/boot.ts`
- Modify: `src/styles.css`（追加 HUD/启动样式）、`src/main.ts`（启动流程重组）

- [ ] **Step 1: 实现 src/ui/hud.ts**

```ts
import * as THREE from 'three';
import { districtAt, BADLANDS_LABEL } from '../city/districts';
import type { Mode } from '../controls/modeSwitch';

const TYPE_INTERVAL = 0.045;
const SCRAMBLE = '█▓▒░<>/\\|=+*';

export class Hud {
  private root: HTMLDivElement;
  private districtEl: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private keysEl: HTMLDivElement;
  private current = '';
  private reveal = 0;
  private typeTimer = 0;
  private pollTimer = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fpsText = '--';

  constructor(overlay: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-district"></div>
      <div class="hud-keys"></div>
      <div class="hud-stats"></div>
    `;
    overlay.appendChild(this.root);
    this.districtEl = this.root.querySelector('.hud-district')!;
    this.keysEl = this.root.querySelector('.hud-keys')!;
    this.statsEl = this.root.querySelector('.hud-stats')!;
    this.setMode('fly');
  }

  setMode(mode: Mode): void {
    this.keysEl.textContent = mode === 'fly'
      ? 'WASD 移动 · QE 升降 · SHIFT 加速 · F 降落 · 点击画面锁定视角'
      : 'WASD 行走 · SHIFT 疾跑 · F 起飞 · 点击画面锁定视角';
  }

  setQualityName(name: string): void {
    this.statsEl.dataset.quality = name;
  }

  update(dt: number, cam: THREE.Vector3): void {
    // FPS 统计
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fpsText = String(Math.round(this.fpsFrames / this.fpsAcc));
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.statsEl.textContent =
      `FPS ${this.fpsText} · ${this.statsEl.dataset.quality ?? 'ULTRA'}`;

    // 区域轮询
    this.pollTimer -= dt;
    if (this.pollTimer <= 0) {
      this.pollTimer = 0.4;
      const label = districtAt(cam.x, cam.z)?.style.label ?? BADLANDS_LABEL;
      if (label !== this.current) {
        this.current = label;
        this.reveal = 0;
      }
    }

    // 打字机 + 扰码
    if (this.reveal < this.current.length) {
      this.typeTimer -= dt;
      if (this.typeTimer <= 0) {
        this.typeTimer = TYPE_INTERVAL;
        this.reveal++;
        const done = this.current.slice(0, this.reveal);
        const noise = this.reveal < this.current.length
          ? SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]
          : '';
        this.districtEl.textContent = done + noise;
      }
    }
  }
}
```

- [ ] **Step 2: 实现 src/ui/boot.ts**

```ts
const FRAME_WAIT = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class BootScreen {
  private root: HTMLDivElement;
  private barEl: HTMLDivElement;
  private labelEl: HTMLDivElement;
  private button: HTMLButtonElement;
  private done = 0;

  constructor(overlay: HTMLElement, private totalSteps: number) {
    this.root = document.createElement('div');
    this.root.className = 'boot';
    this.root.innerHTML = `
      <div class="boot-title" data-text="NIGHT CITY">NIGHT CITY</div>
      <div class="boot-sub">夜之城 // 全尺寸重建 · 非官方粉丝作品</div>
      <div class="boot-bar"><div class="boot-bar-fill"></div></div>
      <div class="boot-label">INITIALIZING…</div>
      <button class="boot-start" disabled>JACK IN</button>
    `;
    overlay.appendChild(this.root);
    this.barEl = this.root.querySelector('.boot-bar-fill')!;
    this.labelEl = this.root.querySelector('.boot-label')!;
    this.button = this.root.querySelector('.boot-start')!;
  }

  /** 执行一个生成步骤并推进进度条（每步之间让出两帧渲染进度） */
  async step<T>(label: string, fn: () => T): Promise<T> {
    this.labelEl.textContent = label;
    await FRAME_WAIT();
    await FRAME_WAIT();
    const result = fn();
    this.done++;
    this.barEl.style.width = `${(this.done / this.totalSteps) * 100}%`;
    return result;
  }

  waitForStart(): Promise<void> {
    this.labelEl.textContent = 'READY';
    this.button.disabled = false;
    return new Promise((resolve) => {
      this.button.addEventListener('click', () => {
        this.root.classList.add('boot-out');
        setTimeout(() => this.root.remove(), 700);
        resolve();
      }, { once: true });
    });
  }
}
```

- [ ] **Step 3: src/styles.css 追加 HUD/启动样式**

```css
/* ---------- HUD ---------- */
.hud-district {
  position: absolute;
  top: clamp(18px, 4vh, 44px);
  left: clamp(18px, 4vw, 56px);
  color: var(--color-hud);
  font-size: clamp(20px, 2.6vw, 38px);
  font-weight: 700;
  letter-spacing: 0.18em;
  text-shadow: 0 0 12px rgba(252, 238, 10, 0.45);
}

.hud-keys {
  position: absolute;
  bottom: 20px;
  left: 20px;
  color: var(--color-hud-dim);
  font-size: 12px;
  letter-spacing: 0.08em;
}

.hud-stats {
  position: absolute;
  bottom: 20px;
  right: 20px;
  color: var(--color-accent);
  font-size: 12px;
  letter-spacing: 0.1em;
}

/* ---------- 启动画面 ---------- */
.boot {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: var(--color-bg);
  pointer-events: auto;
  transition: opacity 0.7s ease;
}

.boot-out { opacity: 0; pointer-events: none; }

.boot-title {
  position: relative;
  color: var(--color-hud);
  font-size: clamp(42px, 8vw, 96px);
  font-weight: 800;
  letter-spacing: 0.22em;
  animation: boot-flicker 3.2s infinite;
}

.boot-title::before {
  content: attr(data-text);
  position: absolute;
  left: 2px;
  top: 0;
  color: var(--color-accent);
  clip-path: inset(28% 0 52% 0);
  animation: boot-glitch 2.1s infinite steps(1);
  opacity: 0.75;
}

.boot-sub { color: var(--color-hud-dim); font-size: 13px; letter-spacing: 0.3em; }

.boot-bar {
  width: min(420px, 70vw);
  height: 4px;
  border: 1px solid var(--color-hud-dim);
}

.boot-bar-fill {
  width: 0%;
  height: 100%;
  background: var(--color-hud);
  transition: width 0.25s ease;
}

.boot-label { color: var(--color-accent); font-size: 12px; letter-spacing: 0.24em; }

.boot-start {
  margin-top: 10px;
  padding: 12px 46px;
  background: transparent;
  border: 1px solid var(--color-hud);
  color: var(--color-hud);
  font-family: var(--font-mono);
  font-size: 16px;
  letter-spacing: 0.3em;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, opacity 0.2s;
}

.boot-start:disabled { opacity: 0.3; cursor: wait; }

.boot-start:not(:disabled):hover {
  background: var(--color-hud);
  color: var(--color-bg);
  box-shadow: 0 0 24px rgba(252, 238, 10, 0.5);
}

@keyframes boot-flicker {
  0%, 92%, 100% { opacity: 1; }
  93% { opacity: 0.4; }
  94% { opacity: 1; }
  97% { opacity: 0.6; }
}

@keyframes boot-glitch {
  0%, 78%, 100% { transform: translateX(0); clip-path: inset(28% 0 52% 0); }
  80% { transform: translateX(-6px); clip-path: inset(10% 0 70% 0); }
  86% { transform: translateX(5px); clip-path: inset(60% 0 18% 0); }
  92% { transform: translateX(-3px); clip-path: inset(40% 0 40% 0); }
}
```

- [ ] **Step 4: 重组 src/main.ts 启动流程（完整替换为最终形态）**

```ts
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

  await boot.step('注入车流 // SPAWNING TRAFFIC', () => {
    const air = createAirTraffic(SEED);
    const groundT = createGroundTraffic(SEED);
    engine.scene.add(air.points, groundT.points);
    updatables.push(
      { update: (dt) => air.update(dt) },
      { update: (dt) => groundT.update(dt) },
    );
  });

  await boot.step('召唤雨云 // SEEDING RAIN', () => {
    const rain = createRain(SEED);
    engine.scene.add(rain.points);
    updatables.push({
      update: (dt, t) => rain.update(dt, t, engine.camera.position),
    });
    const lightning = new LightningDirector(sky, engine.moonLight, 0.35, SEED);
    updatables.push({ update: (dt) => lightning.update(dt) });
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

  await boot.waitForStart();

  const clock = new THREE.Clock();
  function loop(): void {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    for (const u of updatables) u.update(dt, t);
    engine.render(dt);
  }
  loop();
}

void start();
```

- [ ] **Step 5: 验证 + Commit**

```bash
npm run build && npm test
git add -A && git commit -m "feat: HUD 区域名打字机与 glitch 启动画面"
```

预期：dev 打开先见 glitch 标题 + 分步进度条，JACK IN 后入城；左上角区域名随位置切换并打字机滚动；左下按键提示随模式变化；右下 FPS。

---

### Task 15: 质量档位（TDD）+ WebGL2 守卫 + 错误覆盖层

**Files:**
- Create: `src/core/quality.ts`
- Test: `tests/quality.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 写失败测试 tests/quality.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { QualityMonitor, QUALITY_PRESETS } from '../src/core/quality';

/** 连续喂 seconds 秒、恒定 fps 的帧 */
function feed(m: QualityMonitor, fps: number, seconds: number): boolean[] {
  const dt = 1 / fps;
  const results: boolean[] = [];
  for (let i = 0; i < Math.ceil(seconds * fps); i++) results.push(m.addFrame(dt));
  return results;
}

describe('QUALITY_PRESETS', () => {
  it('三档且各参数单调不升', () => {
    expect(QUALITY_PRESETS.map((p) => p.name)).toEqual(['ULTRA', 'HIGH', 'LOW']);
    for (let i = 1; i < QUALITY_PRESETS.length; i++) {
      expect(QUALITY_PRESETS[i].renderScale).toBeLessThanOrEqual(QUALITY_PRESETS[i - 1].renderScale);
      expect(QUALITY_PRESETS[i].rainScale).toBeLessThanOrEqual(QUALITY_PRESETS[i - 1].rainScale);
      expect(QUALITY_PRESETS[i].trafficScale).toBeLessThanOrEqual(QUALITY_PRESETS[i - 1].trafficScale);
    }
  });
});

describe('QualityMonitor', () => {
  it('低帧率满窗口后建议降档一次', () => {
    const m = new QualityMonitor(3, 45);
    const results = feed(m, 30, 3.2);
    expect(results.filter(Boolean).length).toBe(1);
    expect(m.level).toBe(1);
  });

  it('高帧率不降档', () => {
    const m = new QualityMonitor(3, 45);
    const results = feed(m, 60, 10);
    expect(results.every((r) => !r)).toBe(true);
    expect(m.level).toBe(0);
  });

  it('持续低帧率最多降到 LOW 档为止', () => {
    const m = new QualityMonitor(3, 45);
    feed(m, 20, 30);
    expect(m.level).toBe(QUALITY_PRESETS.length - 1);
  });

  it('锁定后不再降档', () => {
    const m = new QualityMonitor(3, 45);
    m.lock();
    const results = feed(m, 15, 10);
    expect(results.every((r) => !r)).toBe(true);
    expect(m.level).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/quality.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 src/core/quality.ts**

```ts
export interface QualityParams {
  name: 'ULTRA' | 'HIGH' | 'LOW';
  renderScale: number;
  rainScale: number;
  trafficScale: number;
  bloomIntensity: number;
  chromatic: boolean;
  lightning: boolean;
}

export const QUALITY_PRESETS: QualityParams[] = [
  {
    name: 'ULTRA', renderScale: 1.0, rainScale: 1.0, trafficScale: 1.0,
    bloomIntensity: 1.15, chromatic: true, lightning: true,
  },
  {
    name: 'HIGH', renderScale: 0.85, rainScale: 0.6, trafficScale: 0.6,
    bloomIntensity: 1.0, chromatic: false, lightning: true,
  },
  {
    name: 'LOW', renderScale: 0.7, rainScale: 0.3, trafficScale: 0.3,
    bloomIntensity: 0.55, chromatic: false, lightning: false,
  },
];

/** 按窗口统计 FPS，低于阈值时建议降档（每窗口至多一次） */
export class QualityMonitor {
  level = 0;
  locked = false;
  private acc = 0;
  private frames = 0;

  constructor(
    private windowSec = 3,
    private minFps = 45,
  ) {}

  lock(): void {
    this.locked = true;
  }

  /** 返回 true 表示本帧触发了降档，调用方应用 QUALITY_PRESETS[level] */
  addFrame(dt: number): boolean {
    if (this.locked || this.level >= QUALITY_PRESETS.length - 1) return false;
    this.acc += dt;
    this.frames++;
    if (this.acc < this.windowSec) return false;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (fps < this.minFps) {
      this.level++;
      return true;
    }
    return false;
  }
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/quality.test.ts
```

预期：PASS。

- [ ] **Step 5: 修改 src/main.ts —— WebGL2 守卫、质量应用、单帧容错**

`start()` 顶部（获取 canvas 之后）插入 WebGL2 守卫：

```ts
  if (!document.createElement('canvas').getContext('webgl2')) {
    overlay.innerHTML = `
      <div class="fatal">
        <div class="fatal-title">// SIGNAL LOST</div>
        <div class="fatal-body">此浏览器不支持 WebGL2。请使用最新版 Chrome / Edge / Safari / Firefox。</div>
      </div>`;
    overlay.style.pointerEvents = 'auto';
    return;
  }
```

车流/雨的创建段落改为保留引用（`air`、`groundT`、`rain` 提升到 `start()` 作用域），主循环前接入质量监控：

```ts
import { QualityMonitor, QUALITY_PRESETS } from './core/quality';

  const monitor = new QualityMonitor();
  const applyQuality = () => {
    const q = QUALITY_PRESETS[monitor.level];
    engine.setRenderScale(q.renderScale);
    engine.bloom.intensity = q.bloomIntensity;
    engine.chromatic.blendMode.setBlendFunction(
      q.chromatic ? BlendFunction.NORMAL : BlendFunction.SKIP,
    );
    rain.setDensity(q.rainScale);
    air.setDensity(q.trafficScale);
    groundT.setDensity(q.trafficScale);
    lightning.enabled = q.lightning;
    hud.setQualityName(q.name);
  };
  applyQuality();
```

（顶部补 `import { BlendFunction } from 'postprocessing';`；`lightning` 同样提升到 `start()` 作用域。）

主循环加入监控与单帧容错：

```ts
  let frameErrors = 0;
  function loop(): void {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    try {
      for (const u of updatables) u.update(dt, t);
      if (monitor.addFrame(dt)) applyQuality();
      engine.render(dt);
      frameErrors = 0;
    } catch (err) {
      frameErrors++;
      console.error('[night-city] frame error', err);
      if (frameErrors > 30) {
        overlay.innerHTML = `
          <div class="fatal">
            <div class="fatal-title">// FLATLINED</div>
            <div class="fatal-body">渲染循环连续出错，请刷新页面。详情见控制台。</div>
          </div>`;
        overlay.style.pointerEvents = 'auto';
        throw err;
      }
    }
  }
```

`src/styles.css` 追加：

```css
.fatal {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: var(--color-bg);
}

.fatal-title { color: #ff2975; font-size: 28px; letter-spacing: 0.3em; }

.fatal-body { color: var(--color-hud-dim); font-size: 14px; }
```

- [ ] **Step 6: 全量验证 + Commit**

```bash
npm run build && npm test
git add -A && git commit -m "feat: 质量三档自动降级、WebGL2 守卫与帧级容错"
```

---

### Task 16: Playwright 视觉验证 + README

**Files:**
- Create: `playwright.config.ts`, `e2e/visual.spec.ts`, `README.md`
- Modify: `package.json`（无需改动，`e2e` 脚本已就位）

- [ ] **Step 1: 安装 Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: 创建 playwright.config.ts**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-1920', use: { viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

- [ ] **Step 3: 创建 e2e/visual.spec.ts**

```ts
import { test, expect, Page } from '@playwright/test';

async function jackIn(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto('/');
  const start = page.locator('.boot-start');
  await expect(start).toBeEnabled({ timeout: 90_000 });
  await start.click();
  await page.waitForTimeout(4000); // 等待首批帧稳定
  return errors;
}

test('飞行模式首帧渲染且无页面错误', async ({ page }, testInfo) => {
  const errors = await jackIn(page);
  await expect(page.locator('#scene')).toBeVisible();
  await expect(page.locator('.hud-district')).not.toBeEmpty();
  await page.screenshot({
    path: testInfo.outputPath('fly-mode.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('切换漫游模式后正常渲染', async ({ page }, testInfo) => {
  const errors = await jackIn(page);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(2500); // 降落过渡完成
  await page.screenshot({
    path: testInfo.outputPath('walk-mode.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
```

- [ ] **Step 4: 运行 E2E**

```bash
npm run e2e
```

预期：2 用例 × 2 视口全部 PASS，`test-results/` 下产出 fly-mode / walk-mode 截图。人工查看截图确认：城市天际线成型、霓虹辉光、HUD 文字正常。

- [ ] **Step 5: 创建 README.md**

```markdown
# Night City Web

浏览器里的全尺寸夜之城 —— 原生 Three.js 程序化生成的 Cyberpunk 2077 风格致敬作品（非官方粉丝项目，无任何游戏资产提取）。

## 特性

- 复刻官方地图布局：六大区 + 恶土，荒坂塔 / Megabuilding H10 等参数化地标
- 万栋级 InstancedMesh 楼群，窗格发光 shader，全城楼体 5 个 draw call
- 动态霓虹招牌图集 + 全息广告、空中 AV 车流、地面车流光带
- 雨夜氛围：GPU 雨粒子、指数雾、随机闪电
- 飞行（WASD/QE/Shift）+ 第一人称漫游（F 键降落）双模式
- Bloom / ACES / 暗角后处理，ULTRA→HIGH→LOW 三档自动降级

## 开发

​```bash
npm install
npm run dev        # 开发服务器
npm test           # Vitest 单元测试（生成逻辑）
npm run e2e        # Playwright 视觉验证
npm run build      # 生产构建
​```

## 操作

| 按键 | 功能 |
|---|---|
| 点击画面 | 锁定鼠标视角 |
| WASD | 移动 |
| Q / E | 下降 / 上升（飞行模式） |
| Shift | 加速 / 疾跑 |
| F | 降落 / 起飞（切换模式） |
```

（注意：README 中的代码围栏使用零宽空格转义仅为本计划文档展示，落盘时写正常的三反引号。）

- [ ] **Step 6: 最终回归 + Commit**

```bash
npm run build && npm test && npm run e2e
git add -A && git commit -m "test: Playwright 视觉验证与 README"
```

---

## 自审记录（写完计划后核对 spec）

- **Spec 覆盖**：§2 技术选型→Task 1/8；§4 城市数据→Task 3/5/6；§4.4 地标→Task 10；§5 动态元素→Task 9/11/12；§6 渲染性能/三档→Task 8/15；§7 交互 HUD→Task 4/13/14；§8 错误处理→Task 15；§9 测试→Task 2/3/5/11/15/16；§10 里程碑与任务顺序一致。无遗漏。
- **规模差异说明**：spec 提到楼群 3–5 万栋，本计划初始参数产出约 1–2 万栋（测试下限 8000）；如需加密只调 `cellSize`/`density`，属视觉调优不改结构。
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性**：`Plot{x,z,sx,sz,h,district,kind,litRate}`、`Updatable{update(dt,t)}`、`LightStream.setDensity(fraction)`、`Engine{bloom,chromatic,moonLight,setRenderScale}` 等签名已跨任务核对一致。
