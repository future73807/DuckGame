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
    const DUCK_SKIN_IDS = new Set(['classic', 'pearl', 'coral', 'ocean']);
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
        return {
            x: Math.max(-100000, Math.min(100000, num(state?.x))),
            y: Math.max(-1000, Math.min(1000, num(state?.y))),
            z: Math.max(-100000, Math.min(100000, num(state?.z))),
            ry: num(state?.ry),
            score: Math.max(0, Math.floor(num(state?.score))),
            hearts: Math.max(0, Math.min(9, Math.floor(num(state?.hearts)))),
            skin: DUCK_SKIN_IDS.has(state?.skin) ? state.skin : 'classic'
        };
    };
    const publicDuoPlayer = player => player ? ({ id: player.id, name: player.name, state: player.state, finished: player.finished, down: !!player.down, downAt: player.downAt || null }) : null;
    const publicDuoRoom = room => ({
        code: room.code,
        round: room.round || 1,
        status: room.status,
        host: publicDuoPlayer(room.host),
        guest: publicDuoPlayer(room.guest),
        duoEntry: room.duoEntry || null,
        blessing: room.blessing
    });
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
        if (room.status === 'finished' || !room.guest) return;
        const playTime = Math.max(0, Math.floor((Date.now() - (room.startedAt || Date.now())) / 1000));
        for (const player of [room.host, room.guest]) {
            player.down = false;
            player.downAt = null;
            player.finished = true;
            if (!player.final) player.final = { score: player.state.score || 0, playTime };
        }
        room.status = 'finished';
        saveDuoEntry(room);
    };
    const resolveDuoRespawn = room => {
        if (room.status !== 'running' || !room.guest) return;
        const players = [room.host, room.guest];
        const downPlayers = players.filter(player => player.down);
        if (downPlayers.length > 1) { finishDuoRoom(room); return; }
        if (downPlayers.length !== 1) return;
        const downPlayer = downPlayers[0];
        if (Date.now() - (downPlayer.downAt || Date.now()) < 10000) return;
        const partner = players.find(player => player !== downPlayer);
        const side = downPlayer === room.host ? -1 : 1;
        downPlayer.state = { ...downPlayer.state, x: partner.state.x + side * 1.25, y: partner.state.y, z: partner.state.z + side * .8, ry: partner.state.ry, hearts: 1 };
        downPlayer.down = false;
        downPlayer.downAt = null;
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
    const handleDuo = (req, res, url) => {
        pruneDuoRooms();
        if (req.method === 'GET') {
            const code = safeText(url.searchParams.get('room'), 6).toUpperCase();
            const room = duoRooms.get(code);
            if (!room) return sendDuoJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
            resolveDuoRespawn(room);
            return sendDuoJson(res, 200, { ok: true, room: publicDuoRoom(room) });
        }
        if (req.method !== 'POST') return sendDuoJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 24000) { res.writeHead(413); res.end(); req.destroy(); }
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
                const room = { code, round: 1, status: 'waiting', blessing: cleanDuoBlessing(data.blessing), host: { id: playerId, name, state: cleanDuoState(), finished: false, final: null, down: false, downAt: null }, guest: null, createdAt: Date.now(), updatedAt: Date.now(), duoEntry: null };
                duoRooms.set(code, room);
                return sendDuoJson(res, 200, { ok: true, role: 'host', room: publicDuoRoom(room) });
            }
            const code = safeText(data.room, 6).toUpperCase();
            const room = duoRooms.get(code);
            if (!room) return sendDuoJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
            let player = room.host.id === playerId ? room.host : room.guest?.id === playerId ? room.guest : null;
            if (action === 'join') {
                if (!name) return sendDuoJson(res, 400, { ok: false, error: 'NAME_REQUIRED' });
                if (!room.guest) {
                    room.guest = { id: playerId, name, state: cleanDuoState(), finished: false, final: null, down: false, downAt: null };
                    room.status = 'ready';
                    player = room.guest;
                } else if (!player) {
                    return sendDuoJson(res, 409, { ok: false, error: 'ROOM_FULL' });
                }
            }
            if (!player) return sendDuoJson(res, 403, { ok: false, error: 'NOT_IN_ROOM' });
            if (name && name !== player.name) player.name = name;
            if (action === 'start') {
                if (player !== room.host || !room.guest) return sendDuoJson(res, 409, { ok: false, error: 'WAITING_FOR_FRIEND' });
                room.status = 'running';
                room.startedAt = Date.now();
            } else if (action === 'restart') {
                if (player !== room.host) return sendDuoJson(res, 403, { ok: false, error: 'ONLY_HOST_CAN_RESTART' });
                if (!room.guest || room.status !== 'finished') return sendDuoJson(res, 409, { ok: false, error: 'WAITING_FOR_FRIEND' });
                room.round = (room.round || 1) + 1;
                room.status = 'running';
                room.startedAt = Date.now();
                room.duoEntry = null;
                for (const member of [room.host, room.guest]) {
                    member.state = cleanDuoState();
                    member.finished = false;
                    member.final = null;
                    member.down = false;
                    member.downAt = null;
                }
            } else if (action === 'state') {
                if (room.status !== 'running') return sendDuoJson(res, 409, { ok: false, error: 'ROOM_NOT_RUNNING', room: publicDuoRoom(room) });
                player.state = cleanDuoState(data.state);
            } else if (action === 'down') {
                if (room.status !== 'running') return sendDuoJson(res, 409, { ok: false, error: 'ROOM_NOT_RUNNING', room: publicDuoRoom(room) });
                player.state = cleanDuoState(data.state);
                player.down = true;
                player.downAt = Date.now();
                resolveDuoRespawn(room);
            } else if (action === 'finish') {
                if (room.status === 'waiting' || room.status === 'ready') return sendDuoJson(res, 409, { ok: false, error: 'ROOM_NOT_RUNNING' });
                player.finished = true;
                player.final = { score: Math.max(0, Math.floor(Number(data.score) || 0)), playTime: Math.max(0, Math.floor(Number(data.playTime) || 0)) };
                if (room.host.finished && room.guest?.finished) {
                    room.status = 'finished';
                    saveDuoEntry(room);
                }
            } else if (action !== 'status' && action !== 'join') {
                return sendDuoJson(res, 400, { ok: false, error: 'UNKNOWN_ACTION' });
            }
            resolveDuoRespawn(room);
            room.updatedAt = Date.now();
            return sendDuoJson(res, 200, { ok: true, role: player === room.host ? 'host' : 'guest', room: publicDuoRoom(room) });
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
