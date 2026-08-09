// ============================================================
// 小黄鸭漂流记 - 排行榜后端（双模式）
// ============================================================
// 模式 1：热铁盒云函数（线上部署）
//   将此文件上传到热铁盒网页托管，自动作为云函数运行
//   API 端点：api.node.js（GET 读取 / POST 写入）
//
// 模式 2：Node.js 本地服务器（本地开发）
//   命令：node server.node.js
//   访问：http://localhost:8123
//   API 端点：/api/leaderboard（GET 读取 / POST 写入）
//   同时提供静态文件服务（3d-duck.html 等）
// ============================================================

// ===== 模式检测 =====
// 热铁盒环境：全局有 req/res/fs 对象
// Node 环境：需要 require('http') 等
const isHotFe = typeof req !== 'undefined';

if (isHotFe) {
    // ===== 热铁盒云函数模式 =====
    if (req.method === 'POST') {
        var data = req.body;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch(e) { data = null; }
        }
        if (!data || !Array.isArray(data.entries)) {
            res.status(400);
            res.json({ ok: false, error: 'Invalid format' });
        } else {
            fs.writeFileSync('leaderboard.json', JSON.stringify(data, null, 2));
            res.json({ ok: true });
        }
    } else {
        if (fs.existsSync('leaderboard.json')) {
            var content = fs.readFileSync('leaderboard.json');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(content);
        } else {
            res.json({ entries: [] });
        }
    }
} else {
    // ===== Node.js 本地服务器模式 =====
    const http = require('http');
    const fs2 = require('fs');
    const path = require('path');
    const PORT = process.env.PORT || 8123;
    const ROOT = __dirname;
    const MIME = {
        '.html': 'text/html; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.glb': 'model/gltf-binary'
    };

    // ===== 双人同行房间（内存实时状态） =====
    // 房间仅保存短时对局状态；结算后的双人榜会写入 leaderboard.json。
    const duoRooms = new Map();
    const DUO_ROOM_TTL = 30 * 60 * 1000;
    const duoRoomCode = () => {
        let code = '';
        do {
            code = String(Math.floor(100000 + Math.random() * 900000));
        } while (duoRooms.has(code));
        return code;
    };
    const safeText = (value, max = 18) => String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
    const MAX_STABLE_ITEM_ID = 0x7fffffff;
    const MAX_DUO_ITEMS = 1200;
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
            delete copied.whirls;
        } else {
            copied.items = Array.isArray(scene.items) ? scene.items.map(item => Array.isArray(item) ? item.slice() : item) : [];
            copied.whirls = Array.isArray(scene.whirls) ? scene.whirls.map(whirl => Array.isArray(whirl) ? whirl.slice() : whirl) : [];
        }
        for (const key of ['waveDir', 'shark', 'evWindDir']) {
            if (Array.isArray(scene[key])) copied[key] = scene[key].slice();
        }
        return copied;
    };
    const DUO_SCENE_HISTORY_LIMIT = 12;
    const stableDuoItemId = item => {
        const id = Array.isArray(item) && item.length >= 6 ? Number(item[5]) : NaN;
        return Number.isSafeInteger(id) && id > 0 && id <= MAX_STABLE_ITEM_ID ? id : null;
    };
    const sameDuoItem = (left, right) => {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
        return true;
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
        // cleanDuoState 每次都会生成一棵新的不可变快照，可直接保留引用，避免再复制最多 1200 项数组。
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
    const saveDuoEntry = room => {
        if (room.duoEntry || !room.host.finished || !room.guest?.finished) return room.duoEntry || null;
        let data = { entries: [], duoEntries: [] };
        try { data = JSON.parse(fs2.readFileSync(path.join(ROOT, 'leaderboard.json'), 'utf8')); } catch (e) {}
        if (!Array.isArray(data.entries)) data.entries = [];
        if (!Array.isArray(data.duoEntries)) data.duoEntries = [];
        const players = [room.host, room.guest].map(player => ({
            userId: player.id,
            name: player.name,
            score: player.final.score,
            playTime: player.final.playTime
        }));
        room.duoEntry = {
            id: 'duo-' + room.code + '-' + (room.round || 1),
            roomId: room.code + '-' + (room.round || 1),
            players,
            name: players.map(player => player.name).join(' & '),
            score: players.reduce((total, player) => total + player.score, 0),
            playTime: Math.max(...players.map(player => player.playTime)),
            ts: Date.now()
        };
        data.duoEntries = data.duoEntries.filter(entry => entry?.roomId !== room.code);
        data.duoEntries.push(room.duoEntry);
        data.duoEntries.sort((a, b) => (b.score || 0) - (a.score || 0) || (a.playTime || 0) - (b.playTime || 0));
        data.duoEntries = data.duoEntries.slice(0, 50);
        fs2.writeFileSync(path.join(ROOT, 'leaderboard.json'), JSON.stringify(data, null, 2), 'utf8');
        return room.duoEntry;
    };
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
        saveDuoEntry(room);
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
    const pruneDuoRooms = () => {
        const now = Date.now();
        for (const [code, room] of duoRooms) {
            if (now - room.updatedAt > DUO_ROOM_TTL) duoRooms.delete(code);
        }
    };
    const sendDuoJson = (res, status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(payload));
    };
    const sendKnownDuoJson = (res, status, payload, room, viewer, sceneHash, advanceRev = true) => {
        // POST 房间快照都带唯一递增版本，客户端可安全丢弃后到达的旧响应。
        if (advanceRev) bumpRoomRev(room);
        return sendDuoJson(res, status, { ...payload, room: publicDuoRoom(room, viewer, sceneHash) });
    };
    const handleDuo = (req, res, url) => {
        pruneDuoRooms();
        if (req.method === 'GET') {
            const code = safeText(url.searchParams.get('room'), 6).toUpperCase();
            const room = duoRooms.get(code);
            if (!room) return sendDuoJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
            if (resolveDuoRespawn(room)) {
                bumpRoomRev(room);
                room.updatedAt = Date.now();
            }
            // 旧 GET 客户端没有 viewer/sceneHash，继续返回完整快照以保持兼容。
            return sendDuoJson(res, 200, { ok: true, room: publicDuoRoom(room) });
        }
        if (req.method !== 'POST') return sendDuoJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 256000) { res.writeHead(413); res.end(); req.destroy(); }
        });
        req.on('end', () => {
            let data;
            try { data = JSON.parse(body || '{}'); } catch (e) { return sendDuoJson(res, 400, { ok: false, error: 'INVALID_JSON' }); }
            const action = safeText(data.action, 16);
            const playerId = safeText(data.playerId, 80);
            const name = safeText(data.name, 12);
            if (!playerId) return sendDuoJson(res, 400, { ok: false, error: 'PLAYER_REQUIRED' });
            if (action === 'create') {
                if (!name) return sendDuoJson(res, 400, { ok: false, error: 'NAME_REQUIRED' });
                const code = duoRoomCode();
                const room = { code, round: 1, rev: 0, status: 'waiting', blessing: cleanDuoBlessing(data.blessing), host: { id: playerId, name, state: cleanDuoState(), seq: 0, finished: false, final: null, down: false, downAt: null }, guest: null, createdAt: Date.now(), updatedAt: Date.now(), duoEntry: null, sceneHistory: new Map() };
                duoRooms.set(code, room);
                return sendKnownDuoJson(res, 200, { ok: true, role: 'host' }, room, 'host', data.sceneHash, false);
            }
            const code = safeText(data.room, 6).toUpperCase();
            const room = duoRooms.get(code);
            if (!room) return sendDuoJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
            // 优先使用请求中的 role 字段区分 host/guest（防止同一 playerId 同时是 host 和 guest，例如同浏览器多标签页测试）
            const reqRole = safeText(data.role, 5);
            let player = null;
            if (reqRole === 'host' && room.host.id === playerId) player = room.host;
            else if (reqRole === 'guest' && room.guest && room.guest.id === playerId) player = room.guest;
            else player = room.host.id === playerId ? room.host : room.guest?.id === playerId ? room.guest : null;
            let viewer = player === room.host ? 'host' : player === room.guest ? 'guest' : null;
            const respondKnown = (status, payload) => {
                if (!viewer) return sendDuoJson(res, status, payload);
                room.updatedAt = Date.now();
                return sendKnownDuoJson(res, status, payload, room, viewer, data.sceneHash);
            };
            if (action === 'join') {
                // 同一浏览器的两个标签页共享 localStorage playerId。客机刷新后 role 尚未恢复，
                // join 的语义仍是恢复 guest 席位，不能因 fallback 先命中 host 而串号。
                if (reqRole !== 'host' && room.guest?.id === playerId) {
                    player = room.guest;
                    viewer = 'guest';
                }
                if (!name) return respondKnown(400, { ok: false, error: 'NAME_REQUIRED' });
                if (!room.guest) {
                    room.guest = { id: playerId, name, state: cleanDuoState(), seq: 0, finished: false, final: null, down: false, downAt: null };
                    room.status = 'ready';
                    player = room.guest;
                    viewer = 'guest';
                } else if (!player) {
                    return sendDuoJson(res, 409, { ok: false, error: 'ROOM_FULL' });
                }
            }
            if (!player) return sendDuoJson(res, 403, { ok: false, error: 'NOT_IN_ROOM' });
            viewer = player === room.host ? 'host' : 'guest';
            if (name && name !== player.name) player.name = name;
            if (action === 'start') {
                if (player !== room.host || !room.guest) return respondKnown(409, { ok: false, error: 'WAITING_FOR_FRIEND' });
                room.status = 'running';
                room.startedAt = Date.now();
            } else if (action === 'restart') {
                if (player !== room.host) return respondKnown(403, { ok: false, error: 'ONLY_HOST_CAN_RESTART' });
                if (!room.guest || room.status !== 'finished') return respondKnown(409, { ok: false, error: 'WAITING_FOR_FRIEND' });
                room.round = (room.round || 1) + 1;
                room.status = 'running';
                room.startedAt = Date.now();
                room.duoEntry = null;
                room.sceneHistory = new Map();
                for (const member of [room.host, room.guest]) {
                    member.state = cleanDuoState();
                    member.finished = false;
                    member.final = null;
                    member.down = false;
                    member.downAt = null;
                    bumpPlayerSeq(member);
                }
            } else if (action === 'state') {
                if (room.status !== 'running') return respondKnown(409, { ok: false, error: 'ROOM_NOT_RUNNING' });
                const nextState = cleanDuoState(data.state);
                if (player === room.host) {
                    rememberDuoScene(room, player.state?.scene);
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
                if (room.status !== 'running') return respondKnown(409, { ok: false, error: 'ROOM_NOT_RUNNING' });
                const nextState = cleanDuoState(data.state);
                // 房主倒地包不再重复上传整份道具数组，但服务端仍保留最后一份权威场景供客机续跑。
                if (player === room.host && !nextState.scene && player.state?.scene) nextState.scene = player.state.scene;
                if (player === room.host) rememberDuoScene(room, nextState.scene);
                player.state = nextState;
                player.down = true;
                player.downAt = Date.now();
                bumpPlayerSeq(player);
            } else if (action === 'finish') {
                if (room.status === 'waiting' || room.status === 'ready') return respondKnown(409, { ok: false, error: 'ROOM_NOT_RUNNING' });
                player.finished = true;
                player.final = { score: Math.max(0, Math.floor(Number(data.score) || 0)), playTime: Math.max(0, Math.floor(Number(data.playTime) || 0)) };
                if (room.host.finished && room.guest?.finished) {
                    room.status = 'finished';
                    saveDuoEntry(room);
                }
            } else if (action !== 'status' && action !== 'join') {
                return respondKnown(400, { ok: false, error: 'UNKNOWN_ACTION' });
            }
            resolveDuoRespawn(room);
            room.updatedAt = Date.now();
            return respondKnown(200, { ok: true, role: viewer });
        });
    };

    const server = http.createServer((req2, res2) => {
        const url = new URL(req2.url, `http://localhost:${PORT}`);
        const pn = decodeURIComponent(url.pathname);
        res2.setHeader('Access-Control-Allow-Origin', '*');
        res2.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res2.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req2.method === 'OPTIONS') { res2.writeHead(204); res2.end(); return; }

        if (pn === '/api/duo') {
            handleDuo(req2, res2, url);
            return;
        }

        // API: 读取排行榜
        if ((pn === '/api/leaderboard' || pn === '/server.node.js') && req2.method === 'GET') {
            try {
                const d = fs2.readFileSync(path.join(ROOT, 'leaderboard.json'), 'utf8');
                res2.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res2.end(d);
            } catch (e) {
                res2.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res2.end(JSON.stringify({ entries: [] }));
            }
            return;
        }

        // API: 保存排行榜
        if ((pn === '/api/leaderboard' || pn === '/server.node.js') && req2.method === 'POST') {
            let body = '';
            req2.on('data', c => { body += c; if (body.length > 1e6) { res2.writeHead(413); res2.end('Too Large'); req2.destroy(); } });
            req2.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (!data || !Array.isArray(data.entries)) { res2.writeHead(400); res2.end(JSON.stringify({ ok: false, error: 'Invalid' })); return; }
                    fs2.writeFileSync(path.join(ROOT, 'leaderboard.json'), JSON.stringify(data, null, 2), 'utf8');
                    res2.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res2.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res2.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res2.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        // 静态文件
        let fp = path.join(ROOT, pn === '/' ? '3d-duck.html' : pn);
        if (!fp.startsWith(ROOT)) { res2.writeHead(403); res2.end('Forbidden'); return; }
        fs2.readFile(fp, (err, data) => {
            if (err) { res2.writeHead(404); res2.end('404: ' + pn); }
            else { const ext = path.extname(fp); res2.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' }); res2.end(data); }
        });
    });

    server.listen(PORT, () => {
        console.log('\n  \u{1F986} 小黄鸭漂流记服务器已启动');
        console.log('  \u2192 http://localhost:' + PORT + '\n');
        try{var _if=require('os').networkInterfaces();var _ip=_if['Wi-Fi']?.[1]?.address||_if['以太网']?.[1]?.address||_if['Ethernet']?.[1]?.address;if(_ip)console.log('手机访问：http://'+_ip+':'+PORT+' (同一WiFi)\n');}catch(e){}
    });
}
