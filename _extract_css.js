// 一次性 CSS 外置脚本：把 3d-duck.html 内联 <style>...</style> 提取到 styles/game.css
// 完成后由阶段 2 验收，验收通过即可删除此文件
const fs=require('fs');
const path=require('path');

const html=fs.readFileSync('3d-duck.html','utf8');
const lines=html.split('\n');

// 找到 <style> 和 </style> 的行号（1-based）
const styleStartIdx=lines.findIndex(l=>/^<style>\s*$/.test(l));
const styleEndIdx=lines.findIndex(l=>/^<\/style>\s*$/.test(l));
if(styleStartIdx<0||styleEndIdx<0||styleEndIdx<=styleStartIdx){
    console.error('style block not found. start=',styleStartIdx,'end=',styleEndIdx);
    process.exit(1);
}
console.log('style block: line',styleStartIdx+1,'to',styleEndIdx+1);

// 提取 CSS 内容（不含 <style> 和 </style> 标签）
const cssContent=lines.slice(styleStartIdx+1,styleEndIdx).join('\n');
console.log('CSS content length:',cssContent.length,'chars');

// 写入 styles/game.css
fs.mkdirSync('styles',{recursive:true});
fs.writeFileSync('styles/game.css',cssContent);
console.log('styles/game.css written:',fs.statSync('styles/game.css').size,'bytes');

// 替换 HTML 中的 <style>...</style> 为 <link>
// 保留 <style> 标签所在行的缩进，用 <link rel="stylesheet" href="./styles/game.css"> 替换
const newLines=[
    ...lines.slice(0,styleStartIdx),
    '<link rel="stylesheet" href="./styles/game.css">',
    ...lines.slice(styleEndIdx+1)
];
fs.writeFileSync('3d-duck.html',newLines.join('\n'));
console.log('3d-duck.html updated. New size:',fs.statSync('3d-duck.html').size,'bytes');
console.log('CSS externalization complete.');
