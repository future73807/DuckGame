// 双人场景协议回归：首次全量，随后只返回变化项；历史基线丢失时安全回退全量。
const assert = require('assert/strict');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function reserveFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const port = probe.address().port;
            probe.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitForServer(url, child, getLog) {
    for (let i = 0; i < 80; i++) {
        if (child.exitCode !== null) throw new Error(`测试服务提前退出 (${child.exitCode})\n${getLog()}`);
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`测试服务启动超时\n${getLog()}`);
}

async function main() {
    const port = await reserveFreePort();
    let serverLog = '';
    const child = spawn(process.execPath, ['server.node.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    child.stdout.on('data', chunk => { serverLog += chunk; });
    child.stderr.on('data', chunk => { serverLog += chunk; });
    const origin = `http://127.0.0.1:${port}`;
    const endpoint = `${origin}/api/duo`;
    const salt = Date.now().toString(36);

    async function request(body) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        assert.equal(response.ok, true, data?.error || `HTTP ${response.status}`);
        return { data, bytes: Buffer.byteLength(text) };
    }

    try {
        await waitForServer(`${origin}/3d-duck.html`, child, () => serverLog);
        const hostId = `delta-host-${salt}`, guestId = `delta-guest-${salt}`;
        const created = await request({ action: 'create', playerId: hostId, name: 'host' });
        const room = created.data.room.code;
        await request({ action: 'join', playerId: guestId, name: 'guest', role: 'guest', room });
        await request({ action: 'start', playerId: hostId, name: 'host', role: 'host', room });

        const types = ['rock', 'flower', 'grass', 'lily', 'magnet'];
        const items = Array.from({ length: 244 }, (_, index) => [
            types[index % types.length], Math.sin(index) * 50, Math.cos(index) * 50,
            1 + (index % 3) * .5, null, index + 1, 0, 0
        ]);
        const scene = {
            clk: 1, evT: 30, evN: null, evTm: 0, wS: 1, wST: 1, eWT: 1, ih: 111,
            items, whirls: [], waveDir: [1, 0], waveStr: 0, waveActive: 0, waveDur: 0,
            shark: null, windAct: 0, windMul: 1, evWindDir: [1, 0], stormAct: 0, rbAct: 0
        };
        const hostState = () => ({ x: 0, y: 0, z: 0, ry: 0, score: 0, hearts: 3, skin: 'classic', scene });
        const guestState = { x: 3.5, y: 0, z: 0, ry: 0, score: 0, hearts: 3, skin: 'classic' };
        const hostUpdate = () => request({ action: 'state', playerId: hostId, name: 'host', role: 'host', room, state: hostState() });
        const guestUpdate = sceneHash => request({ action: 'state', playerId: guestId, name: 'guest', role: 'guest', room, sceneHash, state: guestState });

        await hostUpdate();
        const initial = await guestUpdate(null);
        const initialScene = initial.data.room.host.state.scene;
        assert.equal(initialScene.items.length, 244);
        assert.equal(initialScene.itemDelta, undefined);

        const unchanged = await guestUpdate(111);
        const unchangedScene = unchanged.data.room.host.state.scene;
        assert.equal(unchangedScene.items, undefined);
        assert.equal(unchangedScene.itemDelta, undefined);

        scene.items[0][1] += .2;
        scene.ih = 222;
        scene.clk = 1.2;
        await hostUpdate();
        const moved = await guestUpdate(111);
        const movedScene = moved.data.room.host.state.scene;
        assert.equal(movedScene.items, undefined);
        assert.equal(movedScene.itemDelta.baseHash, 111);
        assert.equal(movedScene.itemDelta.upserts.length, 1);
        assert.deepEqual(movedScene.itemDelta.removed, []);
        assert.ok(moved.bytes < initial.bytes * .2, `增量包 ${moved.bytes} 未显著小于全量包 ${initial.bytes}`);

        scene.items.splice(1, 1);
        scene.ih = 333;
        scene.clk = 1.4;
        await hostUpdate();
        // 故意跳过 222，验证服务端能从历史 111 直接计算到最新 333。
        const missed = await guestUpdate(111);
        assert.equal(missed.data.room.host.state.scene.itemDelta.upserts.length, 1);
        assert.deepEqual(missed.data.room.host.state.scene.itemDelta.removed, [2]);

        // 服务端只保留有限份场景历史；淘汰 111 后，客机若仍携带该旧基线，必须安全回退完整场景。
        for (let version = 0; version < 14; version++) {
            scene.items[0][1] += .01;
            scene.ih = 1000 + version;
            scene.clk += .2;
            await hostUpdate();
        }
        const evicted = await guestUpdate(111);
        const evictedScene = evicted.data.room.host.state.scene;
        assert.equal(evictedScene.ih, scene.ih);
        assert.equal(evictedScene.itemDelta, undefined);
        assert.ok(Array.isArray(evictedScene.items));
        assert.equal(evictedScene.items.length, scene.items.length);

        console.log(`OK: duo delta ${initial.bytes}B full -> ${moved.bytes}B one-item update`);
    } finally {
        if (child.exitCode === null) child.kill();
    }
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
