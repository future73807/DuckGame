// ============================================================
// 双人同行 WebSocket 服务层（存储无关）
// ============================================================
// 被 ws.node.js（热铁盒 KV 存储）与 server.node.js（本地内存存储）共用，
// 保证 WebSocket 与 HTTP 轮询两条通道的房间语义完全一致。
//
// 存储契约（store）：
//   await store.get(key)        → 对象 / JSON 字符串 / null
//   await store.set(key, value) → value 为普通对象，由 store 自行序列化
// 房间按 key 拆分存储，避免单个 KV 值超过热铁盒 65535 字符上限：
//   room-<code>          房间元信息（状态/轮次/版本/祝福/客机 id）
//   player-<code>-host   房主数据
//   player-<code>-guest  客机数据
//   history-<code>       客机增量下发用的场景历史（按体积预算裁剪）
// 注意：热铁盒 KV 的键名只允许 ASCII 字母、数字、下划线和连字符，不能使用冒号分隔。
// ============================================================
'use strict';

const core = (() => {
    try { return require('duo-core.node.js'); } catch (error) { return require('./duo-core.node.js'); }
})();

const ROOM_TTL = 30 * 60 * 1000;
// 热铁盒 KV 单值上限 65535；留出 JSON 包装余量。
const DEFAULT_VALUE_BUDGET = 60000;
const DEFAULT_HISTORY_BUDGET = 56000;
const MAX_HISTORY_ENTRIES = 12;

const readValue = async (store, key) => {
    const raw = await store.get(key);
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch (error) { return null; }
    }
    return raw;
};

const metaOf = room => ({
    code: room.code,
    round: room.round || 1,
    rev: Number.isSafeInteger(room.rev) && room.rev >= 0 ? room.rev : 0,
    status: room.status,
    blessing: room.blessing || null,
    createdAt: room.createdAt || 0,
    updatedAt: room.updatedAt || 0,
    startedAt: room.startedAt || 0,
    duoEntry: room.duoEntry || null,
    guestId: room.guest?.id || null
});

const playerOf = player => player ? {
    id: player.id,
    name: player.name,
    state: player.state,
    seq: player.seq,
    sceneRev: Number.isSafeInteger(player.sceneRev) ? player.sceneRev : 0,
    finished: !!player.finished,
    final: player.final || null,
    down: !!player.down,
    downAt: player.downAt || null,
    touchedAt: player.touchedAt || 0
} : null;

// 热铁盒 KV 的键名只允许 ASCII 字母、数字、下划线和连字符。
// 本地内存存储不会拒绝非法字符，只有线上 KV 才会报错，因此这里统一拦截，
// 让这类问题在本地回归里就暴露出来，而不是部署后才炸。
const LEGAL_KEY = /^[A-Za-z0-9_-]+$/;
const makeKey = parts => {
    const key = parts.join('-');
    if (!LEGAL_KEY.test(key)) throw new Error('ILLEGAL_STORAGE_KEY: ' + key);
    return key;
};
// 房间号固定 6 位数字（generateCode 生成），先校验格式再拼 key。
const ROOM_CODE = /^[0-9]{6}$/;
const normalizeCode = raw => {
    const code = core.safeText(raw, 6).toUpperCase();
    return ROOM_CODE.test(code) ? code : null;
};

/**
 * @param {object} options
 * @param {object} options.store            存储实现
 * @param {Function} [options.saveEntry]    房间结算落榜（(room) => entry|null）
 * @param {number} [options.valueBudget]    单值体积上限（Infinity 表示不限制）
 * @param {number} [options.historyBudget]  场景历史总体积上限
 */
function createDuoService({ store, saveEntry = () => null, valueBudget = DEFAULT_VALUE_BUDGET, historyBudget = DEFAULT_HISTORY_BUDGET }) {
    const keyRoom = code => makeKey(['room', code]);
    const keyPlayer = (code, role) => makeKey(['player', code, role]);
    const keyHistory = code => makeKey(['history', code]);

    const write = async (key, value) => {
        if (Number.isFinite(valueBudget) && JSON.stringify(value).length > valueBudget) return false;
        await store.set(key, value);
        return true;
    };

    const loadRoom = async code => {
        const meta = await readValue(store, keyRoom(code));
        if (!meta) return null;
        const host = await readValue(store, keyPlayer(code, 'host'));
        if (!host) return null;
        const guest = meta.guestId ? await readValue(store, keyPlayer(code, 'guest')) : null;
        const newest = Math.max(meta.updatedAt || 0, host.touchedAt || 0, guest?.touchedAt || 0);
        if (Date.now() - newest > ROOM_TTL) return null;
        const sceneHistory = new Map();
        const history = await readValue(store, keyHistory(code));
        if (Array.isArray(history)) {
            for (const entry of history) {
                if (!Array.isArray(entry) || entry.length < 2) continue;
                const ih = Number(entry[0]);
                if (!Number.isFinite(ih) || !Array.isArray(entry[1])) continue;
                sceneHistory.set(ih, { ih, items: entry[1] });
            }
        }
        const room = {
            code: meta.code,
            round: meta.round || 1,
            rev: meta.rev || 0,
            status: meta.status,
            blessing: meta.blessing || null,
            createdAt: meta.createdAt || 0,
            updatedAt: newest,
            startedAt: meta.startedAt || 0,
            duoEntry: meta.duoEntry || null,
            host: {
                id: host.id,
                name: host.name,
                state: host.state || core.cleanDuoState(),
                seq: host.seq || 0,
                sceneRev: Number.isSafeInteger(host.sceneRev) ? host.sceneRev : 0,
                finished: !!host.finished,
                final: host.final || null,
                down: !!host.down,
                downAt: host.downAt || null,
                touchedAt: host.touchedAt || 0
            },
            guest: guest ? {
                id: guest.id,
                name: guest.name,
                state: guest.state || core.cleanDuoState(),
                seq: guest.seq || 0,
                finished: !!guest.finished,
                final: guest.final || null,
                down: !!guest.down,
                downAt: guest.downAt || null,
                touchedAt: guest.touchedAt || 0
            } : null,
            sceneHistory
        };
        return { room, meta };
    };

    const saveHistory = async room => {
        if (!(room.sceneHistory instanceof Map) || !room.sceneHistory.size) return;
        const entries = [];
        let size = 0;
        const source = Array.from(room.sceneHistory.entries()).slice(-MAX_HISTORY_ENTRIES).reverse();
        for (const [ih, scene] of source) {
            if (!Array.isArray(scene?.items)) continue;
            const compact = [ih, scene.items];
            const entrySize = JSON.stringify(compact).length;
            if (size + entrySize > historyBudget) break;
            entries.unshift(compact);
            size += entrySize;
        }
        if (entries.length) await write(keyHistory(room.code), entries);
    };

    // 场景道具超出单值上限时降级为 metadata；房主下个 delta 会因 baseRev 失配自动重传全量，可自愈。
    const savePlayer = async (code, role, player, { keepSceneItems = true } = {}) => {
        const value = playerOf(player);
        if (!keepSceneItems && value?.state?.scene) {
            const scene = { ...value.state.scene };
            delete scene.items;
            value.state = { ...value.state, scene };
        }
        const ok = await write(keyPlayer(code, role), value);
        if (!ok && keepSceneItems) return savePlayer(code, role, player, { keepSceneItems: false });
        return ok;
    };

    const saveRoom = async (room, flags = {}) => {
        await write(keyRoom(room.code), metaOf(room));
        if (flags.hostChanged) await savePlayer(room.code, 'host', room.host);
        if (flags.guestChanged && room.guest) await savePlayer(room.code, 'guest', room.guest);
        if (flags.historyChanged) await saveHistory(room);
    };

    const allocateCode = async () => {
        for (let i = 0; i < 8; i++) {
            const code = String(Math.floor(100000 + Math.random() * 900000));
            if (!await store.get(keyRoom(code))) return code;
        }
        return null;
    };

    /**
     * 处理一条客户端消息（HTTP POST 与 WebSocket 共用）。
     * @param {object} data 客户端载荷
     * @returns {Promise<object>} 直接回给客户端的载荷
     */
    const handle = async data => {
        const action = core.safeText(data.action, 16);
        const playerId = core.safeText(data.playerId, 80);
        if (!playerId) return { ok: false, error: 'PLAYER_REQUIRED' };

        if (action === 'create') {
            const name = core.safeText(data.name, 12);
            if (!name) return { ok: false, error: 'NAME_REQUIRED' };
            const code = await allocateCode();
            if (!code) return { ok: false, error: 'SERVER_BUSY' };
            const now = Date.now();
            const room = core.createDuoRoom({ code, playerId, name, blessing: data.blessing, now });
            room.host.touchedAt = now;
            await write(keyRoom(code), metaOf(room));
            await savePlayer(code, 'host', room.host);
            return { ok: true, role: 'host', room: core.publicDuoRoom(room, 'host', data.sceneHash) };
        }

        const code = normalizeCode(data.room);
        if (!code) return { ok: false, error: 'ROOM_NOT_FOUND' };
        const loaded = await loadRoom(code);
        if (!loaded) return { ok: false, error: 'ROOM_NOT_FOUND' };
        const { room } = loaded;

        const hostBefore = JSON.stringify(playerOf(room.host));
        const guestBefore = room.guest ? JSON.stringify(playerOf(room.guest)) : null;
        const sceneRevBefore = room.host.sceneRev;

        const result = core.applyDuoAction(room, data);

        // 场景协议错误：不推进 rev、不附带房间快照，客户端据此丢弃基线重传全量。
        if (!result.payload.ok) {
            if (result.viewer && !result.raw) {
                return { ...result.payload, room: core.publicDuoRoom(room, result.viewer, data.sceneHash) };
            }
            return { ...result.payload };
        }

        if (result.finished) saveEntry(room);
        const now = Date.now();
        room.updatedAt = now;
        room.host.touchedAt = now;
        if (room.guest) room.guest.touchedAt = now;
        core.bumpRoomRev(room);
        await saveRoom(room, {
            hostChanged: JSON.stringify(playerOf(room.host)) !== hostBefore,
            guestChanged: !!room.guest && JSON.stringify(playerOf(room.guest)) !== guestBefore,
            historyChanged: room.host.sceneRev !== sceneRevBefore
        });
        return { ...result.payload, room: core.publicDuoRoom(room, result.viewer, data.sceneHash) };
    };

    /** 只读房间快照（HTTP GET 兼容路径）。 */
    const peek = async code => {
        const normalized = normalizeCode(code);
        if (!normalized) return null;
        const loaded = await loadRoom(normalized);
        if (!loaded) return null;
        const { room } = loaded;
        if (core.resolveDuoRespawn(room)) {
            if (room.status === 'finished') saveEntry(room);
            core.bumpRoomRev(room);
            room.updatedAt = Date.now();
            await saveRoom(room, { hostChanged: true, guestChanged: true });
        }
        return core.publicDuoRoom(room);
    };

    return { handle, peek, loadRoom };
}

module.exports = { createDuoService, ROOM_TTL, DEFAULT_VALUE_BUDGET, DEFAULT_HISTORY_BUDGET, LEGAL_KEY, ROOM_CODE, makeKey, normalizeCode };
