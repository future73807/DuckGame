// ============================================================
// 热铁盒 WebSocket 云函数：双人同行实时通道
// ============================================================
// 端点：wss://<你的域名>/ws.node.js
// 客户端：new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws.node.js')
//
// 设计要点
// 1. 热铁盒的 WebSocket 每次事件都是独立调用，跨事件不能靠模块级变量，
//    因此房间状态全部落 KV 数据库（Database），按 key 拆分以避开单值 65535 上限。
// 2. 消息协议与 HTTP 版完全一致：客户端发 {action,...}，服务端回
//    {msgId, ok, room, sceneAck, role}，msgId 原样带回用于多路复用。
// 3. 房间规则来自 duo-core.node.js / duo-ws-service.node.js，
//    与本地 server.node.js 共用同一套实现，避免两条通道行为漂移。
// 4. 同一文件也接受普通 HTTP 请求（websocket 为 null）：GET 返回房间快照，
//    POST 返回与 WebSocket 相同的 JSON，便于不支持 ws 的环境回退。
// ============================================================
'use strict';

const core = (() => {
    try { return require('duo-core.node.js'); } catch (error) { return require('./duo-core.node.js'); }
})();
const { createDuoService } = (() => {
    try { return require('duo-ws-service.node.js'); } catch (error) { return require('./duo-ws-service.node.js'); }
})();

const hasSocket = typeof websocket !== 'undefined' && websocket;
const store = createStore();
const service = createDuoService({ store, saveEntry: buildDuoEntry });

if (hasSocket) {
    websocket.on('open', () => {
        websocket.send(JSON.stringify({ type: 'ready' }));
    });

    websocket.on('message', async raw => {
        let data;
        try { data = JSON.parse(raw); } catch (error) { data = null; }
        if (!data || typeof data !== 'object') {
            websocket.send(JSON.stringify({ ok: false, error: 'INVALID_JSON' }));
            return;
        }
        const msgId = Number.isSafeInteger(data.msgId) ? data.msgId : null;
        let payload;
        try {
            payload = await service.handle(data);
        } catch (error) {
            payload = { ok: false, error: 'SERVER_ERROR' };
        }
        if (msgId !== null) payload.msgId = msgId;
        websocket.send(JSON.stringify(payload));
    });

    websocket.on('close', () => {});

    websocket.on('error', error => {
        try { console.log(error.message); } catch (ignored) {}
    });
} else {
    // 普通 HTTP 请求：与 WebSocket 走同一套房间逻辑。
    const method = String(req.method || 'GET').toUpperCase();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
        res.status(204);
        res.end();
    } else if (method === 'GET') {
        const query = req.query || {};
        const room = query.room;
        if (!room) {
            res.status(426);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('请使用 WebSocket 连接 /ws.node.js');
        } else {
            service.peek(room).then(snapshot => {
                if (!snapshot) { res.status(404); res.json({ ok: false, error: 'ROOM_NOT_FOUND' }); return; }
                res.json({ ok: true, room: snapshot });
            }).catch(() => {
                res.status(500);
                res.json({ ok: false, error: 'SERVER_ERROR' });
            });
        }
    } else if (method === 'POST') {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (error) { body = null; }
        }
        if (!body || typeof body !== 'object') {
            res.status(400);
            res.json({ ok: false, error: 'INVALID_JSON' });
        } else {
            service.handle(body).then(payload => {
                res.status(payload.ok ? 200 : core.statusForError(payload.error));
                res.json(payload);
            }).catch(() => {
                res.status(500);
                res.json({ ok: false, error: 'SERVER_ERROR' });
            });
        }
    } else {
        res.status(405);
        res.json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
    }
}

// ---------- 排行榜落库（双人榜，与 HTTP 版共用 leaderboard.json） ----------
function buildDuoEntry(room) {
    if (room.duoEntry) return room.duoEntry;
    if (!room.host?.finished || !room.guest?.finished || !room.guest?.final) return null;
    const players = [room.host, room.guest].map(player => ({
        userId: player.id,
        name: player.name,
        score: player.final.score,
        playTime: player.final.playTime
    }));
    const entry = {
        id: 'duo-' + room.code + '-' + (room.round || 1),
        roomId: room.code + '-' + (room.round || 1),
        players,
        name: players.map(player => player.name).join(' & '),
        score: players.reduce((total, player) => total + player.score, 0),
        playTime: Math.max(...players.map(player => player.playTime)),
        ts: Date.now()
    };
    let data = { entries: [], duoEntries: [] };
    try { data = JSON.parse(fs.readFileSync('leaderboard.json', 'utf8')); } catch (error) {}
    if (!Array.isArray(data.entries)) data.entries = [];
    if (!Array.isArray(data.duoEntries)) data.duoEntries = [];
    data.duoEntries = data.duoEntries.filter(item => item?.roomId !== room.code);
    data.duoEntries.push(entry);
    data.duoEntries.sort((a, b) => (b.score || 0) - (a.score || 0) || (a.playTime || 0) - (b.playTime || 0));
    data.duoEntries = data.duoEntries.slice(0, 50);
    try { fs.writeFileSync('leaderboard.json', JSON.stringify(data, null, 2)); } catch (error) {}
    room.duoEntry = entry;
    return entry;
}

/**
 * 存储后端：热铁盒内置 KV 数据库（Database 全局对象）。
 * 写入值统一转字符串，单值上限由 duo-ws-service 的体积预算控制。
 */
function createStore() {
    // 热铁盒提供全局 Database；本地调试没有时回退到同站文本文件。
    if (typeof Database === 'undefined') {
        const FILE = 'duo-rooms.json';
        const readAll = () => {
            try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (error) { return {}; }
        };
        const writeAll = data => {
            try { fs.writeFileSync(FILE, JSON.stringify(data)); } catch (error) {}
        };
        return {
            async get(key) { const all = readAll(); return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null; },
            async set(key, value) { const all = readAll(); all[key] = value; writeAll(all); },
            async delete(key) { const all = readAll(); delete all[key]; writeAll(all); }
        };
    }
    const db = new Database('duo');
    return {
        async get(key) {
            const value = await db.get(key);
            return value === undefined ? null : value;
        },
        async set(key, value) {
            await db.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        },
        async delete(key) {
            await db.delete(key);
        }
    };
}
