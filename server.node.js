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
        if (typeof data === 'string') data = JSON.parse(data);
        if (!data || !Array.isArray(data.entries)) {
            res.json({ ok: false, error: 'Invalid format' });
        }
        fs.writeFileSync('leaderboard.json', JSON.stringify(data, null, 2));
        res.json({ ok: true });
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

    const server = http.createServer((req2, res2) => {
        const url = new URL(req2.url, `http://localhost:${PORT}`);
        const pn = decodeURIComponent(url.pathname);
        res2.setHeader('Access-Control-Allow-Origin', '*');
        res2.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res2.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req2.method === 'OPTIONS') { res2.writeHead(204); res2.end(); return; }

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
