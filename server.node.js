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
    const crypto = require('crypto');
    const PORT = process.env.PORT || 8123;
    const ROOT = __dirname;
    // 房间规则与热铁盒 ws.node.js 共用同一份内核，避免两条通道行为漂移。
    const duoCoreModule = require('./duo-core.node.js');
    const duoServiceModule = require('./duo-ws-service.node.js');
    const MIME = {
        '.html': 'text/html; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.ttf': 'font/ttf',
        '.glb': 'model/gltf-binary'
    };
    // ===== 双人同行房间 =====
    // 房间逻辑与热铁盒 ws.node.js 共用 duo-core.node.js / duo-ws-service.node.js，
    // 本地存储用内存 Map（线上 KV 由 ws.node.js 提供），保证两条通道行为一致。
    const duoStore = (() => {
        const map = new Map();
        return {
            async get(key) { return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null; },
            async set(key, value) { map.set(key, JSON.parse(JSON.stringify(value))); },
            async delete(key) { map.delete(key); }
        };
    })();

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

    const duoService = duoServiceModule.createDuoService({
        store: duoStore,
        saveEntry: saveDuoEntry,
        valueBudget: Infinity,
        historyBudget: Infinity
    });

    const sendDuoJson = (res, status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(payload));
    };

    const handleDuo = (req, res, url) => {
        if (req.method === 'GET') {
            duoService.peek(url.searchParams.get('room')).then(room => {
                if (!room) return sendDuoJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
                return sendDuoJson(res, 200, { ok: true, room });
            }).catch(() => sendDuoJson(res, 500, { ok: false, error: 'SERVER_ERROR' }));
            return;
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
            duoService.handle(data).then(payload => {
                sendDuoJson(res, payload.ok ? 200 : duoCoreModule.statusForError(payload.error), payload);
            }).catch(() => sendDuoJson(res, 500, { ok: false, error: 'SERVER_ERROR' }));
        });
    };

    // ===== WebSocket（最小 RFC6455 实现，无第三方依赖） =====
    // 与热铁盒 ws.node.js 相同：每条消息 {action,...} 交给 duoService，
    // 响应原样带回 msgId，便于客户端多路复用。
    const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    const WS_MAX_MESSAGE = 512 * 1024;

    const wsAcceptKey = key => crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

    const wsEncode = (opcode, payload) => {
        const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
        const len = body.length;
        let header;
        if (len < 126) {
            header = Buffer.alloc(2);
            header[1] = len;
        } else if (len < 65536) {
            header = Buffer.alloc(4);
            header[1] = 126;
            header.writeUInt16BE(len, 2);
        } else {
            header = Buffer.alloc(10);
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2);
        }
        header[0] = 0x80 | opcode;
        return Buffer.concat([header, body]);
    };

    const wsSend = (socket, text) => {
        if (socket.destroyed || !socket.writable) return;
        try { socket.write(wsEncode(0x1, text)); } catch (e) {}
    };

    const wsClose = (socket, code = 1000, reason = '') => {
        if (socket.destroyed) return;
        const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
        payload.writeUInt16BE(code, 0);
        payload.write(reason, 2, 'utf8');
        try { socket.write(wsEncode(0x8, payload)); } catch (e) {}
        socket.end();
    };

    const attachDuoWebSocket = (socket, head) => {
        let buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
        let fragments = [];
        let fragmentBytes = 0;
        let fragmentOpcode = 0;

        const dispatch = text => {
            let data;
            try { data = JSON.parse(text); } catch (e) { data = null; }
            if (!data || typeof data !== 'object') {
                wsSend(socket, JSON.stringify({ ok: false, error: 'INVALID_JSON' }));
                return;
            }
            const msgId = Number.isSafeInteger(data.msgId) ? data.msgId : null;
            duoService.handle(data).then(payload => {
                if (msgId !== null) payload.msgId = msgId;
                wsSend(socket, JSON.stringify(payload));
            }).catch(() => {
                const payload = { ok: false, error: 'SERVER_ERROR' };
                if (msgId !== null) payload.msgId = msgId;
                wsSend(socket, JSON.stringify(payload));
            });
        };

        const handleFrame = (fin, opcode, payload) => {
            if (opcode === 0x8) { wsClose(socket, 1000); return; }
            if (opcode === 0x9) { if (!socket.destroyed) { try { socket.write(wsEncode(0xA, payload)); } catch (e) {} } return; }
            if (opcode === 0xA) return;
            if (opcode === 0x2) { wsClose(socket, 1003, 'text only'); return; }
            if (opcode === 0x1 || opcode === 0x0) {
                if (opcode === 0x1) { fragments = []; fragmentBytes = 0; fragmentOpcode = 0x1; }
                if (fragmentOpcode !== 0x1) return;
                fragments.push(payload);
                fragmentBytes += payload.length;
                if (fragmentBytes > WS_MAX_MESSAGE) { wsClose(socket, 1009, 'too large'); return; }
                if (!fin) return;
                const text = Buffer.concat(fragments).toString('utf8');
                fragments = [];
                fragmentBytes = 0;
                fragmentOpcode = 0;
                dispatch(text);
            }
        };

        const readFrames = () => {
            while (!socket.destroyed) {
                if (buffer.length < 2) return;
                const fin = (buffer[0] & 0x80) !== 0;
                const opcode = buffer[0] & 0x0f;
                const masked = (buffer[1] & 0x80) !== 0;
                let len = buffer[1] & 0x7f;
                let offset = 2;
                if (len === 126) {
                    if (buffer.length < 4) return;
                    len = buffer.readUInt16BE(2);
                    offset = 4;
                } else if (len === 127) {
                    if (buffer.length < 10) return;
                    const big = buffer.readBigUInt64BE(2);
                    if (big > BigInt(WS_MAX_MESSAGE)) { wsClose(socket, 1009, 'too large'); return; }
                    len = Number(big);
                    offset = 10;
                }
                const maskOffset = offset;
                if (masked) offset += 4;
                if (buffer.length < offset + len) return;
                let payload = buffer.subarray(offset, offset + len);
                if (masked) {
                    const mask = buffer.subarray(maskOffset, maskOffset + 4);
                    const out = Buffer.allocUnsafe(len);
                    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
                    payload = out;
                }
                buffer = buffer.subarray(offset + len);
                handleFrame(fin, opcode, payload);
            }
        };

        socket.on('data', chunk => {
            buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
            if (buffer.length > WS_MAX_MESSAGE) { wsClose(socket, 1009, 'too large'); return; }
            readFrames();
        });
        socket.on('error', () => {});
        socket.on('close', () => { buffer = Buffer.alloc(0); });
        wsSend(socket, JSON.stringify({ type: 'ready' }));
    };

    const handleUpgrade = (req, socket) => {
        const pn = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
        if (pn !== '/ws.node.js' && pn !== '/ws') { socket.destroy(); return; }
        const key = req.headers['sec-websocket-key'];
        const upgrade = String(req.headers.upgrade || '').toLowerCase();
        if (upgrade !== 'websocket' || !key) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }
        const headers = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            'Sec-WebSocket-Accept: ' + wsAcceptKey(key)
        ];
        const protocol = req.headers['sec-websocket-protocol'];
        if (protocol) headers.push('Sec-WebSocket-Protocol: ' + String(protocol).split(',')[0].trim());
        socket.write(headers.join('\r\n') + '\r\n\r\n');
        socket.setNoDelay(true);
        attachDuoWebSocket(socket);
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
        // 热铁盒 /ws.node.js 同时提供 HTTP 回退；本地保持一致，便于客户端统一候选列表。
        if (pn === '/ws.node.js') {
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
            // no-store：版本回退/模块重组后浏览器必须拿到最新 JS/CSS，禁止启发式缓存旧模块
            if (err) { res2.writeHead(404, { 'Cache-Control': 'no-store' }); res2.end('404: ' + pn); }
            else { const ext = path.extname(fp); res2.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res2.end(data); }
        });
    });

    // WebSocket upgrade：与热铁盒 /ws.node.js 对齐，本地开发也能走长连接。
    server.on('upgrade', handleUpgrade);

    server.listen(PORT, () => {
        console.log('\n  \u{1F986} 小黄鸭漂流记服务器已启动');
        console.log('  \u2192 http://localhost:' + PORT + '\n');
        try{var _if=require('os').networkInterfaces();var _ip=_if['Wi-Fi']?.[1]?.address||_if['以太网']?.[1]?.address||_if['Ethernet']?.[1]?.address;if(_ip)console.log('手机访问：http://'+_ip+':'+PORT+' (同一WiFi)\n');}catch(e){}
    });
}
