const fs=require('fs');
const acorn=require('acorn');
const src=fs.readFileSync('3d-duck.html','utf8');
const m=src.match(/<script[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/);
if(!m){console.log('NO module script found');process.exit(1);}
try{
  acorn.parse(m[1],{ecmaVersion:2022,sourceType:'module'});
  console.log('OK: syntax valid');
}catch(e){
  console.log('ERR line',e.loc&&e.loc.line,'col',e.loc&&e.loc.column,':',e.message);
}
