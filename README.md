# Night City Web

浏览器里的全尺寸夜之城 —— 原生 Three.js 程序化生成的 Cyberpunk 2077 风格致敬作品（非官方粉丝项目，无任何游戏资产提取）。

## 特性

- 复刻官方地图布局：六大区 + 恶土，荒坂塔 / Megabuilding H10 等参数化地标
- 万栋级 InstancedMesh 楼群，窗格发光 shader，全城楼体 5 个 draw call
- 动态霓虹招牌图集 + 竖向巨幕 + 全息广告；真实车体车流（轿车/厢货/跑车/飞行 AV，分区发光：头灯/尾灯/氛围底光/推进器），覆盖地面路网与高架环线
- 雨夜氛围：GPU 雨粒子、指数雾、随机闪电
- 城市生命：约 2500 名行人（男女老幼、步态动画）、NCPD 巡逻与犯罪现场（警戒线/警车爆闪）、创伤小队救援 AV 循环事件、沿街商贩摊位
- 西侧 Del Coronado 湾水体（波光 + 城市倒影），26 栋可进入建筑（发光门洞大堂 + 漫游碰撞）
- 飞行（WASD/QE/Shift）+ 第一人称漫游（F 键降落）双模式
- Bloom / ACES / 暗角后处理，ULTRA→HIGH→LOW 三档自动降级

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # Vitest 单元测试（生成逻辑）
npm run e2e        # Playwright 视觉验证
npm run build      # 生产构建
```

## 操作

| 按键 | 功能 |
|---|---|
| 点击画面 | 锁定鼠标视角 |
| WASD | 移动 |
| Q / E | 下降 / 上升（飞行模式） |
| Shift | 加速 / 疾跑 |
| F | 降落 / 起飞（切换模式） |

## 架构速览

- `src/city/` —— 城市数据与生成（districts 区域多边形 → layout 地块 → buildings/neon/landmarks 渲染）
- `src/traffic/` —— 光点车流系统（曲线采样 + Points）
- `src/atmosphere/` —— 夜空 / 雨 / 闪电
- `src/controls/` —— 飞行、漫游与模式切换
- `src/core/` —— 引擎组装、可播种随机、质量档位
- 生成逻辑为纯函数（可单测），渲染层只消费数据
