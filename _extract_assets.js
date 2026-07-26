// 一次性资源外置脚本：从 3d-duck.html 提取 favicon SVG / GLB base64 / duck-share SVG
// 完成后由阶段 1 验收，验收通过即可删除此文件
const fs=require('fs');
const path=require('path');

const html=fs.readFileSync('3d-duck.html','utf8');
fs.mkdirSync('assets',{recursive:true});

// 1. favicon SVG（第 8 行 data:image/svg+xml,...）
const favMatch=html.match(/<link rel="icon"[^>]*href="data:image\/svg\+xml,([^"]+)"/);
if(!favMatch){console.error('favicon not found');process.exit(1);}
const faviconSvg=decodeURIComponent(favMatch[1]);
fs.writeFileSync('assets/favicon.svg',faviconSvg);
console.log('favicon.svg:',faviconSvg.length,'bytes');

// 2. GLB 3D 模型（DUCK_GLB='data:application/octet-stream;base64,...'）
//    当前代码用 DUCK_GLB.split(',')[1] 取 base64 部分，再 atob 解码后 loader.parse
//    外置后改为 loader.load('./assets/duck.glb', ...)
const glbMatch=html.match(/DUCK_GLB\s*=\s*['"]data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/);
if(!glbMatch){console.error('GLB base64 not found');process.exit(1);}
const glbBuffer=Buffer.from(glbMatch[1],'base64');
fs.writeFileSync('assets/duck.glb',glbBuffer);
console.log('duck.glb:',glbBuffer.length,'bytes');

// 3. 分享卡 duckSVG 模板字符串
//    形如：const duckSVG=`<svg ...>...</svg>`;  （可能跨多行）
//    SVG 中含 width="${duckSize}" height="${duckSize}" 占位符，外置为静态文件时移除
//    这两个属性，由 Canvas drawImage 的显式 w/h 控制最终绘制尺寸（与现有逻辑一致）
const svgMatch=html.match(/const\s+duckSVG\s*=\s*`([\s\S]*?)`/);
if(!svgMatch){console.error('duckSVG not found');process.exit(1);}
const duckShareSvg=svgMatch[1].replace(/\s*width="\$\{duckSize\}"\s*height="\$\{duckSize\}"/,'');
fs.writeFileSync('assets/duck-share.svg',duckShareSvg);
console.log('duck-share.svg:',duckShareSvg.length,'bytes');

console.log('\nAll assets extracted.');
