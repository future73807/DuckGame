// 纯配置数据：随机事件、皮肤调色板、翅膀贴图区域
// 这些数据不依赖 DOM 或 Three.js，可被任意模块安全导入

// ===== 随机事件 =====
export const EVENTS={
    tailwind:{n:'顺风',ic:'fa-wind',d:15,fx:'移动加速',t:'good'},
    headwind:{n:'逆风',ic:'fa-tornado',d:15,fx:'移动减速',t:'bad'},
    storm:{n:'暴风雨',ic:'fa-cloud-showers-heavy',d:20,fx:'巨浪雷电·落石多',t:'bad'},
    rainbow:{n:'彩虹祝福',ic:'fa-rainbow',d:15,fx:'花草额外+5分',t:'good'},
    shadow:{n:'水下暗影',ic:'fa-fish',d:20,fx:'暗影追踪·撞击扣心',t:'bad'},
    bigwave:{n:'海浪汹涌',ic:'fa-water',d:15,fx:'巨浪起伏',t:'neutral'},
    itemrain:{n:'道具雨',ic:'fa-gift',d:10,fx:'血瓶荷叶掉落',t:'good'},
    calm:{n:'平静时刻',ic:'fa-sun',d:15,fx:'风平浪静',t:'neutral'}
};

// 事件类别配色：好（绿）/坏（红）/中性（黄）
export const EV_TINT={good:'rgba(24,150,74,.62)',bad:'rgba(196,46,46,.62)',neutral:'rgba(200,158,32,.62)'};
export const EV_BORDER={good:'rgba(90,230,150,.6)',bad:'rgba(255,120,120,.6)',neutral:'rgba(255,220,110,.6)'};

// 事件权重表：正常局与残血怜悯局
export const EV_W_NORMAL=[['tailwind',10],['headwind',10],['storm',15],['rainbow',15],['shadow',15],['bigwave',15],['itemrain',10],['calm',10]];
export const EV_W_MERCY=[['itemrain',40],['rainbow',30],['calm',20],['tailwind',10]];

// ===== 鸭子皮肤 =====
export const DEFAULT_DUCK_SKIN='classic';

// 每套皮肤 = 身体/嘴巴 两色搭配（翅膀与身体同色，不再区分）
export const DUCK_SKINS={
    classic:{color:0xffde76,beak:0xff9a3d},
    pearl:{color:0xf3f5f2,beak:0xf2a35e},
    coral:{color:0xf09a78,beak:0xf7c65c},
    ocean:{color:0x70b9d4,beak:0xf2b25c}
};

// 贴图上三块翅膀橙斑的椭圆区域（512 基准：cx,cy,rx,ry）
export const WING_BLOBS=[[110,90,95,62],[55,230,72,46],[265,280,88,42]];

/**
 * 校验皮肤名称是否合法（custom 或内置皮肤之一）
 */
export function isValidDuckSkin(skin){return skin==='custom'||Object.hasOwn(DUCK_SKINS,skin)}
