// localStorage 包装：提供统一的读写与 JSON 帮手
// 仅在浏览器环境下生效；Node 测试环境注入 _store 即可复用
//
// 注意：本轮重构仅引入此模块，不强制改写所有 localStorage 调用点。
// 既有 key（duck_*、achievements_data、blessing_* 等）和保存格式完全不变。
// 新代码请优先使用本模块；旧调用点随其所属子系统迁移时再切换。

const _store=(typeof localStorage!=='undefined')?localStorage:null;

/** 读取原始字符串值；不存在时返回 defaultValue */
export function get(key,defaultValue=null){
    if(!_store)return defaultValue;
    const v=_store.getItem(key);
    return v===null?defaultValue:v;
}

/** 写入原始字符串值 */
export function set(key,value){
    if(_store)_store.setItem(key,value);
}

/** 移除指定 key */
export function remove(key){
    if(_store)_store.removeItem(key);
}

/** 读取并解析 JSON；解析失败或不存在时返回 defaultValue */
export function getJSON(key,defaultValue=null){
    const v=get(key);
    if(v===null||v===undefined)return defaultValue;
    try{return JSON.parse(v)}catch(e){return defaultValue}
}

/** 序列化为 JSON 后写入 */
export function setJSON(key,value){
    set(key,JSON.stringify(value));
}

/** 用于测试或非浏览器环境注入伪 storage */
export function _setStore(fakeStore){
    // 仅测试时使用；浏览器中 localStorage 不可替换
    if(typeof globalThis!=='undefined'){
        Object.defineProperty(globalThis,'localStorage',{value:fakeStore,configurable:true,writable:true});
    }
}
