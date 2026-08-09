// 视觉自检截图脚本：元宵花灯+漩涡 / 端午粽子 / 相机平滑度
// 用法: node scripts/shot.js [lantern|zongzi|cam|all]
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const EXE = 'C:\\Users\\ygtqy\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const URL = 'http://localhost:8123/3d-duck.html';
const OUT = path.join(__dirname, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const mode = process.argv[2] || 'all';

(async () => {
    const browser = await puppeteer.launch({
        executablePath: EXE,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
            '--disable-gpu-sandbox', '--window-size=1280,720'],
        defaultViewport: { width: 1280, height: 720 },
    });
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('tutorial_done', '1'); } catch (e) {} });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    // 等待加载完成（开始按钮可点）
    await page.waitForFunction(() => {
        const b = document.getElementById('start-btn');
        return b && b.innerHTML.includes('单人模式');
    }, { timeout: 60000 });
    await new Promise(r => setTimeout(r, 500));
    await page.click('#start-btn');
    // 关掉祝福弹窗
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => {
        const sp = document.getElementById('blessing-splash');
        if (sp) sp.classList.remove('show');
        if (typeof skipTutorial === 'function') skipTutorial(); // 跳过新手引导（否则游戏保持暂停）
    });
    await new Promise(r => setTimeout(r, 1000));

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // 截图前关掉所有可能遮挡的弹层
    const dismiss = () => page.evaluate(() => {
        document.getElementById('blessing-splash')?.classList.remove('show');
        document.getElementById('tutorial')?.classList.remove('show');
        document.getElementById('gameover')?.classList.remove('show');
    });

    if (mode === 'lantern' || mode === 'all') {
        await page.evaluate(() => window.__debugFestival('lantern'));
        await sleep(300);
        await page.evaluate(() => window.__whirlTest.spawn(10));
        await sleep(1200); // 等漩涡顶点同步
        const pos = await page.evaluate(() => window.__gameState().whirlpoolsPos[0]);
        // 全景：花灯 + 漩涡同框（对准花灯腰部高度）
        await page.evaluate((p) => window.__lookAt(p[0], 3, p[1], 26, 0.7), pos);
        await sleep(400);
        await dismiss();
        await page.screenshot({ path: path.join(OUT, 'lantern-far.png') });
        // 侧面平视（贴近水面看孔明灯侧面轮廓）
        await page.evaluate((p) => window.__lookAt(p[0], 0.6, p[1], 5, 1.0), pos);
        await sleep(400);
        await dismiss();
        await page.screenshot({ path: path.join(OUT, 'lantern-side.png') });
        console.log('lantern shots done, whirl at', pos);
    }

    if (mode === 'zongzi' || mode === 'all') {
        await page.evaluate(() => {
            window.__whirlTest.clear(); // 清掉灯笼漩涡，避免鸭子/粽子被吸走
            window.__debugFestival('dragon_boat');
        });
        await sleep(600);
        await page.evaluate(() => window.__dbgSpawn('grass', 3));
        await sleep(800);
        // 取离鸭子最近的 grass（新生成的在鸭子附近；旧的远，且可能已被漩涡吸走）
        const items = await page.evaluate(() => {
            const st = window.__gameState();
            const gs = st.itemsPositions.filter(i => i[0] === 'grass');
            if (!st.duckPos || !gs.length) return [];
            gs.sort((a, b) => (Math.hypot(a[1] - st.duckPos[0], a[2] - st.duckPos[1])) - (Math.hypot(b[1] - st.duckPos[0], b[2] - st.duckPos[1])));
            return gs.slice(0, 1);
        });
        if (items.length) {
            const p = items[0];
            await page.evaluate((pp) => window.__lookAt(pp[1], 0.3, pp[2], 2.6, 0.8), p);
            await sleep(400);
            await dismiss();
        await page.screenshot({ path: path.join(OUT, 'zongzi.png') });
            // 侧面平视第二角度
            await page.evaluate((pp) => window.__lookAt(pp[1], 0.25, pp[2], 2.2, 2.2), p);
            await sleep(400);
            await dismiss();
        await page.screenshot({ path: path.join(OUT, 'zongzi-side.png') });
            console.log('zongzi shot done at', p);
        } else console.log('NO zongzi spawned!');
    }

    if (mode === 'cam' || mode === 'all') {
        // 相机平滑度：解除手动锁定，自动跟随跑 ~3 秒，每帧采相机 Y + 帧率
        const stat = await page.evaluate(() => new Promise(res => {
            const arr = [];
            let n = 0;
            const t0 = performance.now();
            if (window.__unlockCam) window.__unlockCam();
            function step() {
                arr.push(window.__camY ? window.__camY() : 0);
                if (++n < 180) requestAnimationFrame(step);
                else res({ arr, fps: n / ((performance.now() - t0) / 1000) });
            }
            requestAnimationFrame(step);
        }));
        const samples = stat.arr;
        if (samples.length > 10) {
            const deltas = [];
            for (let i = 1; i < samples.length; i++) deltas.push(Math.abs(samples[i] - samples[i - 1]));
            const maxJump = Math.max(...deltas);
            const sorted = [...deltas].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            // 卡顿特征：长时间零变化后突然大跳（撞墙式）
            const zeroFrac = deltas.filter(d => d < 0.002).length / deltas.length;
            console.log('camY fps:', stat.fps.toFixed(1), 'maxJump:', maxJump.toFixed(4),
                'median:', median.toFixed(4), 'zeroFrac:', (zeroFrac * 100).toFixed(0) + '%',
                'range:', Math.min(...samples).toFixed(3), '~', Math.max(...samples).toFixed(3));
        } else console.log('camY hook missing, skipped');
        await dismiss();
        await page.screenshot({ path: path.join(OUT, 'cam-end.png') });
    }

    if (errors.length) { console.log('--- console errors ---'); errors.slice(0, 10).forEach(e => console.log(e)); }
    else console.log('no console errors');
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
