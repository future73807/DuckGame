// 一次性主模块外置脚本：把 3d-duck.html 内联 <script type="module">...</script> 提取到 js/main.js
// 完成后由阶段 3 验收，验收通过即可删除此文件
const fs=require('fs');
const path=require('path');

const html=fs.readFileSync('3d-duck.html','utf8');
const lines=html.split('\n');

// 找到 <script type="module"> 和对应的 </script>
// 注意：模块内部不应有 </script> 字符串，所以第一个 </script> 就是结束
const moduleStartIdx=lines.findIndex(l=>/^<script type="module">\s*$/.test(l));
if(moduleStartIdx<0){console.error('module script start not found');process.exit(1)}
// 从 moduleStartIdx+1 开始找 </script>
let moduleEndIdx=-1;
for(let i=moduleStartIdx+1;i<lines.length;i++){
    if(/^<\/script>\s*$/.test(lines[i])){moduleEndIdx=i;break}
}
if(moduleEndIdx<0){console.error('module script end not found');process.exit(1)}

console.log('module script: line',moduleStartIdx+1,'to',moduleEndIdx+1);
console.log('module content lines:',moduleEndIdx-moduleStartIdx-1);

// 提取模块内容（不含 <script> 和 </script> 标签）
const moduleContent=lines.slice(moduleStartIdx+1,moduleEndIdx).join('\n');
console.log('module content length:',moduleContent.length,'chars');

// 写入 js/main.js
fs.mkdirSync('js',{recursive:true});
fs.writeFileSync('js/main.js',moduleContent);
console.log('js/main.js written:',fs.statSync('js/main.js').size,'bytes');

// 替换 HTML 中的 <script type="module">...</script> 为外链引用
const newLines=[
    ...lines.slice(0,moduleStartIdx),
    '<script type="module" src="./js/main.js"></script>',
    ...lines.slice(moduleEndIdx+1)
];
fs.writeFileSync('3d-duck.html',newLines.join('\n'));
console.log('3d-duck.html updated. New size:',fs.statSync('3d-duck.html').size,'bytes');
console.log('Main module externalization complete.');
