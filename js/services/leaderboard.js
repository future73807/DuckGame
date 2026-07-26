// 排行榜服务：API 连接、数据读写、分数提交、用户身份管理
// 依赖：genUUID (core/format.js)、fetch、localStorage、crypto.subtle
// Leaderboard 是 const 对象，引用稳定，main.js import 后可直接注入给 share-card.js 等模块
import {genUUID} from '../core/format.js';

const FILE_NAME='leaderboard.json';
// 后端固定端口 8123；前端无论在哪个端口（5500/8123/其他）都通过 hostname:8123 访问后端
const BACKEND_PORT=8123;
const NAME_KEY='duck_name';
const USER_ID_KEY='duck_user_id';

function genDefaultName(){
    const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const d=Leaderboard.get();
    for(let attempt=0;attempt<10;attempt++){
        let s='';
        for(let i=0;i<5;i++)s+=letters.charAt(Math.floor(Math.random()*letters.length));
        const name='勇敢鸭鸭'+s;
        if(!d.entries.find(e=>e.name===name))return name;
    }
    return '勇敢鸭鸭'+Date.now().toString(36);
}

export const Leaderboard={
    FILE_NAME,
    BACKEND_PORT,
    get API_URLS(){
        const base=location.protocol+'//'+location.hostname+':'+BACKEND_PORT+'/api/leaderboard';
        return [base,(location.origin+'/api/leaderboard'),'/api/leaderboard','server.node.js'];
    },
    _apiMode:null,
    NAME_KEY,
    USER_ID_KEY,
    INIT_UUID:'a1b2c3d4-1234-4abc-8def-1234567890ab',
    cache:{entries:[]},
    loaded:false,
    _apiURL:null,
    async _hasAPI(){
        if(this._apiURL)return this._apiURL;
        const urls=this.API_URLS;  // 取一次 getter，避免循环中重复调用
        for(const u of urls){
            try{
                const r=await fetch(u,{method:'GET'});
                if(r.ok){
                    this._apiURL=u;
                    if(u.includes('localhost')||u.includes('127.0.0.1'))this._apiMode='本地服务器';
                    else if(u==='/api/leaderboard')this._apiMode='同域API';
                    else this._apiMode='云函数';
                    return u;
                }
            }catch(e){}
        }
        return null;
    },
    async load(){
        if(this.loaded)return this.cache;
        const apiURL=await this._hasAPI();
        if(apiURL){
            try{
                const r=await fetch(apiURL,{method:'GET'});
                if(r.ok){
                    const parsed=await r.json();
                    this.cache=(parsed&&Array.isArray(parsed.entries))?parsed:{entries:[]};
                    this.loaded=true;
                    console.log('%c排行榜已连接 ['+this._apiMode+'模式] → '+apiURL,'color:#4CAF50;font-weight:bold');
                    return this.cache;
                }
            }catch(e){}
        }
        try{
            const r=await fetch('./'+FILE_NAME);
            if(r.ok){
                const parsed=await r.json();
                this.cache=(parsed&&Array.isArray(parsed.entries))?parsed:{entries:[]};
                this.loaded=true;
                console.log('%c排行榜：静态文件模式（只读，无后端）','color:#FF9800;font-weight:bold');
                return this.cache;
            }
        }catch(e){}
        const local=localStorage.getItem('duck_lb_cache');
        if(local){
            try{this.cache=JSON.parse(local)}catch(e){}
        }
        this.loaded=true;
        console.log('%c排行榜：本地缓存模式（数据不共享）','color:#f44336;font-weight:bold');
        console.log('%c提示：运行 node server.node.js 启动本地服务器，排行榜可同步','color:#2196F3');
        return this.cache;
    },
    // 同步读取（内存缓存）
    get(){
        const c=this.cache;
        if(!c||typeof c!=='object'||!Array.isArray(c.entries))return{entries:[]};
        return c;
    },
    // 保存：优先 API 写入服务器，失败则 localStorage 兜底
    async save(d){
        this.cache=d;
        const apiURL=this._apiURL||await this._hasAPI();
        if(apiURL){
            try{
                const r=await fetch(apiURL,{
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify(d)
                });
                if(r.ok){
                    const result=await r.json();
                    if(result.ok){
                        console.log('%c排行榜已保存到 ['+this._apiMode+'] '+apiURL,'color:#4CAF50');
                        return true;
                    }
                }
            }catch(e){}
        }
        try{
            localStorage.setItem('duck_lb_cache',JSON.stringify(d));
            console.log('%c排行榜已保存到本地缓存','color:#FF9800');
        }catch(e){}
        return false;
    },
    // 提交分数（异步，密码哈希需要 Web Crypto API）
    // 返回 { data, entry, nameConflict, conflictedName, pwdWrong }
    async submit(sc,pt,name,pwd){
        const d=this.get();
        if(!Array.isArray(d.entries))d.entries=[];
        const cachedName=localStorage.getItem(NAME_KEY);
        const inputName=name||cachedName||genDefaultName();
        let userId=this.getUserId();
        // 重名检测：其他用户(userId不同)已用相同昵称
        const conflictEntry=d.entries.find(e=>e&&e.userId!==userId&&e.name===inputName);
        if(conflictEntry){
            if(conflictEntry.pwdHash){
                // 有密码保护 → 需要验证密码
                if(!pwd){
                    return{data:d,entry:null,nameConflict:true,conflictedName:inputName,pwdWrong:true};
                }
                const inputHash=await this._hashPwd(pwd);
                if(inputHash!==conflictEntry.pwdHash){
                    return{data:d,entry:null,nameConflict:true,conflictedName:inputName,pwdWrong:true};
                }
                // 密码正确 → 绑定到该记录（更新userId为当前用户）
                conflictEntry.userId=userId;
                localStorage.setItem(USER_ID_KEY,userId);
                // 绑定后判断是否更新分数（高分覆盖）
                if(sc>conflictEntry.score){conflictEntry.score=sc;conflictEntry.playTime=pt;conflictEntry.ts=Date.now()}
                if(pwd)conflictEntry.pwdHash=await this._hashPwd(pwd);
                d.entries.sort((a,b)=>{const sa=a.score||0,sb=b.score||0;if(sb!==sa)return sb-sa;return (a.playTime||0)-(b.playTime||0)});
                d.entries=d.entries.slice(0,50);
                await this.save(d);
                return{data:d,entry:conflictEntry,nameConflict:false,pwdWrong:false};
            }else{
                // 无密码保护 → 直接绑定到该记录
                conflictEntry.userId=userId;
                localStorage.setItem(USER_ID_KEY,userId);
                // 绑定后判断是否更新分数（高分覆盖）
                if(sc>conflictEntry.score){conflictEntry.score=sc;conflictEntry.playTime=pt;conflictEntry.ts=Date.now()}
                d.entries.sort((a,b)=>{const sa=a.score||0,sb=b.score||0;if(sb!==sa)return sb-sa;return (a.playTime||0)-(b.playTime||0)});
                d.entries=d.entries.slice(0,50);
                await this.save(d);
                return{data:d,entry:conflictEntry,nameConflict:false,pwdWrong:false};
            }
        }
        // 用 userId 匹配当前用户的记录
        let existingEntry=d.entries.find(e=>e&&e.userId===userId);
        // 改名检测：用户换了昵称，删除旧名称的记录（避免旧记录残留）
        const oldName=cachedName&&cachedName!==inputName?cachedName:null;
        if(oldName){
            d.entries=d.entries.filter(e=>!(e&&e.userId===userId&&e.name===oldName));
            existingEntry=d.entries.find(e=>e&&e.userId===userId);
        }
        if(existingEntry){
            existingEntry.name=inputName;
            if(sc>existingEntry.score){existingEntry.score=sc;existingEntry.playTime=pt;existingEntry.ts=Date.now()}
            if(pwd)existingEntry.pwdHash=await this._hashPwd(pwd);
        }else{
            const entry={name:inputName,score:sc,playTime:pt,ts:Date.now(),userId,id:genUUID()};
            if(pwd)entry.pwdHash=await this._hashPwd(pwd);
            d.entries.push(entry);
            existingEntry=entry;
        }
        d.entries.sort((a,b)=>{
            const sa=a.score||0,sb=b.score||0;
            if(sb!==sa)return sb-sa;
            return (a.playTime||0)-(b.playTime||0);
        });
        d.entries=d.entries.slice(0,50);
        await this.save(d);
        return{data:d,entry:existingEntry,nameConflict:false,pwdWrong:false};
    },
    // 使用 Web Crypto API 进行真正的 SHA-256 哈希加密
    async _hashPwd(pwd){
        const salt='DuckGame2025!@#Salt';
        const data=new TextEncoder().encode(salt+pwd+salt);
        const hashBuffer=await crypto.subtle.digest('SHA-256',data);
        const hashArray=Array.from(new Uint8Array(hashBuffer));
        const hashHex=hashArray.map(b=>b.toString(16).padStart(2,'0')).join('');
        return hashHex;
    },
    // 生成/获取持久化的 userId（uuid），首次访问时生成并存 localStorage
    getUserId(){
        let id=localStorage.getItem(USER_ID_KEY);
        if(!id){id=genUUID();localStorage.setItem(USER_ID_KEY,id)}
        return id;
    },
    // 当前用户的历史最高分（只看自己的，不是全局第一）
    myBest(){
        const d=this.get(),uid=this.getUserId();
        const mine=d.entries.filter(e=>e&&e.userId===uid);
        if(!mine.length)return 0;
        return Math.max(...mine.map(e=>e.score||0));
    },
    best(){const d=this.get();return d.entries[0]?d.entries[0].score:0},
    getCachedName(){return localStorage.getItem(NAME_KEY)||''},
    setCachedName(name){localStorage.setItem(NAME_KEY,name)},
    isBound(){return true}
};

export {genDefaultName};
