# 🦆 小黄鸭漂流记  - 项目说明文档

## 📖 项目简介

「小黄鸭漂流记」是一款基于 Web3D 技术开发的休闲收集类小游戏。玩家将扮演一只在水面冒险的小鸭子，通过灵活的走位收集道具获取积分，同时躲避障碍物。游戏支持键鼠与虚拟摇杆双端操作，并拥有昼夜交替、组合倍率与随机事件等特色机制，适合碎片化时间娱乐。

---

## 🏗️ 项目架构

### 1. 技术栈

基于文件特征（`3d-duck.html`及交互描述），项目采用纯前端单文件/轻量级架构：

* **核心渲染引擎**：Three.js / Babylon.js 等 Web3D 引擎
* **交互控制**：自定义虚拟摇杆 + PointerLock/Mouse 移动监听
* **UI 层**：HTML5 + CSS3 (绝对定位/弹性布局覆盖于 Canvas 之上)
* **状态管理**：原生 JavaScript 管理游戏状态（积分、护盾、时间、倍率、事件）

### 2. 核心模块划分

| 模块名称                              | 功能职责                                                            |
| :------------------------------------ | :------------------------------------------------------------------ |
| **场景管理**                    | 3D场景初始化、水面渲染、天空盒/昼夜光照切换、物体生成与回收         |
| **角色控制**                    | 小鸭子模型控制、W/S/A/D键位移动（基于视角）、边界限制               |
| **相机控制**                    | 第三人称跟随、鼠标拖拽旋转视角                                      |
| **交互系统**                    | PC端键鼠事件监听、移动端触摸摇杆逻辑                                |
| **道具与碰撞 (Prop & Physics)** | 道具生成逻辑、碰撞检测、积分/护盾/扣分结算                          |
| **🎮 事件系统**                 | 全局60秒定时触发随机事件、倒计时管理、全局状态修正（如风力/暴雨等） |
| **❤️ 生命系统**               | 爱心生命值管理、扣心/加心逻辑、游戏结束判定                         |
| **游戏循环**                    | 全局时间推进、状态更新、UI同步、爱心归零判定游戏结束                |
| **UI管理 (HUD)**                | 加载界面、积分/爱心/护盾/时间/事件状态显示、规则弹窗                |
| **🏆 排行榜系统**               | JSON文件存储、静态部署支持、分数提交与读取                          |

---

## 🎮 核心玩法设计（v2.0 重构版）

### 🔄 核心变更：从"限时模式"改为"生存模式"

#### ❌ 旧版设计（已废弃）

- 每局游戏固定60秒
- 时间到游戏结束
- 以得分高低为唯一目标

#### ✅ 新版设计（当前）

- **爱心生命值系统**：初始3颗心（❤️❤️❤️）
- **全局60秒事件循环**：每60秒触发一次随机环境事件
- **游戏结束条件**：只有爱心全部扣完才结束游戏
- **无限时长**：理论上可以一直玩下去，直到生命值耗尽

---

### ❤️ 生命系统（核心机制）

#### 基础设定

| 属性       | 值       | 说明                         |
| :--------- | :------- | :--------------------------- |
| 初始生命值 | 3颗心    | ❤️❤️❤️                 |
| 最大生命值 | 5颗心    | 拾取爱心道具可超过初始值     |
| 受伤判定   | 护盾优先 | 有护盾时扣护盾，无护盾时扣心 |
| 无敌时间   | 0.5秒    | 受伤后短暂无敌，避免连续扣心 |

#### 扣心场景

- 🪨 **石头碰撞**：无护盾时扣1颗心
- 🌀 **漩涡吸入**：被漩涡中心吸入扣1颗心
- 🦈 **水下暗影**：停留超过3秒被撞击扣1颗心

#### 爱心道具（加心）

- **视觉设计**：漂浮在水面上的粉色爱心，散发微光粒子
- **生成逻辑**：
  - 基础概率：每60秒事件周期有30%概率生成1个
  - 仁慈机制：当生命值≤1时，生成概率提升至60%
- **拾取效果**：恢复1颗心（❤️），上限5颗，播放治愈音效与+❤️飘字

---

### ⏱️ 全局事件系统（每60秒触发）

#### 触发机制

- **全局计时器**：从游戏开始运行，每60秒触发一次事件
- **预警提示**：事件触发前3秒，屏幕上方显示预警图标和文字
- **事件叠加**：多个事件可同时存在，增加混乱感

#### 事件池（随机触发）

| 事件名称           | 图标 | 持续时间 | 效果描述                                               |
| :----------------- | :--- | :------- | :----------------------------------------------------- |
| **顺风**     | 🌪️ | 15秒     | 场景出现风向箭头，顺风向移动速度+50%，逆风向-30%       |
| **逆风**     | 🌪️ | 15秒     | 与顺风相反方向                                         |
| **暴风雨**   | 🌧️ | 20秒     | 视野缩小（相机拉近），水面波浪加剧，石头刷新率+50%     |
| **彩虹祝福** | 🌈   | 15秒     | 全屏彩虹特效，所有水草和花朵临时转化为高分道具（+5分） |
| **水下暗影** | 🦈   | 20秒     | 水底出现追踪黑影，停留超过3秒会被撞击扣1颗心           |
| **海浪汹涌** | 🌊   | 15秒     | 海浪振幅增大，鸭子上下起伏更剧烈，道具更容易被浪冲走   |
| **道具雨**   | 🎁   | 10秒     | 大量道具从天而降，包含大量爱心和荷叶                   |
| **平静时刻** | ☀️ | 15秒     | 无负面效果，海浪平缓，视野清晰，适合收集               |

#### 事件权重（普通状态）

- 顺风/逆风：20%
- 暴风雨：15%
- 彩虹祝福：15%
- 水下暗影：15%
- 海浪汹涌：15%
- 道具雨：10%
- 平静时刻：10%

#### 事件权重（生命值≤1时 - 仁慈调整）

- 道具雨：40%
- 彩虹祝福：30%
- 平静时刻：20%
- 顺风：10%

---

### 🌀 漩涡系统（环境障碍）

#### 视觉效果

- 水面生成带有吸附动画的漩涡模型
- 粒子特效/Shader实现旋转水流
- 漩涡周围有淡淡的引力场指示圈

#### 行为逻辑

- **生成时机**：每60秒事件周期有40%概率生成1-2个漩涡
- **存在时间**：8-12秒后消失
- **引力场**：漩涡周围半径5单位内有引力，距离越近引力越强
- **吸入判定**：进入漩涡中心1.5单位内判定为吸入

#### 玩家体验

- 靠近漩涡时会被缓慢吸入（需反向操作挣脱）
- 被吸入后：扣除1颗心，强制传送回安全出生点(0,0,0)
- 传送后获得2秒无敌时间

---

### 🏆 排行榜系统（JSON静态部署方案）

#### 设计目标

- 纯前端实现，无需后端服务器
- 支持静态部署（GitHub Pages / Vercel / Netlify等）
- 数据持久化，支持历史记录

#### 方案对比

| 方案                          | 优点                   | 缺点                       | 适用场景          |
| :---------------------------- | :--------------------- | :------------------------- | :---------------- |
| **localStorage**        | 零依赖，即时读写       | 仅限本地，无法跨设备共享   | 单人本地游戏      |
| **JSON文件 + 静态托管** | 可静态部署，跨设备共享 | 需要手动提交/更新分数      | 小型社区/朋友间   |
| **GitHub Gist API**     | 免费，支持CRUD         | 需要GitHub账号，有速率限制 | 开源项目/技术用户 |
| **Firebase/Supabase**   | 实时同步，功能丰富     | 需要配置，有免费额度限制   | 正式产品          |

#### 推荐方案：JSON文件 + GitHub Pages（静态部署）

##### 数据存储结构

```json
// leaderboard.json
{
  "version": "1.0",
  "lastUpdated": "2026-07-17T12:00:00Z",
  "entries": [
    {
      "id": "player_001",
      "nickname": "鸭中之王",
      "score": 15800,
      "maxCombo": 10,
      "playTime": 1260,
      "heartsRemaining": 2,
      "achievements": ["first_blood", "combo_master", "survivor"],
      "timestamp": "2026-07-17T11:30:00Z"
    }
  ],
  "stats": {
    "totalPlayers": 156,
    "totalGames": 423,
    "highScore": 15800,
    "averageScore": 3200
  }
}
```

##### 提交流程

```
游戏结束 → 输入昵称 → 生成分数记录 → 追加到本地JSON → 可选：提交到远程仓库
```

##### 静态部署架构

```
┌─────────────────────────────────────────────────────────┐
│                    玩家浏览器                            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  游戏客户端  │───▶│  排行榜UI   │───▶│  JSON数据   │  │
│  │  (Three.js) │    │  (HTML/CSS) │    │  (fetch)    │  │
│  └─────────────┘    └─────────────┘    └─────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              静态托管 (GitHub Pages)                     │
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │  index.html     │    │  /data/leaderboard.json     │ │
│  │  (游戏主文件)    │    │  (排行榜数据)                │ │
│  └─────────────────┘    └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

##### 实现代码示例

```javascript
// ===== 排行榜系统 =====
const Leaderboard = {
    // 本地存储键名
    STORAGE_KEY: 'duck_leaderboard',
  
    // 远程JSON地址（可选，用于跨设备同步）
    REMOTE_URL: './data/leaderboard.json',
  
    // 获取本地排行榜
    getLocal() {
        const data = localStorage.getItem(this.STORAGE_KEY);
        return data ? JSON.parse(data) : { entries: [], stats: {} };
    },
  
    // 保存到本地
    saveLocal(entry) {
        const data = this.getLocal();
        data.entries.push({
            ...entry,
            id: 'local_' + Date.now(),
            timestamp: new Date().toISOString()
        });
        // 按分数排序，保留前100名
        data.entries.sort((a, b) => b.score - a.score);
        data.entries = data.entries.slice(0, 100);
        // 更新统计
        data.stats = {
            totalPlayers: data.entries.length,
            highScore: data.entries[0]?.score || 0,
            lastUpdated: new Date().toISOString()
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        return data;
    },
  
    // 提交分数（游戏结束时调用）
    submitScore(score, playTime, nickname = '匿名小鸭') {
        const entry = {
            nickname,
            score,
            playTime,
            maxCombo: window.gameState?.maxCombo || 1,
            heartsRemaining: window.gameState?.hearts || 0,
            achievements: this.calculateAchievements(score, playTime)
        };
        return this.saveLocal(entry);
    },
  
    // 计算成就
    calculateAchievements(score, playTime) {
        const achievements = [];
        if (score >= 1000) achievements.push('score_1k');
        if (score >= 5000) achievements.push('score_5k');
        if (score >= 10000) achievements.push('score_10k');
        if (playTime >= 300) achievements.push('survivor_5m');
        if (playTime >= 600) achievements.push('survivor_10m');
        return achievements;
    },
  
    // 获取远程排行榜（如果配置了远程JSON）
    async fetchRemote() {
        try {
            const response = await fetch(this.REMOTE_URL);
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (e) {
            console.warn('Failed to fetch remote leaderboard:', e);
            return null;
        }
    },
  
    // 渲染排行榜UI
    renderLeaderboard(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;
      
        const html = `
            <div class="leaderboard">
                <h3>🏆 排行榜</h3>
                <div class="lb-stats">
                    <span>最高分: ${data.stats.highScore || 0}</span>
                    <span>玩家数: ${data.stats.totalPlayers || 0}</span>
                </div>
                <div class="lb-list">
                    ${data.entries.slice(0, 20).map((entry, i) => `
                        <div class="lb-item ${i < 3 ? 'top-' + (i+1) : ''}">
                            <span class="rank">#${i+1}</span>
                            <span class="nickname">${this.escapeHtml(entry.nickname)}</span>
                            <span class="score">${entry.score.toLocaleString()}</span>
                            <span class="time">${this.formatTime(entry.playTime)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        container.innerHTML = html;
    },
  
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
  
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
};
```

##### 部署步骤（GitHub Pages）

1. **创建仓库结构**

```
DuckGame/
├── index.html              # 游戏主文件
├── data/
│   └── leaderboard.json    # 排行榜数据
├── assets/                 # 静态资源
└── README.md
```

2. **初始化排行榜JSON**

```json
{
  "version": "1.0",
  "lastUpdated": "2026-07-17T12:00:00Z",
  "entries": [],
  "stats": {
    "totalPlayers": 0,
    "totalGames": 0,
    "highScore": 0,
    "averageScore": 0
  }
}
```

3. **启用GitHub Pages**

   - 仓库设置 → Pages → Source选择`main`分支
   - 访问地址：`https://<username>.github.io/DuckGame/`
4. **可选：GitHub Actions自动合并PR**

   - 玩家通过Issue/PR提交分数
   - Action自动验证并合并到leaderboard.json

---

### 🎯 道具系统（v2.0更新）

| 道具 | 图标 | 效果      | 基础分 | 备注               |
| :--- | :--- | :-------- | :----- | :----------------- |
| 水草 | 🌿   | 加分      | +1     | 基础收集物         |
| 花朵 | 🌸   | 加分      | +2     | 基础收集物         |
| 荷叶 | 🍃   | 获得护盾  | +3     | 护盾持续15秒       |
| 石头 | 🪨   | 扣分/扣心 | -1     | 无护盾时扣1颗心    |
| 爱心 | ❤️ | 恢复生命  | -      | 恢复1颗心，上限5颗 |

---

### 🔥 组合倍率机制（保留）

- 集齐3个同色道具 → 触发 **10倍积分**，持续60秒！
- 集齐3个不同色道具 → 触发 **5倍积分**，持续60秒！
- 倍率期间：鸭子变大4倍 + 无敌 + 皇冠特效

---

## 🚧 待做功能 (TODO) [v2.0更新]

### 🌟 1. 排行榜系统（已实现JSON方案）

**目标**：增加玩家竞技动力与游戏留存。

* **数据存储**：
  * 轻量级方案：`localStorage` 实现本地历史最高分与榜单。
  * 进阶方案：接入轻量后端（如 LeanCloud / Firebase）或 Web3 钱包地址，实现全球链上/云排行榜。
* **UI展示**：
  * 游戏结束弹窗中展示“本次得分”与“历史最高分”。
  * 新增排行榜入口，展示 Top 20 玩家的昵称、得分、达成时间。

### ❤️ 2. 生命机制系统（核心重构）

**目标**：从"限时模式"改为"生存模式"，只有爱心扣完才结束游戏。

- ✅ 初始生命值为 3 颗心（❤️❤️❤️）
- ✅ 生命值归零时，游戏结束
- ✅ 受伤优先扣除护盾，护盾为0时扣心
- ✅ 爱心道具可恢复生命，上限5颗

### 🌀 3. 扣心机制 - 海上漩涡

**目标**：引入动态环境障碍，提升游戏紧张感。

- ✅ 视觉效果：水面生成带有吸附动画的漩涡模型
- ✅ 行为逻辑：漩涡随机刷新，存在一定时间后消失
- ✅ 引力场：小鸭子靠近时会被缓慢吸入
- ✅ 吸入判定：被吸入漩涡中心扣1颗心，传送回出生点

### ➕ 4. 加心道具

**目标**：提供容错率，增加随机惊喜。

- ✅ 低概率随机生成
- ✅ 生命值≤1时提高生成概率（仁慈机制）
- ✅ 拾取后恢复1颗心，上限5颗

### 🎲 5. 随机事件系统 (Event System)（重构为60秒全局触发）

**目标**：打破单调感，通过环境突变增加刺激感和策略深度。

- ✅ **触发机制**：每60秒触发一次全局事件（非每局60秒）
- ✅ **预警系统**：事件触发前3秒显示预警
- ✅ **事件池**：顺风/逆风、暴风雨、彩虹祝福、水下暗影、海浪汹涌、道具雨、平静时刻
- ✅ **仁慈机制**：生命值≤1时，负面事件概率降低，正面事件概率提升

### 🎵 6. 音效反馈

**目标**：提升游戏操作手感与沉浸感。

- 为收集水草、花朵、扣分、触发倍率、漩涡吸附、事件触发加入不同音效

### 🦆 7. 小鸭子动画

**目标**：让角色更具生命力，动作反馈更直观。

- 增加游泳时的拨水动画、加速时的尾部水花特效、逆风时的吃力姿态

### 📈 8. 难度递进

**目标**：保障游戏体验曲线，越到后期越紧张。

- 随游戏时长推移：
  - 漩涡生成频率增加
  - 恶劣天气事件概率提升
  - 石头刷新率提升
  - 事件持续时间延长

---

## 📊 游戏状态机

```
┌─────────────────────────────────────────────────────────────────┐
│                         游戏状态流转                              │
└─────────────────────────────────────────────────────────────────┘

[游戏开始]
     │
     ▼
[初始化] ──▶ 爱心=3, 分数=0, 游戏时间=0, 事件计时器=60s
     │
     ▼
[游戏进行中] ◀────────────────────────────────────────────┐
     │                                                   │
     ├── 每60秒 ──▶ [事件触发] ──▶ 随机选择事件 ──▶ │
     │                    │                          │
     │                    ▼                          │
     │              [事件效果应用]                    │
     │                    │                          │
     │                    ▼                          │
     │              [事件结束] ──────────────────────┤
     │                                               │
     ├── 碰撞检测 ──▶ [受伤判定] ──▶ 扣护盾/扣心 ────┤
     │                    │                          │
     │                    ▼                          │
     │              爱心=0? ──是──▶ [游戏结束]      │
     │                    │                          │
     │                   否                          │
     │                    │                          │
     │                    ▼                          │
     │              [继续游戏] ──────────────────────┘
     │
     ▼
[游戏结束] ──▶ 显示得分 ──▶ 提交排行榜 ──▶ 重新开始
```

---

## 🔧 技术实现要点

### 全局事件计时器

```javascript
// 全局60秒事件循环
let eventTimer = 60; // 秒
const EVENT_INTERVAL = 60;

function updateEventTimer(dt) {
    eventTimer -= dt;
    if (eventTimer <= 0) {
        triggerRandomEvent();
        eventTimer = EVENT_INTERVAL;
    }
    // 预警显示（最后3秒）
    if (eventTimer <= 3 && eventTimer > 0) {
        showEventWarning(nextEvent);
    }
}
```

### 爱心生命值管理

```javascript
// 生命系统
let hearts = 3;
const MAX_HEARTS = 5;

function takeDamage(amount = 1) {
    if (invincible > 0) return; // 无敌状态
  
    if (hasShield) {
        // 护盾抵挡
        hasShield = false;
        showToast('护盾挡住了!', 'shield');
    } else {
        hearts -= amount;
        showToast('-1 ❤️', 'damage');
        screenFlash('red'); // 红色闪边
        invincible = 0.5; // 短暂无敌
      
        if (hearts <= 0) {
            gameOver();
        }
    }
}

function heal(amount = 1) {
    hearts = Math.min(MAX_HEARTS, hearts + amount);
    showToast('+1 ❤️', 'heal');
}
```

---

## 📝 更新日志

### v2.0 (2026-07-17) - 生存模式重构

- ✅ 移除60秒限时机制，改为爱心生命值系统
- ✅ 全局60秒事件循环，每60秒触发一次随机事件
- ✅ 游戏结束条件改为"爱心扣完"
- ✅ 新增爱心道具和加心机制
- ✅ 新增漩涡障碍系统
- ✅ 排行榜系统支持JSON静态部署
- ✅ 事件系统增加仁慈机制（低生命值时正面事件概率提升）

### v1.0 (初始版本)

- 基础3D场景和鸭子模型
- 道具收集系统
- 组合倍率机制
- 昼夜系统
- 随机海浪事件

---

## 🚀 本地运行

1. 克隆仓库

```bash
git clone https://github.com/future73807/DuckGame.git
cd DuckGame
```

2. 启动本地服务器（需要Python或Node.js）

```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

3. 浏览器访问 `http://localhost:8080`

---

## 📄 许可证

MIT License
