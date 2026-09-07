// ============================================================
// 部署准备脚本 —— 生成待上传目录（.deploy/<site>/）
// ============================================================
// 用途：两个线上站点共用同一份源码，但需要不同的运行模式：
//   - 3d-duck   ：MODE=prod（隐藏调试按钮）
//   - duck-game ：MODE=dev （开发模式，显示调试按钮）
// 本脚本把项目复制到 .deploy/<site>/，并按 --mode 改写
// 3d-duck.html 里的 <meta name="env" content="MODE=...">。
// 密钥文件 .env 永远不会被复制（见 EXCLUDE）。
//
// 用法：node scripts/prepare-deploy.js --site <name> --mode <dev|prod>
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---- 解析参数 ----
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--site') args.site = argv[++i];
        else if (argv[i] === '--mode') args.mode = (argv[++i] || '').toLowerCase();
    }
    return args;
}

const { site, mode } = parseArgs(process.argv.slice(2));
if (!site || (mode !== 'dev' && mode !== 'prod')) {
    console.error('用法: node scripts/prepare-deploy.js --site <name> --mode <dev|prod>');
    process.exit(1);
}

// ---- 排除项：密钥 / 本地开发产物 / 部署自身的输出 ----
const EXCLUDE_FILES = new Set(['.env', 'rth-host.json', 'start.bat', 'prepare-deploy.js']);
const EXCLUDE_DIRS = new Set(['.git', '.deploy', 'node_modules', '.codex', 'scripts']);

function excluded(name, isDir) {
    return isDir ? EXCLUDE_DIRS.has(name) : EXCLUDE_FILES.has(name);
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (excluded(entry.name, entry.isDirectory())) continue;
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

const destRoot = path.join(ROOT, '.deploy', site);

// 清空旧输出，避免残留上一次的文件
fs.rmSync(destRoot, { recursive: true, force: true });
copyDir(ROOT, destRoot);

// ---- 按站点改写运行模式 ----
const htmlPath = path.join(destRoot, '3d-duck.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const metaRe = /(<meta\s+name="env"\s+content=")([^"]*)(")/;
if (!metaRe.test(html)) {
    console.error('错误: 未在 3d-duck.html 中找到 <meta name="env"> 标签');
    process.exit(1);
}
html = html.replace(metaRe, `$1MODE=${mode}$3`);
fs.writeFileSync(htmlPath, html);

console.log(`[prepare-deploy] 已生成 .deploy/${site}/ （MODE=${mode}，共 ${countFiles(destRoot)} 个文件）`);

function countFiles(dir) {
    let n = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
        else n++;
    }
    return n;
}
