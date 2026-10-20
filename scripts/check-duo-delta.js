// 双人场景协议回归：房主上行全量/metadata/delta 安全重建，客机下行继续使用 hash delta。
const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');

function checkClientUploadCapabilityFallback() {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'duo', 'scene-sync.js'), 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const wanted = new Set(['duoSameSerializedItem', 'duoBuildHostSceneUpload', 'duoAcceptHostSceneAck']);
    const declarations = ast.body.filter(node => node.type === 'FunctionDeclaration' && wanted.has(node.id?.name));
    assert.equal(declarations.length, wanted.size, '找不到房主上行能力协商函数');
    const functions = declarations.map(node => source.slice(node.start, node.end)).join('\n');
    const context = {};
    vm.createContext(context);
    vm.runInContext(`
        let duoHostSceneBase=null,duoHostSceneBaseRev=null,duoHostSceneDeltaCapable=false;
        ${functions}
        globalThis.exercise=(fullScene,ack,nextScene)=>{
            duoAcceptHostSceneAck(fullScene,ack);
            return {capable:duoHostSceneDeltaCapable,base:duoHostSceneBase,baseRev:duoHostSceneBaseRev,upload:duoBuildHostSceneUpload(nextScene)};
        };
    `, context);
    const full = { ih: 777, items: [['rock', 1, 2, 1, null, 1, 0, 0]], whirls: [] };
    const next = { ...full, clk: 1, items: full.items.map(item => item.slice()) };
    const negotiated = context.exercise(full, { protocol: 2, rev: 1 }, next);
    assert.equal(negotiated.capable, true);
    assert.equal(negotiated.upload.items, undefined, '新服务端 ack 后应允许 metadata-only');
    assert.equal(negotiated.upload.baseRev, 1);
    const oldServer = context.exercise(full, undefined, next);
    assert.equal(oldServer.capable, false);
    assert.equal(oldServer.base, null);
    assert.equal(oldServer.baseRev, null);
    assert.equal(oldServer.upload.uploadProtocol, 2);
    assert.ok(Array.isArray(oldServer.upload.items));
    assert.deepEqual(oldServer.upload.items, next.items, '旧服务端缺少 sceneAck 时必须继续发送完整 items');
    assert.equal(oldServer.upload.baseRev, undefined);
}

// 热铁盒 KV 只接受 ASCII 字母/数字/下划线/连字符的键名；
// 本地内存存储不会拒绝非法字符，必须在这里挡住，避免部署后才炸。
function checkStorageKeyRules() {
    const { createDuoService, LEGAL_KEY, ROOM_CODE, makeKey, normalizeCode } = require(path.join(ROOT, 'duo-ws-service.node.js'));
    assert.ok(LEGAL_KEY.test('room-123456'), '合法键名应通过校验');
    for (const bad of ['room:123456', 'player:123456:host', 'a b', '中文']) {
        assert.equal(LEGAL_KEY.test(bad), false, `非法键名不应通过校验: ${bad}`);
    }
    assert.throws(() => makeKey(['room', '1:2']), /ILLEGAL_STORAGE_KEY/, 'makeKey 必须拦截非法字符');
    assert.equal(normalizeCode(' 123456 '), '123456');
    assert.equal(normalizeCode('12 34'), null, '含空格房间号必须判为无效');
    assert.equal(normalizeCode('12:456'), null, '含非法字符房间号必须判为非法');
    assert.ok(ROOM_CODE.test('000000'));

    // 用严格存储后端驱动一遍完整房间生命周期：任何非法键名都会在这里抛错。
    const seenKeys = [];
    const strictStore = {
        async get(key) { assert.match(key, LEGAL_KEY, `读取到非法键名: ${key}`); seenKeys.push(key); return null; },
        async set(key, value) { assert.match(key, LEGAL_KEY, `写入非法键名: ${key}`); seenKeys.push(key); assert.ok(JSON.stringify(value).length <= 65535, `单值超过热铁盒 65535 上限: ${key}`); },
        async delete(key) { assert.match(key, LEGAL_KEY); }
    };
    const service = createDuoService({ store: strictStore });
    return (async () => {
        const created = await service.handle({ action: 'create', playerId: 'k-host', name: 'kh' });
        assert.equal(created.ok, true);
        const room = created.room.code;
        assert.ok(ROOM_CODE.test(room), `房间号必须为 6 位数字: ${room}`);
        await service.handle({ action: 'join', playerId: 'k-guest', name: 'kg', role: 'guest', room });
        await service.handle({ action: 'start', playerId: 'k-host', role: 'host', room });
        await service.handle({
            action: 'state', playerId: 'k-host', role: 'host', room,
            state: { x: 0, y: 0, z: 0, ry: 0, score: 0, hearts: 3, skin: 'classic', scene: { ih: 1, items: [['rock', 1, 2, 1, null, 1, 0, 0]], whirls: [] } }
        });
        assert.ok(seenKeys.length > 0);
        assert.ok(seenKeys.every(key => LEGAL_KEY.test(key)), '所有访问过的键名都必须合法');
        const missing = await service.handle({ action: 'status', playerId: 'k-guest', role: 'guest', room: '00:001' });
        assert.equal(missing.error, 'ROOM_NOT_FOUND', '非法房间号必须安全返回 ROOM_NOT_FOUND 而不是抛错');
    })();
}

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

// ---- WebSocket 通道回归：与 HTTP 同一套房间语义，消息带 msgId 多路复用 ----
async function openDuoWebSocket(url) {
    const socket = new WebSocket(url);
    const pending = new Map();
    let seq = 0;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 5000);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket 连接失败')); });
    });
    socket.addEventListener('message', event => {
        const data = JSON.parse(event.data);
        if (data.type === 'ready') return;
        const entry = pending.get(Number(data.msgId));
        if (!entry) return;
        pending.delete(Number(data.msgId));
        entry.resolve(data);
    });
    socket.addEventListener('close', () => {
        for (const entry of pending.values()) entry.reject(new Error('WebSocket 已关闭'));
        pending.clear();
    });
    return {
        send(payload) {
            const msgId = ++seq;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => { pending.delete(msgId); reject(new Error(`WebSocket 请求超时: ${payload.action}`)); }, 5000);
                pending.set(msgId, { resolve, reject, timer });
                socket.send(JSON.stringify({ ...payload, msgId }));
            });
        },
        close() { try { socket.close(); } catch (_) {} }
    };
}

async function checkWebSocketChannel(origin, salt) {
    const ws = await openDuoWebSocket(`${origin.replace(/^http/, 'ws')}/ws.node.js`);
    try {
        const hostId = `ws-host-${salt}`, guestId = `ws-guest-${salt}`;
        const created = await ws.send({ action: 'create', playerId: hostId, name: 'ws-host' });
        assert.equal(created.ok, true);
        assert.equal(created.role, 'host');
        assert.equal(created.room.status, 'waiting');
        const room = created.room.code;

        const joined = await ws.send({ action: 'join', playerId: guestId, name: 'ws-guest', role: 'guest', room });
        assert.equal(joined.ok, true);
        assert.equal(joined.room.status, 'ready');
        assert.equal(joined.room.guest.name, 'ws-guest');

        const started = await ws.send({ action: 'start', playerId: hostId, role: 'host', room });
        assert.equal(started.ok, true);
        assert.equal(started.room.status, 'running');

        const items = [['rock', 1, 2, 1, null, 1, 0, 0], ['flower', 3, 4, 1, null, 2, 0, 0]];
        const scene = {
            clk: 1, evT: 30, evN: null, evTm: 0, wS: 1, wST: 1, eWT: 1, ih: 1,
            items, whirls: [[5, 6, 1]], waveDir: [1, 0], waveStr: 1, waveActive: 0, waveDur: 0,
            shark: null, windAct: 0, windMul: 1, evWindDir: [1, 0], stormAct: 0, rbAct: 0
        };
        const hostState = (scenePayload, extra = {}) => ({ x: 0, y: 0, z: 0, ry: 0, score: 0, hearts: 3, skin: 'classic', scene: scenePayload, ...extra });
        const fullUpload = snapshot => ({ ...snapshot, uploadProtocol: 2 });
        const first = await ws.send({ action: 'state', playerId: hostId, name: 'ws-host', role: 'host', room, state: hostState(fullUpload(scene)) });
        assert.equal(first.ok, true);
        assert.equal(first.sceneAck.protocol, 2);
        assert.equal(first.sceneAck.mode, 'full');
        const baseRev = first.sceneAck.rev;

        // 客机拿到完整场景 + server-issued ih
        const guestSync = await ws.send({ action: 'state', playerId: guestId, name: 'ws-guest', role: 'guest', room, state: { x: 1, y: 0, z: 1, ry: 0, score: 0, hearts: 3, skin: 'classic' } });
        assert.equal(guestSync.ok, true);
        assert.equal(guestSync.room.host.state.scene.items.length, 2);
        assert.equal(guestSync.room.host.state.scene.ih, baseRev);

        // metadata-only 不推进 items rev
        const metadataScene = { ...scene, clk: 1.1 };
        delete metadataScene.items;
        const metadata = await ws.send({ action: 'state', playerId: hostId, role: 'host', room, state: hostState({ ...metadataScene, uploadProtocol: 2, baseRev }) });
        assert.equal(metadata.sceneAck.mode, 'metadata');
        assert.equal(metadata.sceneAck.rev, baseRev);

        // delta 只传变化项
        const moved = scene.items[0].slice();
        moved[1] = 9;
        const delta = await ws.send({ action: 'state', playerId: hostId, role: 'host', room, state: hostState({ ...metadataScene, clk: 1.2, uploadProtocol: 2, baseRev, itemDelta: { upserts: [moved], removed: [] } }) });
        assert.equal(delta.sceneAck.mode, 'delta');
        assert.ok(delta.sceneAck.rev > baseRev);

        // 旧 baseRev 重放必须 409 且带 expectedSceneRev，且不附带房间快照（客户端据此清基线）
        const stale = await ws.send({ action: 'state', playerId: hostId, role: 'host', room, state: hostState({ ...metadataScene, clk: 99, uploadProtocol: 2, baseRev, itemDelta: { upserts: [moved], removed: [] } }) });
        assert.equal(stale.ok, false);
        assert.equal(stale.error, 'SCENE_BASE_MISMATCH');
        assert.equal(stale.expectedSceneRev, delta.sceneAck.rev);
        assert.equal(stale.room, undefined, '场景协议错误不得附带房间快照');

        // 同一房间在 HTTP 通道仍可见（两条通道共用房间存储）
        const httpRoom = await (await fetch(`${origin}/api/duo?room=${room}`)).json();
        assert.equal(httpRoom.ok, true);
        assert.equal(httpRoom.room.status, 'running');
        assert.equal(httpRoom.room.guest.name, 'ws-guest');

        // 错误码映射
        const missing = await ws.send({ action: 'status', playerId: guestId, role: 'guest', room: '000000' });
        assert.equal(missing.error, 'ROOM_NOT_FOUND');

        // 通过 HTTP 关闭对局后，WS 立即读到 finished
        await fetch(`${origin}/api/duo`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'finish', playerId: hostId, name: 'ws-host', role: 'host', room, score: 10, playTime: 5 })
        });
        const finished = await ws.send({ action: 'finish', playerId: guestId, name: 'ws-guest', role: 'guest', room, score: 20, playTime: 6 });
        assert.equal(finished.ok, true);
        assert.equal(finished.room.status, 'finished');
        assert.ok(finished.room.duoEntry, '结算后应生成双人榜条目');
        assert.equal(finished.room.duoEntry.score, 30);

        console.log('OK: WebSocket 通道 create/join/start/state(全量→metadata→delta)/409/跨通道共享/结算');
    } finally {
        ws.close();
    }
}

async function main() {
    checkClientUploadCapabilityFallback();
    await checkStorageKeyRules();
    // 结算回归会向 leaderboard.json 写入双人榜；测试前备份、结束时还原，避免污染仓库文件。
    const leaderboardPath = path.join(ROOT, 'leaderboard.json');
    const leaderboardBackup = fs.existsSync(leaderboardPath) ? fs.readFileSync(leaderboardPath, 'utf8') : null;
    const restoreLeaderboard = () => {
        try {
            if (leaderboardBackup === null) { if (fs.existsSync(leaderboardPath)) fs.unlinkSync(leaderboardPath); }
            else fs.writeFileSync(leaderboardPath, leaderboardBackup);
        } catch (_) {}
    };
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

    async function request(body, expectedStatus = 200) {
        const payload = JSON.stringify(body);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: payload
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        assert.equal(response.status, expectedStatus, data?.error || `HTTP ${response.status}`);
        return { data, bytes: Buffer.byteLength(text), requestBytes: Buffer.byteLength(payload) };
    }

    try {
        await waitForServer(`${origin}/3d-duck.html`, child, () => serverLog);        const hostId = `delta-host-${salt}`, guestId = `delta-guest-${salt}`;
        const created = await request({ action: 'create', playerId: hostId, name: 'host' });
        const room = created.data.room.code;
        const readRoom = async () => {
            const response = await fetch(`${endpoint}?room=${room}`);
            const data = await response.json();
            assert.equal(response.status, 200);
            return data.room;
        };
        await request({ action: 'join', playerId: guestId, name: 'guest', role: 'guest', room });
        await request({ action: 'start', playerId: hostId, name: 'host', role: 'host', room });

        const types = ['rock', 'flower', 'grass', 'lily', 'magnet'];
        const items = Array.from({ length: 244 }, (_, index) => [
            types[index % types.length], Math.sin(index) * 50, Math.cos(index) * 50,
            1 + (index % 3) * .5, null, index + 1, 0, 0
        ]);
        let scene = {
            clk: 1, evT: 30, evN: null, evTm: 0, wS: 1, wST: 1, eWT: 1, ih: 111,
            items, whirls: [[12.5, -8.25, 1.2]], waveDir: [.6, .8], waveStr: 3, waveActive: 1, waveDur: 4.5,
            shark: null, windAct: 0, windMul: 1, evWindDir: [1, 0], stormAct: 0, rbAct: 0
        };
        const hostState = scenePayload => ({ x: 0, y: 0, z: 0, ry: 0, score: 0, hearts: 3, skin: 'classic', scene: scenePayload });
        const guestState = { x: 3.5, y: 0, z: 0, ry: 0, score: 0, hearts: 3, skin: 'classic', cm: 1.75 };
        const hostUpdate = (scenePayload = scene, expectedStatus = 200) => request({ action: 'state', playerId: hostId, name: 'host', role: 'host', room, state: hostState(scenePayload) }, expectedStatus);
        const guestUpdate = sceneHash => request({ action: 'state', playerId: guestId, name: 'guest', role: 'guest', room, sceneHash, state: guestState });
        const metadataUpload = (snapshot, baseRev) => {
            const upload = { ...snapshot, uploadProtocol: 2, baseRev };
            delete upload.items;
            delete upload.itemDelta;
            return upload;
        };
        const deltaUpload = (snapshot, baseRev, upserts, removed) => ({
            ...metadataUpload(snapshot, baseRev),
            itemDelta: { upserts, removed }
        });
        const fullUpload = snapshot => ({ ...snapshot, uploadProtocol: 2 });
        const assertRejectedWithoutMutation = async scenePayload => {
            const before = await readRoom();
            const rejected = await hostUpdate(scenePayload, 400);
            assert.equal(rejected.data.error, 'INVALID_SCENE_DELTA');
            const after = await readRoom();
            assert.equal(after.rev, before.rev, 'malformed delta 不得推进 room rev');
            assert.deepEqual(after.host, before.host, 'malformed delta 不得污染 host state/seq/name/scene');
        };

        const initialHost = await hostUpdate(fullUpload(scene));
        assert.equal(initialHost.data.sceneAck.protocol, 2);
        assert.equal(initialHost.data.sceneAck.mode, 'full');
        let uploadRev = initialHost.data.sceneAck.rev;
        assert.equal(uploadRev, 1);
        const initialItemsRev = uploadRev;
        const initial = await guestUpdate(null);
        assert.equal(initial.data.room.guest.state.cm, 1.75, '三连小磁吸计时必须安全透传给伙伴');
        const initialScene = initial.data.room.host.state.scene;
        assert.equal(initialScene.ih, initialItemsRev, '服务端必须覆盖房主自报 ih');
        assert.equal(initialScene.items.length, 244);
        assert.equal(initialScene.itemDelta, undefined);
        assert.deepEqual(initialScene.whirls, [[12.5, -8.25, 1.2]]);

        // 道具完全不变时，房主只上传 metadata；服务端仍保存完整权威 items。
        scene.clk = 1.1;
        scene.whirls = [[12.5, -8.25, 1.35]];
        const metadataHost = await hostUpdate(metadataUpload(scene, uploadRev));
        assert.equal(metadataHost.data.sceneAck.mode, 'metadata');
        assert.equal(metadataHost.data.sceneAck.rev, uploadRev, 'metadata-only 不应推进 items rev');
        uploadRev = metadataHost.data.sceneAck.rev;
        assert.ok(metadataHost.requestBytes < initialHost.requestBytes * .2, `metadata 上行 ${metadataHost.requestBytes} 未显著小于全量 ${initialHost.requestBytes}`);

        const unchanged = await guestUpdate(initialItemsRev);
        const unchangedScene = unchanged.data.room.host.state.scene;
        assert.equal(unchangedScene.items, undefined);
        assert.equal(unchangedScene.itemDelta, undefined);
        assert.deepEqual(unchangedScene.whirls, [[12.5, -8.25, 1.35]], '相同 ih 的 metadata 包必须保留 whirls');
        const reconstructedMetadata = (await guestUpdate(null)).data.room.host.state.scene;
        assert.equal(reconstructedMetadata.items.length, 244, '服务端 metadata 合并后必须继续保存完整 items');
        assert.equal(reconstructedMetadata.clk, 1.1);

        // 两类 malformed delta 均应整包 400，且同一个 baseRev 随后仍能继续正常使用。
        await assertRejectedWithoutMutation({ ...scene, baseRev: uploadRev, itemDelta: { upserts: [], removed: [] } });
        const duplicateRemovedId = scene.items[0][5];
        await assertRejectedWithoutMutation(deltaUpload(scene, uploadRev, [], [duplicateRemovedId, duplicateRemovedId]));
        const nonCanonicalUpsert = scene.items[0].slice();
        nonCanonicalUpsert[1] = 'not-a-number';
        await assertRejectedWithoutMutation(deltaUpload(scene, uploadRev, [nonCanonicalUpsert], []));
        const duplicateFull = { ...scene, uploadProtocol: 2, items: scene.items.map(item => item.slice()) };
        duplicateFull.items[1][5] = duplicateFull.items[0][5];
        await assertRejectedWithoutMutation(duplicateFull);
        const oversizedFull = {
            ...scene,
            uploadProtocol: 2,
            items: Array.from({ length: 2049 }, (_, index) => ['rock', 0, index % 10, 1, null, index + 1, 0, 0])
        };
        await assertRejectedWithoutMutation(oversizedFull);
        scene.clk = 1.15;
        const recoveredMetadata = await hostUpdate(metadataUpload(scene, uploadRev));
        assert.equal(recoveredMetadata.data.sceneAck.mode, 'metadata');
        assert.equal(recoveredMetadata.data.sceneAck.rev, uploadRev, 'malformed 包不能消耗 baseRev');

        scene.items[0][1] += .2;
        scene.ih = 222;
        scene.clk = 1.2;
        scene.whirls = [[-6.75, 14.5, .85]];
        const movedHost = await hostUpdate(deltaUpload(scene, uploadRev, [scene.items[0]], []));
        assert.equal(movedHost.data.sceneAck.mode, 'delta');
        assert.ok(movedHost.data.sceneAck.rev > uploadRev);
        uploadRev = movedHost.data.sceneAck.rev;
        const movedItemsRev = uploadRev;
        assert.ok(movedHost.requestBytes < initialHost.requestBytes * .2, `单项增量上行 ${movedHost.requestBytes} 未显著小于全量 ${initialHost.requestBytes}`);
        const moved = await guestUpdate(initialItemsRev);
        const movedScene = moved.data.room.host.state.scene;
        assert.equal(movedScene.items, undefined);
        assert.equal(movedScene.itemDelta.baseHash, initialItemsRev);
        assert.equal(movedScene.itemDelta.upserts.length, 1);
        assert.deepEqual(movedScene.itemDelta.removed, []);
        assert.deepEqual(movedScene.whirls, [[-6.75, 14.5, .85]], 'item delta 包必须保留最新 whirls');
        assert.ok(moved.bytes < initial.bytes * .2, `增量包 ${moved.bytes} 未显著小于全量包 ${initial.bytes}`);

        // 漩涡和海浪只改变元数据、不改变物品 hash 时，也必须把“已清空/已结束”明确传给客机。
        scene.clk = 1.3;
        scene.whirls = [];
        scene.waveDir = [0, 0];
        scene.waveStr = 0;
        scene.waveActive = 0;
        scene.waveDur = 0;
        const inactiveHost = await hostUpdate(metadataUpload(scene, uploadRev));
        assert.equal(inactiveHost.data.sceneAck.mode, 'metadata');
        assert.equal(inactiveHost.data.sceneAck.rev, uploadRev, '漩涡清空不能推进 items rev');
        uploadRev = inactiveHost.data.sceneAck.rev;
        const inactive = await guestUpdate(movedItemsRev);
        const inactiveScene = inactive.data.room.host.state.scene;
        assert.equal(inactiveScene.items, undefined);
        assert.equal(inactiveScene.itemDelta, undefined);
        assert.deepEqual(inactiveScene.whirls, [], 'whirls 从有到空时，metadata 包必须显式返回空数组');
        assert.deepEqual(inactiveScene.waveDir, [0, 0]);
        assert.equal(inactiveScene.waveStr, 0);
        assert.equal(inactiveScene.waveActive, 0, '海浪 inactive 状态必须在 metadata 包中透传');
        assert.equal(inactiveScene.waveDur, 0);

        const removedId = scene.items[1][5];
        scene.items.splice(1, 1);
        scene.ih = 333;
        scene.clk = 1.4;
        const removedHost = await hostUpdate(deltaUpload(scene, uploadRev, [], [removedId]));
        assert.equal(removedHost.data.sceneAck.mode, 'delta');
        uploadRev = removedHost.data.sceneAck.rev;
        const removedItemsRev = uploadRev;
        const removed = await guestUpdate(movedItemsRev);
        assert.deepEqual(removed.data.room.host.state.scene.itemDelta.upserts, []);
        assert.deepEqual(removed.data.room.host.state.scene.itemDelta.removed, [removedId]);

        // 故意跳过中间版本，验证客机下行仍能从首个 server-issued rev 直接计算到最新状态。
        const missed = await guestUpdate(initialItemsRev);
        assert.equal(missed.data.room.host.state.scene.itemDelta.upserts.length, 1);
        assert.deepEqual(missed.data.room.host.state.scene.itemDelta.removed, [removedId]);

        // 合法 current baseRev 即使沿用碰撞的旧 ih，也必须推进 server-issued items rev 并对客机可见。
        const collisionBaseRev = uploadRev;
        assert.equal(collisionBaseRev, removedItemsRev);
        const collisionScene = { ...scene, clk: 1.5, items: scene.items.map(item => item.slice()), whirls: [[30, -30, 1.1]] };
        collisionScene.items[0][1] += .1;
        collisionScene.items[0][2] -= .1;
        collisionScene.ih = scene.ih;
        const collisionHost = await hostUpdate(deltaUpload(collisionScene, uploadRev, [collisionScene.items[0]], []));
        assert.equal(collisionHost.data.sceneAck.mode, 'delta');
        assert.ok(collisionHost.data.sceneAck.rev > collisionBaseRev, 'items 改变必须推进 server-issued rev');
        uploadRev = collisionHost.data.sceneAck.rev;
        scene = collisionScene;
        const collisionDown = (await guestUpdate(collisionBaseRev)).data.room.host.state.scene;
        assert.equal(collisionDown.itemDelta.baseHash, collisionBaseRev);
        assert.equal(collisionDown.itemDelta.upserts.length, 1, '旧 ih 碰撞不能让客机漏掉合法 item delta');
        assert.deepEqual(collisionDown.itemDelta.upserts[0], scene.items[0]);
        assert.equal(collisionDown.ih, uploadRev);

        // 漩涡从有到空仍走 metadata-only，并显式清空服务端与客机状态；items rev 保持不变。
        scene = { ...scene, clk: 1.6, whirls: [] };
        const cleared = await hostUpdate(metadataUpload(scene, uploadRev));
        assert.equal(cleared.data.sceneAck.mode, 'metadata');
        assert.equal(cleared.data.sceneAck.rev, uploadRev);
        uploadRev = cleared.data.sceneAck.rev;
        const clearedDown = (await guestUpdate(uploadRev)).data.room.host.state.scene;
        assert.equal(clearedDown.items, undefined);
        assert.deepEqual(clearedDown.whirls, []);

        // 模拟“服务端已应用但 ack 丢失”：客户端仍用旧 baseRev 重发，必须 409 且不污染任意房间状态。
        const clientRevBeforeLostAck = uploadRev;
        const lostAckScene = { ...scene, clk: 1.7, items: scene.items.map(item => item.slice()) };
        lostAckScene.items[0][1] += .1;
        lostAckScene.items[0][2] -= .1;
        lostAckScene.ih = scene.ih;
        const acceptedWithoutAck = await hostUpdate(deltaUpload(lostAckScene, clientRevBeforeLostAck, [lostAckScene.items[0]], []));
        const serverRevAfterLostAck = acceptedWithoutAck.data.sceneAck.rev;
        assert.ok(serverRevAfterLostAck > clientRevBeforeLostAck);
        scene = lostAckScene;
        const beforeRejectedRoom = await readRoom();
        const staleReplay = { ...scene, clk: 999, whirls: [[99, 99, 9]] };
        const rejected = await hostUpdate(deltaUpload(staleReplay, clientRevBeforeLostAck, [staleReplay.items[0]], []), 409);
        assert.equal(rejected.data.error, 'SCENE_BASE_MISMATCH');
        assert.equal(rejected.data.expectedSceneRev, serverRevAfterLostAck);
        const afterRejectedRoom = await readRoom();
        assert.equal(afterRejectedRoom.rev, beforeRejectedRoom.rev, '失配 delta 不得推进 room rev');
        assert.deepEqual(afterRejectedRoom.host, beforeRejectedRoom.host, '失配 delta 不得污染 host state/seq/name/scene');

        // 客户端识别 409 后清空 base，下一包全量恢复；items 相同则沿用服务端当前 rev。
        const fallback = await hostUpdate(fullUpload(scene));
        assert.equal(fallback.data.sceneAck.mode, 'full');
        assert.equal(fallback.data.sceneAck.rev, serverRevAfterLostAck);
        uploadRev = fallback.data.sceneAck.rev;
        const afterFallback = (await readRoom()).host.state.scene;
        assert.deepEqual(afterFallback.items, scene.items);
        assert.equal(afterFallback.clk, scene.clk);

        // 缺少 items 的 metadata 必须保留列表；只有显式 full items:[] 才允许清空。
        const savedItems = scene.items.map(item => item.slice());
        const beforeExplicitClearRev = uploadRev;
        const emptyScene = { ...scene, clk: 1.8, items: [], whirls: [] };
        const emptyFull = await hostUpdate(fullUpload(emptyScene));
        assert.equal(emptyFull.data.sceneAck.mode, 'full');
        assert.ok(emptyFull.data.sceneAck.rev > beforeExplicitClearRev);
        uploadRev = emptyFull.data.sceneAck.rev;
        scene = emptyScene;
        const emptyDown = (await guestUpdate(beforeExplicitClearRev)).data.room.host.state.scene;
        assert.deepEqual(emptyDown.itemDelta.upserts, []);
        assert.equal(emptyDown.itemDelta.removed.length, savedItems.length);
        assert.deepEqual((await readRoom()).host.state.scene.items, []);
        const emptyMetadata = await hostUpdate(metadataUpload({ ...scene, clk: 1.9 }, uploadRev));
        assert.equal(emptyMetadata.data.sceneAck.rev, uploadRev);
        assert.deepEqual((await readRoom()).host.state.scene.items, [], 'metadata 缺少 items 时不得凭空恢复或清空其他基线');

        // 恢复完整道具，供旧客户端兼容和历史淘汰回归继续使用。
        scene = { ...scene, clk: 2, items: savedItems };
        const restored = await hostUpdate(fullUpload(scene));
        assert.equal(restored.data.sceneAck.mode, 'full');
        assert.ok(restored.data.sceneAck.rev > uploadRev);
        uploadRev = restored.data.sceneAck.rev;

        // 旧客户端继续上传全量；同时淘汰首个下行 rev，旧客机基线应安全回退完整场景。
        for (let version = 0; version < 14; version++) {
            scene.items[0][1] += .01;
            scene.ih = 1000 + version;
            scene.clk += .2;
            const legacyFull = await hostUpdate();
            assert.equal(legacyFull.data.sceneAck.mode, 'full');
            assert.equal(legacyFull.data.sceneAck.protocol, 1, '旧客户端全量可兼容，但不得获准启用 v2 delta');
            assert.ok(legacyFull.data.sceneAck.rev > uploadRev);
            uploadRev = legacyFull.data.sceneAck.rev;
        }
        const evicted = await guestUpdate(initialItemsRev);
        const evictedScene = evicted.data.room.host.state.scene;
        assert.equal(evictedScene.ih, uploadRev);
        assert.equal(evictedScene.itemDelta, undefined);
        assert.ok(Array.isArray(evictedScene.items));
        assert.equal(evictedScene.items.length, scene.items.length);

        // 房主本地倒地后仍是场景权威：客机残血时，房主的看护同步必须能新增救场血瓶。
        guestState.hearts = 1;
        await guestUpdate(uploadRev);
        await request({ action: 'down', playerId: hostId, name: 'host', role: 'host', room, state: { ...hostState(scene), hearts: 0 } });
        const caretakerBaseRev = uploadRev;
        const rescueScene = { ...scene, clk: scene.clk + .1, items: scene.items.map(item => item.slice()) };
        const nextItemId = Math.max(0, ...rescueScene.items.map(item => Number(item[5]) || 0)) + 1;
        const rescueHeart = ['heart', 6, 0, 1, null, nextItemId, 0, 0];
        rescueScene.items.push(rescueHeart);
        const caretaker = await request({
            action: 'state', playerId: hostId, name: 'host', role: 'host', room,
            state: { ...hostState(deltaUpload(rescueScene, caretakerBaseRev, [rescueHeart], [])), hearts: 0 }
        });
        assert.equal(caretaker.data.sceneAck.mode, 'delta');
        assert.equal(caretaker.data.room.host.down, true, '场景看护同步不得把房主误判为已复活');
        const rescueDown = (await guestUpdate(caretakerBaseRev)).data.room.host.state.scene;
        assert.ok(rescueDown.itemDelta.upserts.some(item => item[0] === 'heart' && item[5] === nextItemId), '客机未收到倒地房主同步的救场血瓶');

        console.log(`OK: host upload ${initialHost.requestBytes}B full -> ${metadataHost.requestBytes}B metadata / ${movedHost.requestBytes}B delta; guest download ${initial.bytes}B full -> ${moved.bytes}B delta`);

        await checkWebSocketChannel(origin, salt);
    } finally {
        if (child.exitCode === null) child.kill();
        restoreLeaderboard();
    }
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
