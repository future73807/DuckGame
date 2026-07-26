# 小黄鸭漂流记：JS/CSS 模块化拆分与代码重构计划

状态：计划文档，**不包含任何游戏功能改动**。
对应低优先级 TODO：`readme.md` 中的“JS/CSS 模块化拆分”和“代码模块化重构”。

## 1. 目标与边界

目标不是重写游戏，而是在不改变玩法、画面和现有接口的前提下，把单个 `3d-duck.html` 渐进拆成易维护的 CSS 与浏览器原生 ES Module。

必须保持：

- 入口仍是 `3d-duck.html`，现有访问地址和 `npm start` 不变。
- 单人、双人、排行榜、祝福、成就、分享卡、移动端与画质档位行为不变。
- DOM 的 `id`、`class`、`localStorage` key、API 路径和 `leaderboard.json` 数据结构不变。
- 每一步都可独立运行、独立验收、独立回退。

本轮明确不做：

- 不引入 React、Vue、TypeScript、Vite 或新的构建链。
- 不顺手重做游戏玩法、UI 风格、网络协议或数据结构。
- 不把所有全局状态一次性改成大 Store，也不在首轮拆分 `server.node.js`。
- 不把缓存、断线重连、排行榜并发写入混进首轮重构；它们是后续独立事项。

## 2. 当前结构与主要风险

当前快照（`3d-duck.html` 总体积约 583 KB）：

| 区域 | 当前位置 | 体积 | 重构含义 |
| --- | --- | --- | --- |
| favicon SVG | 第 8 行 `<link rel="icon" href="data:image/svg+xml,...">` | ~2 KB | 外置为 `assets/favicon.svg`，HTML 改为外部引用。 |
| GLB 3D 模型 | 第 3236 行 base64 字符串 | ~157 KB | base64 解码后外置为 `assets/duck.glb`，体积可减小约 25%。 |
| 分享卡 duckSVG | 第 4705 行内联模板字符串 | ~2 KB | 外置为 `assets/duck-share.svg`，运行时 `fetch` 加载。 |
| CSS | `3d-duck.html` 第 10–712 行 | ~26 KB | 先原样外置，不能同时改选择器和布局。 |
| 静态 HTML | 第 714–1056 行 | — | 保留为页面壳；首轮不改 DOM 结构。 |
| 前端主模块 | 第 1072 行起 | ~395 KB | Three.js 场景、玩法、UI、网络和持久化均在同一个模块中。 |
| 服务端 | `server.node.js` | — | 兼容本地 Node 与云函数入口，首轮只确保新静态文件可访问。 |
| 静态检查 | `_check.js` | — | 目前只解析内联 module，外置 JS 后必须先升级。 |

静态资源合计约 161 KB，占文件总体积 27.6%。其中 GLB 模型占比最大，外置后 HTML 可降至约 422 KB。

四个不可忽视的耦合点：

1. **内联按钮。** HTML 中有大量 `onclick`，依赖 `window.showShareModal`、`window.togglePause`、`window.restartGame` 等公开函数。拆分后必须保留同名桥接，不能直接删除。
2. **共享水面计算。** `waveHeight()` 同时被水面、道具、鸭子、漩涡和特效使用；只能有一个实现来源。
3. **主循环顺序。** 当前循环按“玩家、远端鸭子、沉没、相机、事件、危险物、临时特效、环境、渲染”推进。首轮不能改变顺序。
4. **双人模块耦合最高。** `Duo` 同时关联排行榜身份、祝福、远端鸭子、结算和多个弹层，应最后迁移。

## 3. 目标目录

不要一次创建所有文件。先从最少文件开始，稳定后再按下面的最终职责拆分。

```text
3d-duck.html                 # 静态页面壳、import map、CSS/JS 入口
assets/
  favicon.svg                # 第 8 行的浏览器标签图标
  duck-share.svg             # 第 4705 行的分享卡鸭子 SVG（保留 ${duckSize} 占位或运行时替换）
  duck.glb                   # 第 3236 行的小黄鸭 3D 模型（base64 解码后的二进制）
styles/
  game.css                   # 第一阶段：完整原样迁出的内联 CSS
  # 稳定后才拆为 base.css / hud.css / overlays.css / responsive.css

js/
  main.js                    # bootstrap、主循环、window 兼容桥
  core/
    format.js                # formatScore、formatTime、formatDate、escapeHtml、genUUID
    config.js                # 皮肤、事件权重、画质预设等纯配置
    storage.js               # localStorage 包装，保持现有 key 与 JSON 不变
  render/
    runtime.js               # renderer、scene、camera、resize、画质
    water.js                 # 水面和唯一的 waveHeight
    environment.js           # 天空、昼夜、云、雨、极光、流星
    postfx.js                # 漩涡后处理
  game/
    session.js               # 开局、重置、结束、运行状态
    combo.js                 # 得分、三连、倍率
    player.js                # 移动、相机跟随、生命、护盾
    items.js                 # 道具生成、碰撞入口、磁铁
    hazards.js               # 漩涡、鲨鱼、血瓶、粒子
    events.js                # 随机事件与难度递进
  input/
    controls.js              # 键盘与触控摇杆，只输出输入状态
  ui/
    hud.js                   # 分数、生命、连胜、事件、Toast
    overlays.js              # 暂停、教程、设置、祝福、结算
    share-card.js            # 1200×800 Canvas 分享卡
    achievements.js          # 成就面板展示
  services/
    leaderboard.js           # 排行榜 API、昵称、缓存
    duo.js                   # 双人房间客户端，最后迁移
  debug/
    panel.js                 # 调试面板，最后迁移
```

### 模块间的基本规则

- `main.js` 是唯一负责组装的入口；它不应继续承载大量业务细节。
- 模块通过显式 `ctx`（场景、状态、服务、UI）或少量回调协作，避免互相直接读写大量顶层变量。
- `ui/*` 只接收数据与回调，不直接推进游戏循环。
- `input/controls.js` 只维护输入状态；移动逻辑仍归 `game/player.js`。
- `render/water.js` 唯一导出 `waveHeight`，其他模块不得复制水面算法。
- 迁移期允许 `main.js` 暂时保存现有状态；不要为了“干净”而一次性引入复杂状态管理。

## 4. 分阶段执行计划

### 阶段 0：建立不可回归的基线

先不移动任何代码。

- 记录桌面端和手机横屏的关键页面：加载页、模式入口、HUD、设置、教程、分享卡、成就、结算。
- 跑现有检查：`node _check.js`、`node --check server.node.js`、`git diff --check`。
- 手动走一次核心流程：单人进入、移动、收集、三连、受伤、暂停、重开、排行榜。
- 双人只做一轮基础回归：建房、加入、开始、远端显示、救援、结算。

验收：得到一份“拆分前行为清单”，后续每阶段只和这份清单比较。

### 阶段 1：静态资源原样外置

目标：把 `3d-duck.html` 内联的三处静态资源（favicon SVG、GLB base64 模型、分享卡 duckSVG）拆为独立文件，HTML 改为外部引用。这是整个重构中风险最低、收益最直观的一步，应先于 CSS 外置执行。

资源清单：

| 资源 | 当前位置 | 体积 | 目标文件 | 引用方式 |
| --- | --- | --- | --- | --- |
| favicon SVG | 第 8 行 `<link rel="icon" href="data:image/svg+xml,...">` | ~2 KB | `assets/favicon.svg` | `<link rel="icon" type="image/svg+xml" href="./assets/favicon.svg">` |
| 分享卡 duckSVG | 第 4705 行内联模板字符串 | ~2 KB | `assets/duck-share.svg` | `await (await fetch('./assets/duck-share.svg')).text()` |
| GLB 3D 模型 | 第 3236 行 base64 字符串 | ~157 KB | `assets/duck.glb` | `loader.load('./assets/duck.glb', onLoad, onProgress, onError)` |

约束：

- 不改变任何资源的内容，只做“内联 → 外部文件”的搬家。SVG 文件保留原始 path 数据，GLB 文件由 base64 解码为二进制（体积可减小约 25%）。
- favicon SVG 当前使用 `encodeURIComponent` 编码的内联形式，外置为文件后无需编码，直接写入原始 SVG 即可。
- 分享卡 duckSVG 当前是模板字符串，包含 `${duckSize}` 占位。外置时保留占位符语义：要么改为在 `fetch` 后做字符串替换，要么把 `width`/`height` 从 SVG 中移除并在 Canvas 绘制时通过 `Image` 对象的天然尺寸 + `drawImage` 缩放控制（推荐后者，与现有 `duckImg.width>0` 判断逻辑一致）。
- GLB 模型由 `loader.parse(arrayBuffer, ...)` 改为 `loader.load(url, onLoad, onProgress, onError)`，注意加载完成前 `duckModel` 仍为 `null`，主循环和 `startGameSession` 的守卫逻辑不变。
- 服务器已支持 `.svg`、`.glb` MIME（参考 `server.node.js` 的 MIME 表），无需服务端改造。
- 不在本阶段做资源压缩、指纹缓存或 CDN 化；保持本地与云函数两种模式都可访问。
- 解码 base64 GLB 时使用一次性脚本（如 `node -e "fs.writeFileSync('assets/duck.glb', Buffer.from(b64, 'base64'))"`），不要手写中间文件。

验收：

- 浏览器标签图标正常显示。
- 进入对局后 3D 鸭子模型加载并渲染正常，硬刷新无控制台错误。
- 生成分享卡时鸭子图像绘制位置和大小与基线一致。
- `3d-duck.html` 体积从 ~583 KB 降至 ~422 KB（减少约 161 KB）。

### 阶段 2：CSS 原样外置

目标：把内联 CSS 整段迁到 `styles/game.css`，HTML 改为 `<link rel="stylesheet">`。

- 不更改任何选择器、变量、媒体查询、`z-index` 或 DOM class。
- 原有 CSS 书写顺序必须保持；响应式规则仍放在文件末尾。
- 暂时只建一个 CSS 文件，避免“搬家 + 再分类”同时发生。

验收：桌面与手机横屏截图逐项对比；HUD、安全区、设置、教程、分享卡和成就均无布局漂移。

### 阶段 3：先升级检查，再外置前端入口

目标：把内联主模块变为 `js/main.js`；页面保留 import map、首屏加载动画所需的极小 inline boot 脚本，以及 `<script type="module" src="./js/main.js">`。

先处理检查：

- 新增 `scripts/check-client.js`，递归解析 `js/**/*.js`，使用 Acorn 的 `sourceType: 'module'`。
- 让检查出错时返回非零退出码；当前 `_check.js` 捕获语法错误后仍可能以成功状态结束。
- 在 `package.json` 增加 `check:client`、`check:server`、`check` 和 `test` 脚本；将 Acorn 写入 `devDependencies`，避免新环境依赖被忽略的 `node_modules`。

再外置入口：

- 第一版只移动代码，不改函数、状态变量或调用顺序。
- 保留 HTML 内联按钮需要的同名 API，例如：

```js
Object.assign(window, {
  restartGame,
  showShareModal,
  downloadShareCard,
  showDetailModal,
  togglePause,
  openSettings,
  closeSettings,
  showAchievements,
  closeAchievements
});
```

验收：硬刷新后没有模块加载或控制台错误；所有原有按钮仍可用。

### 阶段 4：先迁纯工具、配置与持久化

这是风险最低的一批模块：

- `core/format.js`：`formatScore`、`formatTime`、`formatDate`，以及浏览器工具 `escapeHtml`、`genUUID`。后两者当前分别依赖 DOM 与 `window`；先保留浏览器边界，若要单测再改为可注入依赖或纯函数。
- `core/config.js`：事件定义与权重、鸭子皮肤、画质预设等不依赖 DOM 的数据。
- `core/storage.js`：包装 `localStorage` 读写。

约束：

- 所有既有 key（如 `duck_*`、`achievements_data`、祝福与设置相关 key）和保存格式必须完全不变。
- 不要在这一阶段引入全局 Store 或修改状态流。
- 为 `format` 中不依赖浏览器 API 的函数和 `storage` 写 `node:test` 测试；`escapeHtml`、`genUUID` 在保留现有实现时走浏览器回归，或先改为可注入依赖后再纳入 Node 测试。

验收：相同输入得到相同分数格式、日期格式和存档结果；刷新页面后原有皮肤、设置、成就、祝福仍存在。

### 阶段 5：迁移独立 UI 与排行榜

推荐顺序：

1. `ui/share-card.js`：Canvas 分享卡与预览尺寸；
2. `ui/achievements.js`：成就列表和弹层渲染；
3. `ui/hud.js`：HUD、Toast、事件提示；
4. `ui/overlays.js`：暂停、教程、设置、结算；
5. `services/leaderboard.js`：排行榜读取、提交、昵称与缓存。

约束：

- UI 只接收数据与回调，不直接改游戏循环里的核心状态。
- 每迁一个弹层，都在 `main.js` 保留对应的 `window.*` 兼容桥。
- 排行榜 API 仍是 `GET/POST /api/leaderboard`；客户端继续保留云函数兼容兜底地址。

验收：分享卡仍为 1200×800，排行榜与昵称流程正常，所有弹层能打开、关闭且手机横屏不溢出。

### 阶段 6：迁移渲染基础设施

推荐顺序：

1. `render/runtime.js`：renderer、scene、camera、OrbitControls、resize 与画质；
2. `render/water.js`：水面几何、波浪更新与唯一 `waveHeight`；
3. `render/environment.js`：昼夜、天空、云、雨、极光、流星；
4. `render/postfx.js`：漩涡后处理。

约束：

- 渲染模块的依赖显式传入，不能偷偷引用未定义的全局变量。
- `sinkFx` 等玩法侧状态通过 getter 或 `ctx.state` 读取，避免渲染模块反向控制玩法。
- 不能复制 `waveHeight`；玩家、物品、漩涡和水面必须继续使用同一个函数。

验收：低/中/高画质、窗口 resize、昼夜、暴风雨、漩涡吸入后处理都与基线一致。

### 阶段 7：迁移输入与玩法子系统

顺序必须小步进行：

1. `input/controls.js`：只输出键盘/触控输入状态；
2. `game/combo.js`：得分、三连、倍率；
3. `game/player.js`：移动、相机跟随、生命、护盾；
4. `game/items.js`：道具生成、回收、碰撞入口、磁铁；
5. `game/hazards.js`：漩涡、鲨鱼、血瓶、粒子；
6. `game/events.js`：随机事件、预警、难度递进；
7. `game/session.js`：开局、重置、结算与状态组装。

模块协作采用回调，而不是互相循环导入：

```text
items.onCollect → combo.add / player.heal / player.activateShield
hazards.onDamage → player.takeDamage → ui.updateHud / session.finish
events.spawnHazard → hazards.spawn / items.spawn
```

约束：主循环的更新顺序保持不变。拆分只是把现有调用搬到 `main.js` 的同一顺序中，不做“顺便优化循环”的改写。

验收：移动、碰撞、三连、磁铁、护盾、血瓶、漩涡、鲨鱼、事件和游戏结束逐项回归。

### 阶段 8：最后处理双人、调试与服务端可选拆分

客户端：

- 最后迁 `services/duo.js` 与 `debug/panel.js`。
- 迁移 `Duo` 前先固定排行榜身份、祝福同步、远端鸭子、倒地救援和结算的现有契约。
- 双人测试必须使用两个真实浏览器窗口；不要只依赖接口压力测试。

服务端：

- 首轮前端拆分期间，`server.node.js` 不动。它兼容云函数与本地 Node，过早 CommonJS 拆文件会增加部署风险。
- 当前服务端已支持 `.js` 与 `.css` MIME，因此原生 ESM 与外置 CSS 不需服务端改造。
- 前端稳定后，如确有维护需求，再将本地 Node 分支拆为 `server/local-app.js`、`server/duo-room.js`、`server/leaderboard-store.js`；`server.node.js` 继续作为双模式兼容入口。
- 不要把 `package.json` 改为 `"type": "module"`，否则现有使用 `require()` 的服务端和检查脚本会失效。

## 5. 测试与验收设计

### 每阶段必跑

```text
node scripts/check-client.js   # 阶段 3 后替代旧的内联检查
node --check server.node.js
git diff --check
```

### 建议新增的轻量测试

- 使用 Node 内置 `node:test`，不引入大型测试框架。
- `test/format.test.js`：分数、时间、日期；文本转义仅在其改为纯函数后纳入。
- `test/storage.test.js`：默认值、损坏 JSON、旧 key 兼容。
- `test/leaderboard-api.test.js`：读写、非法 JSON、超长请求。
- `test/duo-api.test.js`：建房、加入、开始、状态同步、结束。

API 测试必须使用临时数据文件，绝不向真实 `leaderboard.json` 发 POST；实施测试前，先让服务端支持注入数据文件路径，或在隔离的临时服务副本中运行。

### 浏览器验收矩阵

| 维度 | 必测场景 |
| --- | --- |
| 单人 | 进入、移动、收集、三连、受伤、暂停、结算、再来一局 |
| UI | 设置、教程、帮助、祝福、成就、分享卡、排行榜 |
| 移动 | 横屏、触控摇杆、安全区、HUD、分享卡预览 |
| 渲染 | 画质切换、resize、昼夜、天气、漩涡后处理 |
| 双人（仅阶段 8） | 建房、加入、开始、远端渲染、倒地救援、结算 |

## 6. 服务端与发布注意事项

- `leaderboard.json` 仍属于服务端；客户端模块只通过 API 访问，首轮不改其 JSON 结构或整份写入语义。
- 现有静态服务的根目录是仓库目录。未来如要公开部署，应将静态根明确限制为 `public/` 或 `dist/`，并用 `path.relative` 做路径边界校验，避免非前端文件被意外暴露。
- 构建步骤属于后续评估项：只有确实需要压缩、指纹缓存或发布目录时，再增加 `build → dist/`；本次不强行引入。

## 7. 完成定义

以下条件同时满足，才算完成这两个 TODO：

1. HTML、CSS、前端 JS 已按职责分文件，`3d-duck.html` 只保留页面壳与入口。
2. favicon、分享卡 SVG、GLB 3D 模型已外置为 `assets/` 下的独立文件；`3d-duck.html` 不再内联任何 base64 或 SVG 资源。
3. 没有新增框架或构建链；`npm start` 和现有部署方式仍可用。
4. 所有既有 UI、单人玩法、移动端和双人流程通过基线回归。
5. `window.*` 兼容桥在内联按钮全部替换为事件监听前持续保留。
6. 客户端语法检查覆盖外置模块，服务端检查与测试可在新环境复现。
7. 每阶段可单独回退，没有“大重写”提交。

## 8. 推荐实施顺序（摘要）

```text
基线 → 静态资源外置 → CSS 原样外置 → 升级检查 → main.js 外置
→ 纯工具/配置/存储 → 独立 UI/排行榜
→ 渲染层 → 输入与玩法 → 双人/调试 → 可选服务端拆分
```

这份顺序故意把风险最高的主循环、`Duo` 和服务端放到最后。先获得可维护性，再逐步降低耦合；不要为了“看起来现代化”而一次性推翻当前可运行版本。
