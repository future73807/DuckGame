// 客户端语法检查：递归解析 js/**/*.js 和 3d-duck.html 内联 module，使用 Acorn sourceType:'module'
// 出错时返回非零退出码，便于 CI/预提交钩子使用
const fs=require('fs');
const path=require('path');
const acorn=require('acorn');

let hasError=false;

// 1. 递归收集 js/**/*.js
function collectJs(dir,out){
    if(!fs.existsSync(dir))return;
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
        const full=path.join(dir,entry.name);
        if(entry.isDirectory())collectJs(full,out);
        else if(entry.name.endsWith('.js'))out.push(full);
    }
}

const jsFiles=[];
collectJs('js',jsFiles);

// 2. 解析单个文件/源码
function checkSource(src,label){
    try{
        acorn.parse(src,{ecmaVersion:2022,sourceType:'module'});
        console.log('OK:',label);
    }catch(e){
        hasError=true;
        const loc=e.loc?` line ${e.loc.line} col ${e.loc.column}`:'';
        console.error(`ERR: ${label}${loc}: ${e.message}`);
    }
}

// 3. 检查 js/**/*.js
for(const f of jsFiles){
    const src=fs.readFileSync(f,'utf8');
    checkSource(src,f);
}

// 4. 检查 3d-duck.html 内联 module（迁移过渡期保留）
if(fs.existsSync('3d-duck.html')){
    const html=fs.readFileSync('3d-duck.html','utf8');
    const m=html.match(/<script[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/);
    if(m&&m[1].trim()){
        checkSource(m[1],'3d-duck.html (inline module)');
    }
}

// 5. 检查 3d-duck.html 内联非 module 脚本（boot 脚本等）
//    排除 type="module"、type="importmap" 和带 src= 的脚本
if(fs.existsSync('3d-duck.html')){
    const html=fs.readFileSync('3d-duck.html','utf8');
    const re=/<script(?![^>]*type=["'](?:module|importmap)["'])(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
    let mm;
    while((mm=re.exec(html))!==null){
        if(mm[1].trim()){
            checkSource(mm[1],'3d-duck.html (inline classic script)');
        }
    }
}

if(hasError){
    console.error('\nSyntax check FAILED.');
    process.exit(1);
}else{
    console.log('\nSyntax check PASSED.');
    process.exit(0);
}
