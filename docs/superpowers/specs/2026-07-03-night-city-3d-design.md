# Night City Web — 浏览器全尺寸夜之城 设计文档

**日期**: 2026-07-03
**状态**: 已批准
**项目路径**: `/Users/s045pd/workobj/Earn/cyberpunk`

## 1. 目标

用前端 3D（原生 Three.js）在浏览器中构建一座 Cyberpunk 2077 风格的"全尺寸"夜之城：

- **复刻官方地图布局**：六大区（Watson、Westbrook、City Center、Heywood、Santo Domingo、Pacifica）+ 恶土（Badlands），地标建筑低模复刻，其余楼群程序化生成填充。
- **双模式交互**：自由飞行俯瞰全城 + 一键降落第一人称街道漫游。
- **动态生命力**：空中飞行车流、动态霓虹/全息广告、地面车流、雨夜天气氛围 —— 全部包含。
- **桌面优先，效果拉满**：Apple Silicon / 主流独显 60fps，低端设备自动降级。

**非目标**（YAGNI）：
- 不做游戏玩法（任务、NPC、战斗）。
- 不做楼体精确碰撞（漫游模式仅贴地移动，可穿过楼体）。
- 不提取任何游戏资产 —— 全程序化生成，纯风格致敬的粉丝作品。
- 不做移动端触控优化（能打开即可，不保证体验）。

## 2. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 渲染 | Three.js（原生，最新版） | 无框架协调层开销；InstancedMesh 生态与自定义 shader 灵活性最佳 |
| 构建 | Vite + TypeScript | 快速、零配置、类型安全 |
| 后处理 | `postprocessing`（pmndrs） | Bloom 质量与性能优于 three 自带 examples；可组合 |
| UI | 轻量 DOM + CSS | HUD 需求极少，不引入框架 |
| 单元测试 | Vitest | 与 Vite 同生态 |
| 视觉验证 | Playwright 截图 | 关键模式与分辨率的回归验证 |

**候选方案与否决理由**：
- React Three Fiber：声明式组件好维护，但本项目 UI 极少、纯性能场景，协调层是净开销 → 否决。
- Babylon.js / PlayCanvas：引擎化工作流，但包体大、赛博朋克风自定义 shader 生态不如 three → 否决。

## 3. 模块结构

```
src/
├── main.ts                  # 启动、主循环、resize
├── core/
│   ├── engine.ts            # renderer / scene / camera / composer 组装
│   ├── quality.ts           # 质量档位（Ultra/High/Low）检测、切换、自动降档
│   └── rng.ts               # 可播种伪随机（城市生成确定性，便于测试）
├── city/
│   ├── districts.ts         # 区域多边形数据 + 点归属判定（纯数据/纯函数）
│   ├── layout.ts            # 路网生成、地块划分（纯函数）
│   ├── buildings.ts         # 楼群实例化生成（InstancedMesh + 窗格发光 shader）
│   ├── landmarks/           # 参数化地标：arasaka.ts、megabuilding.ts、konpeki.ts 等
│   ├── neon.ts              # 霓虹招牌/全息广告（canvas 纹理图集 + shader 动画）
│   └── ground.ts            # 地面、道路发光网格、湿面反射
├── traffic/
│   ├── airTraffic.ts        # 空中 AV 车流（Catmull-Rom 路径 + instanced + 拖尾）
│   └── groundTraffic.ts     # 地面车流光带（沿路网曲线的流动光点）
├── atmosphere/
│   ├── rain.ts              # GPU 雨粒子（shader 位移，非 CPU 更新）
│   ├── fog.ts               # 高度雾 + 远景雾裁剪
│   └── sky.ts               # 夜空穹顶、云层剪影、偶发闪电
├── controls/
│   ├── flyControls.ts       # 飞行：WASD + QE 升降 + 鼠标视角 + Shift 加速
│   ├── walkControls.ts      # 漫游：pointer-lock 第一人称贴地
│   └── modeSwitch.ts        # F 键切换 + 降落/起飞过渡动画
└── ui/
    ├── hud.ts               # 区域名打字机动画、按键提示、FPS/档位
    └── boot.ts              # glitch 风格启动画面 + 生成进度条
```

设计原则：**生成逻辑（纯函数、可测）与渲染（Three 对象）分离**。`districts.ts`、`layout.ts` 及楼群参数计算不 import three 的渲染对象，只产出数据；渲染模块消费数据。

## 4. 城市数据与生成

### 4.1 坐标与尺度

- 场景空间约 **8000 × 8000 单位**（1 单位 ≈ 1 米），对应夜之城市区实际尺度。
- 官方地图描点为归一化 `[0,1]²` 多边形，加载时映射到场景坐标。

### 4.2 区域风格参数表

每区一份 `DistrictStyle`：楼高分布（min/max/幂次偏态）、地块密度、基色/霓虹色板、霓虹密度、窗亮率。

| 区域 | 特征 |
|---|---|
| City Center | 200–450m 冷色玻璃超高层，荒坂塔所在，霓虹冷蓝/金 |
| Watson | 密集中高层，Kabuki 霓虹密度全城最高，红/粉/青 |
| Westbrook | 豪华高层 + Japantown 粉紫色调 |
| Heywood | 中层住宅带，暖黄窗光 |
| Santo Domingo | 工业厂房、电厂烟囱、橙色钠灯 |
| Pacifica | 低层烂尾楼，窗亮率最低、霓虹稀疏，整体最暗 |
| Badlands | 城外荒漠：风电阵列、输电塔、稀疏灯点 |

### 4.3 楼群

- 总量 3–5 万栋（Ultra 档），十余种参数化基础形体：直筒、阶梯塔、顶部天线/水塔/直升机坪、悬挑平台等。
- 每种形体一个 `InstancedMesh`，全城楼体 draw call ≤ 20。
- 自定义 `onBeforeCompile` / ShaderMaterial 注入**程序化窗格发光**：按实例随机窗亮率、少量闪烁；emissive 进 bloom。

### 4.4 地标（6–8 个参数化建模）

荒坂塔（双塔阶梯金字塔 + 顶部红光）、Megabuilding H10（巨型梯形体量）、Konpeki Plaza、Kabuki 市场穹顶、Pacifica 大酒店废墟、市中心 corpo 塔群若干。地标是空间锚点，保证"这就是夜之城"的辨识度。

## 5. 动态元素

- **霓虹/全息广告**：启动时 canvas 生成招牌纹理图集（日/中/英文文案、边框样式），quad 贴楼面；shader 做滚动、闪烁、色相循环；数个大型全息投影（旋转 billboard 锥体/人形剪影）。
- **空中车流**：3–4 个高度层的环城/穿城 Catmull-Rom 路径，instanced 飞行器沿路径匀速移动，前白后红光点 + 拖尾。
- **地面车流**：沿主干路网的流动光带（instanced 光点，双向白/红）。
- **雨夜氛围**：GPU 雨粒子（顶点 shader 循环下落，相机跟随域）、`FogExp2` + 自定义高度雾、地面湿润高反射（粗糙度贴图技巧，不做实时平面反射——性能优先）、随机闪电（短暂全局光脉冲）。

## 6. 渲染与性能

- **后处理链**：Bloom（霓虹辉光核心）→ Vignette → 轻微色差；ACES tone mapping。
- **性能预算**：Ultra 档全场景 draw call ≤ 100；楼群实例化、几何合并、纹理图集。
- **质量三档**：
  - Ultra：全效果、renderScale 1.0、雨粒子 100%、车流 100%
  - High：renderScale 0.85、粒子/车流 60%、色差关
  - Low：renderScale 0.7、bloom 半强度、粒子/车流 30%、闪电关
- 首帧后 3 秒采样 FPS，低于 45 自动降一档（可手动锁定）。
- WebGL2 不可用 → 显示纯 DOM 提示页。

## 7. 交互与 UI

- **飞行模式**（默认）：WASD 平移、QE 升降、鼠标视角（pointer lock 或拖拽）、Shift ×4 加速；限高与边界软约束。
- **漫游模式**：按 F 从当前位置降落至地面（相机过渡动画），pointer-lock 第一人称，视线高度 1.7m，仅贴地移动；再按 F 起飞。
- **HUD**：进入新区域时打字机动画显示 `WATSON — KABUKI` 式区域名；左下按键提示；右下 FPS + 档位。CP2077 风格黄黑配色 + glitch 效果。
- **启动画面**：glitch logo + 城市生成进度条（生成分帧执行避免卡死主线程）。

## 8. 错误处理

- WebGL2 检测失败 → 提示页（含浏览器建议）。
- 全资产程序化生成，无网络资源加载失败路径；webfont 失败回退系统等宽字体。
- 主循环 try/catch 包裹单帧可恢复错误，连续错误 > N 次显示错误覆盖层而非白屏。

## 9. 测试策略

- **Vitest 单元测试**（生成逻辑纯函数）：
  - point-in-polygon 区域归属判定（含边界点）
  - 楼群参数分布（播种 RNG 确定性、楼高在区域范围内、地块不重叠）
  - 车流路径采样连续性
  - 质量档位状态机（降档/锁定逻辑）
- **Playwright 视觉验证**：启动完成后飞行模式首帧、切换漫游模式后截图；1440×900 与 1920×1080。
- 覆盖率目标：生成逻辑模块 80%+；渲染胶水代码以视觉验证为主。

## 10. 里程碑（供实现计划参考）

1. 工程骨架 + 引擎核心 + 飞行相机（能飞的空场景）
2. 区域数据 + 楼群生成（灰盒城市成型）
3. 窗格发光 + 霓虹 + bloom（夜之城点亮）
4. 地标建筑（辨识度）
5. 车流 + 雨夜氛围（活起来）
6. 漫游模式 + HUD + 启动画面（完整体验）
7. 质量档位 + 测试补全 + 打磨
