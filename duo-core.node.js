// ============================================================
// 双人同行房间内核（纯逻辑，无 IO）
// ============================================================
// 被以下两端复用，保证 HTTP 轮询与 WebSocket 长连接行为一致：
//   - ws.node.js     热铁盒 WebSocket 云函数（状态存 KV Database）
//   - server.node.js 本地 Node 服务器（状态存内存 Map）
//
// 约定：本文件不读写文件、不碰数据库、不依赖 req/res，
// 只接收普通对象房间状态并返回变更结果，便于两侧自由选择存储。
// ============================================================
'use strict';

const MAX_STABLE_ITEM_ID = 0x7fffffff;
// 游戏常态约 244 项，但节日/道具雨/调试生成可能短时越过客户端 MAX_I=1200。
const MAX_DUO_ITEMS = 2048;
const DUO_SCENE_HISTORY_LIMIT = 12;

const DUCK_SKIN_IDS = new Set(['classic', 'pearl', 'coral', 'ocean', 'custom']);
const DUO_BLESSINGS = new Map([
    ['grass_double', { id: 'grass_double', name: '水草丰收', desc: '今日水草得分 ×2', icon: 'fa-seedling', target: 'grass', mult: 2 }],
    ['flower_triple', { id: 'flower_triple', name: '花季绽放', desc: '今日花朵得分 ×3', icon: 'fa-sun', target: 'flower', mult: 3 }],
    ['shield_start', { id: 'shield_start', name: '护盾加持', desc: '开局自带 1 层护盾', icon: 'fa-shield-halved', target: 'shield', value: 1 }],
    ['magnet_extend', { id: 'magnet_extend', name: '磁场强化', desc: '磁铁持续时间 +50%', icon: 'fa-magnet', target: 'magnet', mult: 1.5 }],
    ['speed_boost', { id: 'speed_boost', name: '疾风步', desc: '移动速度 +20%', icon: 'fa-wind', target: 'speed', mult: 1.2 }],
    ['heart_cap', { id: 'heart_cap', name: '生命扩容', desc: '最大生命 +1', icon: 'fa-heart', target: 'maxHearts', value: 1 }],
    ['score_bonus', { id: 'score_bonus', name: '幸运星', desc: '所有得分 +10%', icon: 'fa-star', target: 'score', mult: 1.1 }],
    ['whirl_shield', { id: 'whirl_shield', name: '漩涡护盾', desc: '漩涡吸入不扣心', icon: 'fa-tornado', target: 'whirl', value: 1 }]
]);

const safeText = (value, max = 18) => String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
const nextSyncCounter = value => {
    const current = Number.isSafeInteger(value) && value >= 0 ? value : 0;
    return current < Number.MAX_SAFE_INTEGER ? current + 1 : current;
};
const bumpPlayerSeq = player => {
    player.seq = nextSyncCounter(player.seq);
    return player.seq;
};
const bumpRoomRev = room => {
    room.rev = nextSyncCounter(room.rev);
    return room.rev;
};

const cleanDuoBlessing = blessing => {
    const base = DUO_BLESSINGS.get(safeText(blessing?.id, 32)) || DUO_BLESSINGS.get('grass_double');
    const mult = Number(blessing?.mult);
    return {
        ...base,
        mult: Number.isFinite(mult) ? Math.max(1, Math.min(4, mult)) : base.mult,
        isHoliday: !!blessing?.isHoliday,
        holidayName: safeText(blessing?.holidayName, 12) || null,
        holidayIcon: safeText(blessing?.holidayIcon, 32) || null
    };
};

const cleanDuoState = (state) => {
    const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const cleaned = {
        x: Math.max(-100000, Math.min(100000, num(state?.x))),
        y: Math.max(-1000, Math.min(1000, num(state?.y))),
        z: Math.max(-100000, Math.min(100000, num(state?.z))),
        ry: num(state?.ry),
        score: Math.max(0, Math.floor(num(state?.score))),
        hearts: Math.max(0, Math.min(9, Math.floor(num(state?.hearts)))),
        skin: DUCK_SKIN_IDS.has(state?.skin) ? state.skin : 'classic',
        sh: Math.max(0, num(state?.sh)),
        mt: Math.max(0, num(state?.mt)),
        cm: Math.max(0, Math.min(2, num(state?.cm))),
        bt: Math.max(0, num(state?.bt)),
        iv: Math.max(0, num(state?.iv)),
        sk: Math.max(0, num(state?.sk))
    };
    if (Array.isArray(state?.ci)) {
        const collected = [];
        const seen = new Set();
        for (const raw of state.ci) {
            const isVersioned = Array.isArray(raw);
            const id = Number(isVersioned ? raw[0] : raw);
            const generation = isVersioned ? Number(raw[1]) : null;
            if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_STABLE_ITEM_ID) continue;
            if (isVersioned && (!Number.isSafeInteger(generation) || generation < 0 || generation > MAX_STABLE_ITEM_ID)) continue;
            const key = id + '|' + (generation === null ? '' : generation);
            if (seen.has(key)) continue;
            seen.add(key);
            collected.push(isVersioned ? [id, generation] : id);
            if (collected.length >= 64) break;
        }
        if (collected.length) cleaned.ci = collected;
    }
    // 自定义皮肤调色板透传（body/beak 为 hex 颜色字符串）
    if (cleaned.skin === 'custom' && state?.palette && typeof state.palette === 'object') {
        const hexRe = /^#[0-9a-fA-F]{6}$/;
        const body = String(state.palette.body || '');
        const beak = String(state.palette.beak || '');
        cleaned.palette = {};
        if (hexRe.test(body)) cleaned.palette.body = body;
        if (hexRe.test(beak)) cleaned.palette.beak = beak;
    }
    // 场景快照透传（房主权威：时钟/事件/物品列表）
    if (state?.scene && typeof state.scene === 'object') {
        const sc = state.scene;
        const num2 = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
        const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : null;
        const allowedItems = ['rock', 'flower', 'grass', 'lily', 'magnet', 'heart'];
        const cleanedItems = Array.isArray(sc.items) ? sc.items.slice(0, MAX_DUO_ITEMS).map(it => {
            if (!Array.isArray(it) || it.length < 4) return null;
            const t = String(it[0]).slice(0, 12);
            if (!allowedItems.includes(t)) return null;
            // 旧格式：[type,x,z,scale] / [type,x,z,scale,fallY]
            // 新格式：[type,x,z,scale,fallY|null,stableId,temporarilyHidden,generation]
            const out = [t, num2(it[1]), num2(it[2]), num2(it[3], 1)];
            const hasFallY = it.length >= 5 && it[4] !== null && it[4] !== undefined && Number.isFinite(Number(it[4]));
            const rawStableId = it.length >= 6 ? Number(it[5]) : NaN;
            const stableId = Number.isSafeInteger(rawStableId) && rawStableId > 0 && rawStableId <= MAX_STABLE_ITEM_ID ? rawStableId : null;
            const rawGeneration = it.length >= 8 ? Number(it[7]) : 0;
            const generation = Number.isSafeInteger(rawGeneration) && rawGeneration >= 0 && rawGeneration <= MAX_STABLE_ITEM_ID ? rawGeneration : 0;
            if (stableId !== null) out.push(hasFallY ? num2(it[4]) : null, stableId, it[6] ? 1 : 0, generation);
            else if (hasFallY) out.push(num2(it[4]));
            return out;
        }).filter(Boolean) : [];
        // 漩涡：房主权威同步（位置 + 缩放）
        const cleanedWhirls = Array.isArray(sc.whirls) ? sc.whirls.slice(0, 60).map(w => {
            if (!Array.isArray(w) || w.length < 3) return null;
            return [num2(w[0]), num2(w[1]), num2(w[2], 1)];
        }).filter(Boolean) : [];
        cleaned.scene = {
            clk: num2(sc.clk),
            evT: num2(sc.evT, 30),
            evN: str(sc.evN, 20),
            evTm: num2(sc.evTm),
            wS: num2(sc.wS, 1),
            wST: num2(sc.wST, 1),
            eWT: num2(sc.eWT, 1),
            ih: num2(sc.ih),
            items: cleanedItems,
            whirls: cleanedWhirls,
            waveDir: Array.isArray(sc.waveDir) && sc.waveDir.length >= 2 ? [num2(sc.waveDir[0]), num2(sc.waveDir[1])] : null,
            waveStr: num2(sc.waveStr),
            waveActive: sc.waveActive ? 1 : 0,
            waveDur: num2(sc.waveDur),
            shark: Array.isArray(sc.shark) && sc.shark.length >= 3 ? [num2(sc.shark[0]), num2(sc.shark[1]), num2(sc.shark[2])] : null,
            windAct: sc.windAct ? 1 : 0,
            windMul: num2(sc.windMul, 1),
            evWindDir: Array.isArray(sc.evWindDir) && sc.evWindDir.length >= 2 ? [num2(sc.evWindDir[0]), num2(sc.evWindDir[1])] : null,
            stormAct: sc.stormAct ? 1 : 0,
            stormBolt: sc.stormBolt && typeof sc.stormBolt === 'object' ? {
                a: sc.stormBolt.a ? 1 : 0,
                s: Number.isSafeInteger(Number(sc.stormBolt.s)) ? Number(sc.stormBolt.s) : -1,
                n: num2(sc.stormBolt.n)
            } : null,
            rbAct: sc.rbAct ? 1 : 0
        };
    }
    return cleaned;
};

const copyDuoScene = (scene, metadataOnly = false) => {
    if (!scene || typeof scene !== 'object') return null;
    const copied = { ...scene };
    if (metadataOnly) {
        delete copied.items;
    } else {
        copied.items = Array.isArray(scene.items) ? scene.items.map(item => Array.isArray(item) ? item.slice() : item) : [];
    }
    // 漩涡不属于 items hash：即使道具列表未变化，漩涡仍会生成、缩放和消失。
    // metadata-only 包也必须显式携带 []，否则客机会永久保留已消失的旧漩涡。
    copied.whirls = Array.isArray(scene.whirls) ? scene.whirls.map(whirl => Array.isArray(whirl) ? whirl.slice() : whirl) : [];
    for (const key of ['waveDir', 'shark', 'evWindDir']) {
        if (Array.isArray(scene[key])) copied[key] = scene[key].slice();
    }
    return copied;
};

const stableDuoItemId = item => {
    const id = Array.isArray(item) && item.length >= 6 ? Number(item[5]) : NaN;
    return Number.isSafeInteger(id) && id > 0 && id <= MAX_STABLE_ITEM_ID ? id : null;
};
const sameDuoItem = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
};
const sameDuoItems = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!sameDuoItem(left[i], right[i])) return false;
    return true;
};
const cleanDuoDeltaItem = raw => {
    const cleaned = cleanDuoState({ scene: { items: [raw] } }).scene?.items;
    return Array.isArray(cleaned) && cleaned.length === 1 ? cleaned[0] : null;
};

const rebuildDuoHostScene = (rawScene, baseScene, currentRev) => {
    if (!rawScene || typeof rawScene !== 'object') return { ok: true, scene: null, mode: null, itemsChanged: false };
    const hasFullItems = Array.isArray(rawScene.items);
    const hasDelta = Object.prototype.hasOwnProperty.call(rawScene, 'itemDelta');
    if (hasFullItems && hasDelta) return { ok: false, status: 400, error: 'INVALID_SCENE_DELTA' };

    // 旧客户端始终上传 items 全量；服务端继续原样接受并建立新的上行版本令牌。
    if (hasFullItems) {
        if (rawScene.items.length > MAX_DUO_ITEMS) return { ok: false, status: 400, error: 'INVALID_SCENE_DELTA' };
        const scene = cleanDuoState({ scene: rawScene }).scene;
        const wantsDeltaAck = Number(rawScene.uploadProtocol) === 2;
        if (wantsDeltaAck) {
            if (scene.items.length !== rawScene.items.length) return { ok: false, status: 400, error: 'INVALID_SCENE_DELTA' };
            const ids = new Set();
            for (let i = 0; i < scene.items.length; i++) {
                const id = stableDuoItemId(scene.items[i]);
                if (id === null || ids.has(id) || !sameDuoItem(scene.items[i], rawScene.items[i])) {
                    return { ok: false, status: 400, error: 'INVALID_SCENE_DELTA' };
                }
                ids.add(id);
            }
        }
        return { ok: true, scene, mode: 'full', ackProtocol: wantsDeltaAck ? 2 : 1, itemsChanged: !baseScene || !sameDuoItems(scene.items, baseScene.items) };
    }

    const baseRev = Number(rawScene.baseRev);
    if (!baseScene || !Array.isArray(baseScene.items) || !Number.isSafeInteger(baseRev) || baseRev <= 0 || baseRev !== currentRev) {
        return { ok: false, status: 409, error: 'SCENE_BASE_MISMATCH' };
    }
    const cleanedScene = cleanDuoState({ scene: rawScene }).scene;
    if (!hasDelta) {
        // metadata-only 仍必须匹配服务端签发的版本；绝不依赖可碰撞的 ih 判断基线。
        cleanedScene.items = baseScene.items;
        return { ok: true, scene: cleanedScene, mode: 'metadata', ackProtocol: 2, itemsChanged: false };
    }

    const delta = rawScene.itemDelta;
    if (!delta || typeof delta !== 'object' || !Array.isArray(delta.upserts) || !Array.isArray(delta.removed)
        || delta.upserts.length > MAX_DUO_ITEMS || delta.removed.length > MAX_DUO_ITEMS) {
        return { ok: false, status: 400, error: 'INVALID_SCENE_DELTA' };
    }
    const byId = new Map();
    for (const item of baseScene.items) {
        const id = stableDuoItemId(item);
        if (id === null || byId.has(id)) return { ok: false, status: 409, error: 'SCENE_BASE_MISMATCH' };
        byId.set(id, item);
    }
    const removed = new Set();
    for (const rawId of delta.removed) {
        const id = Number(rawId);
        if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_STABLE_ITEM_ID || removed.has(id) || !byId.has(id)) {
            return { ok: false, status: 400, error: 'INVALID_SCENE_DELTA' };
        }
        removed.add(id);
    }
    const upserts = new Map();
    for (const raw of delta.upserts) {
        const item = cleanDuoDeltaItem(raw), id = stableDuoItemId(item);
        if (!item || id === null || upserts.has(id) || removed.has(id) || !sameDuoItem(item, raw)) {
            return { ok: false, status: 400, error: 'INVALID_SCENE_DELTA' };
        }
        upserts.set(id, item);
    }
    for (const id of removed) byId.delete(id);
    for (const [id, item] of upserts) byId.set(id, item);
    if (byId.size > MAX_DUO_ITEMS) return { ok: false, status: 400, error: 'INVALID_SCENE_DELTA' };
    cleanedScene.items = Array.from(byId.values());
    return { ok: true, scene: cleanedScene, mode: 'delta', ackProtocol: 2, itemsChanged: !sameDuoItems(cleanedScene.items, baseScene.items) };
};

const copyDuoSceneDelta = (scene, baseScene) => {
    if (!scene || !baseScene || !Array.isArray(scene.items) || !Array.isArray(baseScene.items)) return null;
    const before = new Map();
    for (const item of baseScene.items) {
        const id = stableDuoItemId(item);
        if (id === null || before.has(id)) return null;
        before.set(id, item);
    }
    const currentIds = new Set(), upserts = [];
    for (const item of scene.items) {
        const id = stableDuoItemId(item);
        if (id === null || currentIds.has(id)) return null;
        currentIds.add(id);
        if (!sameDuoItem(before.get(id), item)) upserts.push(item.slice());
    }
    const removed = [];
    for (const id of before.keys()) if (!currentIds.has(id)) removed.push(id);
    const copied = copyDuoScene(scene, true);
    copied.whirls = Array.isArray(scene.whirls) ? scene.whirls.map(whirl => Array.isArray(whirl) ? whirl.slice() : whirl) : [];
    copied.itemDelta = { baseHash: Number(baseScene.ih), upserts, removed };
    return copied;
};

const rememberDuoScene = (room, scene) => {
    const hash = Number(scene?.ih);
    if (!room || !scene || !Number.isFinite(hash)) return;
    if (!(room.sceneHistory instanceof Map)) room.sceneHistory = new Map();
    // cleanDuoState 每次都会生成一棵新的不可变快照，可直接保留引用，避免再复制最多 2048 项数组。
    room.sceneHistory.delete(hash);
    room.sceneHistory.set(hash, scene);
    while (room.sceneHistory.size > DUO_SCENE_HISTORY_LIMIT) room.sceneHistory.delete(room.sceneHistory.keys().next().value);
};

const copyDuoState = (state, { omitScene = false, sceneMetadataOnly = false, sceneDeltaBase = null } = {}) => {
    if (!state || typeof state !== 'object') return state || null;
    const copied = { ...state };
    if (state.palette && typeof state.palette === 'object') copied.palette = { ...state.palette };
    if (Array.isArray(state.ci)) copied.ci = state.ci.map(claim => Array.isArray(claim) ? claim.slice() : claim);
    if (omitScene) delete copied.scene;
    else if (state.scene && typeof state.scene === 'object') {
        copied.scene = sceneDeltaBase ? (copyDuoSceneDelta(state.scene, sceneDeltaBase) || copyDuoScene(state.scene, false)) : copyDuoScene(state.scene, sceneMetadataOnly);
    }
    return copied;
};

const publicDuoPlayer = (player, stateOptions) => player ? ({
    id: player.id,
    name: player.name,
    state: copyDuoState(player.state, stateOptions),
    seq: Number.isSafeInteger(player.seq) && player.seq >= 0 ? player.seq : 0,
    finished: player.finished,
    down: !!player.down,
    downAt: player.downAt || null
}) : null;

const publicDuoRoom = (room, viewer = null, sceneHash) => {
    const hostScene = room.host?.state?.scene;
    const parsedSceneHash = sceneHash === null || sceneHash === undefined || sceneHash === '' ? NaN : Number(sceneHash);
    const hostSceneMetadataOnly = viewer === 'guest' && hostScene && Number.isFinite(parsedSceneHash) && parsedSceneHash === Number(hostScene.ih);
    const hostSceneDeltaBase = viewer === 'guest' && hostScene && Number.isFinite(parsedSceneHash) && !hostSceneMetadataOnly && room.sceneHistory instanceof Map
        ? room.sceneHistory.get(parsedSceneHash) || null
        : null;
    const duoEntry = room.duoEntry ? {
        ...room.duoEntry,
        players: Array.isArray(room.duoEntry.players) ? room.duoEntry.players.map(player => ({ ...player })) : room.duoEntry.players
    } : null;
    return {
        code: room.code,
        round: room.round || 1,
        rev: Number.isSafeInteger(room.rev) && room.rev >= 0 ? room.rev : 0,
        status: room.status,
        host: publicDuoPlayer(room.host, { omitScene: viewer === 'host', sceneMetadataOnly: !!hostSceneMetadataOnly, sceneDeltaBase: hostSceneDeltaBase }),
        guest: publicDuoPlayer(room.guest),
        duoEntry,
        blessing: room.blessing ? { ...room.blessing } : room.blessing
    };
};

const createDuoPlayer = ({ id, name, withSceneRev = false }) => ({
    id,
    name,
    state: cleanDuoState(),
    seq: 0,
    ...(withSceneRev ? { sceneRev: 0 } : {}),
    finished: false,
    final: null,
    down: false,
    downAt: null
});

const createDuoRoom = ({ code, playerId, name, blessing, now = Date.now() }) => ({
    code,
    round: 1,
    rev: 0,
    status: 'waiting',
    blessing: cleanDuoBlessing(blessing),
    host: createDuoPlayer({ id: playerId, name, withSceneRev: true }),
    guest: null,
    createdAt: now,
    updatedAt: now,
    duoEntry: null,
    sceneHistory: new Map()
});

const finishDuoRoom = room => {
    if (room.status === 'finished' || !room.guest) return false;
    const playTime = Math.max(0, Math.floor((Date.now() - (room.startedAt || Date.now())) / 1000));
    for (const player of [room.host, room.guest]) {
        player.down = false;
        player.downAt = null;
        player.finished = true;
        if (!player.final) player.final = { score: player.state.score || 0, playTime };
    }
    room.status = 'finished';
    return true;
};

const resolveDuoRespawn = room => {
    if (room.status !== 'running' || !room.guest) return false;
    const players = [room.host, room.guest];
    const downPlayers = players.filter(player => player.down);
    if (downPlayers.length > 1) return finishDuoRoom(room);
    if (downPlayers.length !== 1) return false;
    const downPlayer = downPlayers[0];
    if (Date.now() - (downPlayer.downAt || Date.now()) < 10000) return false;
    const partner = players.find(player => player !== downPlayer);
    const side = downPlayer === room.host ? -1 : 1;
    // ci 是一次性拾取声明，不能随 10 秒后的复活 seq 再次广播，否则同一稳定 ID 会被重复收集。
    const { ci: _consumedCollections, ...respawnState } = downPlayer.state || {};
    downPlayer.state = { ...respawnState, x: partner.state.x + side * 1.25, y: partner.state.y, z: partner.state.z + side * .8, ry: partner.state.ry, hearts: 1 };
    downPlayer.down = false;
    downPlayer.downAt = null;
    bumpPlayerSeq(downPlayer);
    return true;
};

const findDuoPlayer = (room, playerId, reqRole) => {
    let player = null;
    if (reqRole === 'host' && room.host.id === playerId) player = room.host;
    else if (reqRole === 'guest' && room.guest && room.guest.id === playerId) player = room.guest;
    else player = room.host.id === playerId ? room.host : room.guest?.id === playerId ? room.guest : null;
    const viewer = player === room.host ? 'host' : player === room.guest ? 'guest' : null;
    return { player, viewer };
};

/**
 * 应用一条房间动作。
 * @param {object} room 房间状态（会被原地修改）
 * @param {object} data 客户端载荷 {action, playerId, name, role, sceneHash, ...}
 * @returns {{status:number, payload:object, viewer:string|null, sceneAck:object|null, finished:boolean, changed:boolean}}
 *   finished=true 表示本动作让房间进入 finished，调用方需要落榜。
 */
const applyDuoAction = (room, data) => {
    const result = { status: 200, payload: { ok: true }, viewer: null, sceneAck: null, finished: false, changed: false, raw: false };
    const statusBefore = room.status;
    const fail = (status, error) => {
        result.status = status;
        result.payload = { ok: false, error };
        return result;
    };
    const action = safeText(data.action, 16);
    const playerId = safeText(data.playerId, 80);
    const name = safeText(data.name, 12);
    if (!playerId) return fail(400, 'PLAYER_REQUIRED');

    const reqRole = safeText(data.role, 5);
    let { player, viewer } = findDuoPlayer(room, playerId, reqRole);
    result.viewer = viewer;

    let sceneAck = null;
    if (action === 'join') {
        // 同一浏览器的两个标签页共享 localStorage playerId。客机刷新后 role 尚未恢复，
        // join 的语义仍是恢复 guest 席位，不能因 fallback 先命中 host 而串号。
        if (reqRole !== 'host' && room.guest?.id === playerId) {
            player = room.guest;
            viewer = 'guest';
        }
        if (!name) return fail(400, 'NAME_REQUIRED');
        if (!room.guest) {
            room.guest = createDuoPlayer({ id: playerId, name });
            room.status = 'ready';
            player = room.guest;
            viewer = 'guest';
        } else if (!player) {
            return fail(409, 'ROOM_FULL');
        }
    }
    if (!player) return fail(403, 'NOT_IN_ROOM');
    viewer = player === room.host ? 'host' : 'guest';
    result.viewer = viewer;

    if (action === 'start') {
        if (player !== room.host || !room.guest) return fail(409, 'WAITING_FOR_FRIEND');
        room.status = 'running';
        room.startedAt = Date.now();
    } else if (action === 'restart') {
        if (player !== room.host) return fail(403, 'ONLY_HOST_CAN_RESTART');
        if (!room.guest || room.status !== 'finished') return fail(409, 'WAITING_FOR_FRIEND');
        room.round = (room.round || 1) + 1;
        room.status = 'running';
        room.startedAt = Date.now();
        room.duoEntry = null;
        room.sceneHistory = new Map();
        // sceneRev 在同一房间生命周期内保持单调，避免上一局延迟 delta 在新一局复用相同 token。
        for (const member of [room.host, room.guest]) {
            member.state = cleanDuoState();
            member.finished = false;
            member.final = null;
            member.down = false;
            member.downAt = null;
            bumpPlayerSeq(member);
        }
    } else if (action === 'state') {
        if (room.status !== 'running') return fail(409, 'ROOM_NOT_RUNNING');
        const nextState = cleanDuoState(data.state);
        if (player === room.host) {
            const currentSceneRev = Number.isSafeInteger(player.sceneRev) && player.sceneRev >= 0 ? player.sceneRev : 0;
            const rebuilt = rebuildDuoHostScene(data.state?.scene, player.state?.scene, currentSceneRev);
            if (!rebuilt.ok) {
                // 场景协议错误与普通业务错误不同：不推进房间 rev、不附带房间快照，
                // 客户端据此丢弃本地基线并重传全量。
                result.status = rebuilt.status;
                result.payload = { ok: false, error: rebuilt.error, expectedSceneRev: currentSceneRev };
                result.raw = true;
                return result;
            }
            rememberDuoScene(room, player.state?.scene);
            if (rebuilt.scene) {
                // ih 是客机下行的道具版本：仅 items 实际变化时递增，不信任房主提供的可碰撞哈希。
                player.sceneRev = currentSceneRev > 0 && !rebuilt.itemsChanged ? currentSceneRev : nextSyncCounter(currentSceneRev);
                rebuilt.scene.ih = player.sceneRev;
                nextState.scene = rebuilt.scene;
                sceneAck = { protocol: rebuilt.ackProtocol || 1, rev: player.sceneRev, mode: rebuilt.mode };
            } else if (player.state?.scene) nextState.scene = player.state.scene;
            rememberDuoScene(room, nextState.scene);
        }
        player.state = nextState;
        bumpPlayerSeq(player);
    } else if (action === 'profile') {
        // 大厅阶段也允许同步皮肤/调色板，避免开局前看不到对方皮肤
        const skin = DUCK_SKIN_IDS.has(data?.skin) ? data.skin : 'classic';
        player.state = player.state || cleanDuoState();
        player.state.skin = skin;
        if (skin === 'custom' && data?.palette && typeof data.palette === 'object') {
            const hexRe = /^#[0-9a-fA-F]{6}$/;
            const body = String(data.palette.body || '');
            const beak = String(data.palette.beak || '');
            const pal = {};
            if (hexRe.test(body)) pal.body = body;
            if (hexRe.test(beak)) pal.beak = beak;
            if (pal.body && pal.beak) player.state.palette = pal; else { player.state.skin = 'classic'; delete player.state.palette; }
        } else {
            delete player.state.palette;
        }
        // profile 只更新外观；不得把上一次 state 中的一次性拾取声明用新 seq 重放。
        delete player.state.ci;
        bumpPlayerSeq(player);
    } else if (action === 'down') {
        if (room.status !== 'running') return fail(409, 'ROOM_NOT_RUNNING');
        const nextState = cleanDuoState(data.state);
        // down 只更新玩家状态；即使旧/异常客户端夹带 scene，也不得绕过上行版本校验覆盖权威场景。
        if (player === room.host) {
            if (player.state?.scene) nextState.scene = player.state.scene;
            else delete nextState.scene;
            rememberDuoScene(room, nextState.scene);
        }
        player.state = nextState;
        player.down = true;
        player.downAt = Date.now();
        bumpPlayerSeq(player);
    } else if (action === 'finish') {
        if (room.status === 'waiting' || room.status === 'ready') return fail(409, 'ROOM_NOT_RUNNING');
        player.finished = true;
        player.final = { score: Math.max(0, Math.floor(Number(data.score) || 0)), playTime: Math.max(0, Math.floor(Number(data.playTime) || 0)) };
        if (room.host.finished && room.guest?.finished) {
            room.status = 'finished';
            result.finished = true;
        }
    } else if (action !== 'status' && action !== 'join') {
        return fail(400, 'UNKNOWN_ACTION');
    }

    if (name && name !== player.name) player.name = name;
    if (resolveDuoRespawn(room)) result.changed = true;
    // 双倒地会由 resolveDuoRespawn 直接结束对局，调用方需要据此落榜。
    if (room.status === 'finished' && statusBefore !== 'finished') result.finished = true;
    result.sceneAck = sceneAck;
    result.payload = { ok: true, role: viewer, ...(sceneAck ? { sceneAck } : {}) };
    return result;
};

/**
 * 错误码 → HTTP 状态码（HTTP 通道使用；WebSocket 只用错误码）。
 */
const statusForError = error => {
    switch (error) {
        case 'NAME_REQUIRED':
        case 'PLAYER_REQUIRED':
        case 'INVALID_JSON':
        case 'UNKNOWN_ACTION':
        case 'INVALID_SCENE_DELTA':
            return 400;
        case 'ROOM_NOT_FOUND':
            return 404;
        case 'NOT_IN_ROOM':
            return 403;
        case 'ROOM_FULL':
        case 'WAITING_FOR_FRIEND':
        case 'ONLY_HOST_CAN_RESTART':
        case 'ROOM_NOT_RUNNING':
        case 'SCENE_BASE_MISMATCH':
            return 409;
        case 'SERVER_BUSY':
            return 503;
        default:
            return 500;
    }
};

module.exports = {
    MAX_STABLE_ITEM_ID,
    MAX_DUO_ITEMS,
    DUO_SCENE_HISTORY_LIMIT,
    DUCK_SKIN_IDS,
    DUO_BLESSINGS,
    safeText,
    nextSyncCounter,
    bumpPlayerSeq,
    bumpRoomRev,
    cleanDuoBlessing,
    cleanDuoState,
    copyDuoScene,
    copyDuoSceneDelta,
    stableDuoItemId,
    sameDuoItem,
    sameDuoItems,
    cleanDuoDeltaItem,
    rebuildDuoHostScene,
    rememberDuoScene,
    copyDuoState,
    publicDuoPlayer,
    publicDuoRoom,
    createDuoPlayer,
    createDuoRoom,
    finishDuoRoom,
    resolveDuoRespawn,
    findDuoPlayer,
    applyDuoAction,
    statusForError
};
