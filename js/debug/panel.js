// ===== 调试面板 ——自 js/main.js 阶段 8 迁入 =====
// 依赖注入：initDebugPanel(ctx) 由 main.js 在依赖就绪后调用。
// ctx 契约：
//   getHearts(), setHearts(v), getMaxHearts(), recordHealthTransition(b,a),
//   getScore(), setScore(v), gameOver(),
//   setPendingEvent(v), setWarnedFor(v), getActiveEvent(), endEvent(),
//   pickEvent(), startEvent(key), setGlobalEventTimer(v),
//   getBlessings(), updateSettingsPanel(), getDuckModel(),
//   isFestival(key), mkCake, mkRock, mkFlower, mkZongzi, mkGrass, mkLily,
//   mkMagnet, mkHeart, mkWhirlpool, whirlpools, scene, items
import * as THREE from 'three';
import {toast,updateHeartsUI} from '../ui/hud.js';
import {formatScore} from '../core/format.js';
import {EVENTS} from '../core/config.js';

let ctx=null;
export function initDebugPanel(c){ctx=c}

let dbgNextEvent=null; // 指定下一事件（null=自动随机）
(function(){
    const meta=document.querySelector('meta[name="env"]');
    const txt=meta?meta.getAttribute('content')||'':'';
    const env={};
    txt.split(/[;&]/).forEach(kv=>{const i=kv.indexOf('=');if(i>0)env[kv.slice(0,i).trim().toUpperCase()]=kv.slice(i+1).trim()});
    window.__ENV=env;
    if((env.MODE||'prod').toLowerCase()!=='dev'){
        const btn=document.getElementById('dbg-btn');
        if(btn)btn.style.display='none';
    }
})();
document.getElementById('dbg-btn').onclick=()=>{
    const p=document.getElementById('dbg-panel');
    p.classList.toggle('show');
    if(p.classList.contains('show')){
        // 面板打开时用当前游戏值初始化显示
        const hh=document.getElementById('dbg-set-hearts');if(hh)hh.textContent=ctx.getHearts();
        const is=document.getElementById('dbg-set-score');if(is)is.value=ctx.getScore();
        updateDebugBlessingStatus();
    }
};
// 生命 +/− 按钮（本地显示值，应用修改时才写入 hearts）
function _dbgH(){const el=document.getElementById('dbg-set-hearts');return el?parseInt(el.textContent)||0:0}
function _dbgSetH(v){const el=document.getElementById('dbg-set-hearts');if(el)el.textContent=Math.max(0,Math.min(ctx.getMaxHearts(),v))}
document.getElementById('dbg-hearts-plus').onclick=()=>_dbgSetH(_dbgH()+1);
document.getElementById('dbg-hearts-minus').onclick=()=>_dbgSetH(_dbgH()-1);
// 通用自定义下拉绑定
function bindCsel(id,onChange){
    const csel=document.getElementById(id);
    if(!csel)return;
    const btn=csel.querySelector('.dbg-csel-btn');
    const list=csel.querySelector('.dbg-csel-list');
    const opts=[...list.querySelectorAll('.dbg-csel-opt')];
    const listParent=list.parentElement;
    function closeList(){
        if(list.parentElement!==listParent&&listParent)listParent.appendChild(list);
        list.style.display='';
        list.style.position='';list.style.left='';list.style.right='';list.style.top='';list.style.bottom='';list.style.width='';list.style.maxHeight='';
        csel.classList.remove('open');
    }
    csel._closeList=closeList;
    function positionList(){
        if(list.parentElement!==document.body)document.body.appendChild(list);
        const btnRect=btn.getBoundingClientRect();
        const listNaturalH=Math.min(220,opts.length*32+10);
        const belowH=window.innerHeight-btnRect.bottom-12;
        const aboveH=btnRect.top-12;
        list.style.display='block';
        list.style.position='fixed';
        list.style.left=btnRect.left+'px';
        list.style.right='auto';
        list.style.width=btnRect.width+'px';
        if(belowH<listNaturalH&&aboveH>belowH){
            list.style.maxHeight=Math.min(220,aboveH)+'px';
            list.style.top='auto';
            list.style.bottom=(window.innerHeight-btnRect.top+4)+'px';
        }else{
            list.style.maxHeight=Math.max(80,Math.min(220,belowH))+'px';
            list.style.top=(btnRect.bottom+4)+'px';
            list.style.bottom='auto';
        }
    }
    btn.addEventListener('click',e=>{
        e.stopPropagation();
        e.preventDefault();
        document.querySelectorAll('.dbg-csel.open').forEach(c=>{if(c!==csel){if(typeof c._closeList==='function')c._closeList()}});
        const willOpen=!csel.classList.contains('open');
        if(willOpen){
            csel.classList.add('open');
            positionList();
        }else{
            closeList();
        }
    });
    btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();btn.click()}});
    opts.forEach(o=>o.addEventListener('click',ev=>{
        ev.stopPropagation();
        ev.preventDefault();
        const v=o.dataset.value;
        csel.dataset.value=v;
        btn.textContent=o.textContent;
        opts.forEach(x=>x.classList.remove('sel'));
        o.classList.add('sel');
        closeList();
        if(onChange)onChange(v);
    }));
    const panel=document.getElementById('dbg-panel');
    if(panel)panel.addEventListener('scroll',()=>{if(csel.classList.contains('open'))closeList()},{passive:true});
    window.addEventListener('resize',()=>{if(csel.classList.contains('open'))positionList()},{passive:true});
}
document.addEventListener('click',e=>{if(!e.target.closest('.dbg-csel')&&!e.target.closest('.dbg-csel-list')){document.querySelectorAll('.dbg-csel.open').forEach(c=>{if(typeof c._closeList==='function')c._closeList()})}});
bindCsel('dbg-event-csel',v=>{dbgNextEvent=v||null;
    if(dbgNextEvent){ctx.setPendingEvent(dbgNextEvent);ctx.setWarnedFor(null)}else{ctx.setPendingEvent(null);ctx.setWarnedFor(null)}
});
bindCsel('dbg-spawn-csel',null);
bindCsel('dbg-blessing-csel',null);
bindCsel('dbg-festival-csel',null);
export function updateDebugBlessingStatus(){
    // 可能在 initDebugPanel 注入前被顶层调用（如 main.js 的 Blessings.generate() 之后），先做空守卫
    if(!ctx)return;
    const el=document.getElementById('dbg-blessing-status');
    const Blessings=ctx.getBlessings();
    if(!el||!Blessings)return;
    const daily=Blessings.current?.name||'未选择';
    const festival=Blessings.festival?`${Blessings.festival.name} · ${Blessings.festival.desc}`:'无节日加成';
    el.textContent=`今日：${daily}；节日：${festival}`;
}
document.getElementById('dbg-apply-blessings').onclick=()=>{
    const dailyId=document.getElementById('dbg-blessing-csel')?.dataset.value||'';
    const festivalKey=document.getElementById('dbg-festival-csel')?.dataset.value||'';
    ctx.getBlessings().applyDebugSelection(dailyId,festivalKey);
    ctx.updateSettingsPanel();
    updateDebugBlessingStatus();
    const effects=ctx.getBlessings().getEffects().map(effect=>effect.name).join(' + ');
    toast('<i class="fa-solid fa-wand-magic-sparkles"></i> 已生效：'+(effects||'无'),'s');
};
document.getElementById('dbg-trigger').onclick=()=>{
    const csel=document.getElementById('dbg-event-csel');
    const sel=csel?csel.dataset.value:'';
    // 立即触发：若有事件进行中，先结束
    if(ctx.getActiveEvent())ctx.endEvent();
    const key=sel||ctx.pickEvent();
    ctx.startEvent(key);
    ctx.setGlobalEventTimer(30);
    toast('<i class="fa-solid fa-bug"></i> 已触发：'+EVENTS[key].n,'s');
};
// 在鸭子附近生成指定物品（包括漩涡）
export function dbgSpawnItem(type,count=1){
    const duckModel=ctx.getDuckModel();
    if(!duckModel){toast('<i class="fa-solid fa-bug"></i> 鸭子未加载','m');return}
    const dp=duckModel.position;
    for(let i=0;i<count;i++){
        const ang=Math.random()*Math.PI*2,dist=3+Math.random()*8;
        const x=dp.x+Math.cos(ang)*dist,z=dp.z+Math.sin(ang)*dist;
        if(type==='whirlpool'){
            const w=ctx.mkWhirlpool(x,z);
            // mkWhirlpool 内部已完成 scene.add 与 whirlZones.push，此处只需登记数组
            ctx.whirlpools.push(w);
        }else{
            let mesh,radius;
            switch(type){
                case'rock':{const rs=.3+Math.random()*.5;const rm=1+Math.floor(Math.random()*5)*.5;mesh=ctx.isFestival('festival_national_day')?ctx.mkCake(new THREE.Vector3(x,-.1,z),rs):ctx.mkRock(new THREE.Vector3(x,-.1,z),rs);mesh.scale.multiplyScalar(rm);radius=rs*1.2*rm;break}
                case'flower':{const fm=1+Math.floor(Math.random()*3)*.5;mesh=ctx.mkFlower(x,z);mesh.scale.multiplyScalar(fm);radius=.4*fm;break}
                case'grass':{const gm=1+Math.floor(Math.random()*3)*.5;mesh=ctx.isFestival('festival_dragon_boat')?ctx.mkZongzi(x,z):ctx.mkGrass(x,z,5+Math.floor(Math.random()*4));mesh.scale.multiplyScalar(gm);radius=.4*gm;break}
                case'lily':{const ls=.3+Math.random()*.25;const lm=1+Math.floor(Math.random()*3)*.5;mesh=ctx.mkLily(x,z,ls);mesh.scale.multiplyScalar(lm);radius=ls*lm;break}
                case'magnet':{const mm=1+Math.floor(Math.random()*3)*.5;mesh=ctx.mkMagnet(x,z);mesh.scale.multiplyScalar(mm);radius=.35*mm;break}
                case'heart':{mesh=ctx.mkHeart(x,z);radius=.6;break}
                default:continue;
            }
            if(mesh){ctx.scene.add(mesh);ctx.items.push({mesh,type,r:radius,coll:false})}
        }
    }
    const lbl={flower:'花',grass:'水草',lily:'荷叶',rock:'石头',heart:'血瓶',magnet:'磁铁',whirlpool:'漩涡'}[type]||type;
    toast('<i class="fa-solid fa-bug"></i> 已生成 '+count+' 个'+lbl,'s');
}
document.getElementById('dbg-spawn-1').onclick=()=>{const csel=document.getElementById('dbg-spawn-csel');dbgSpawnItem(csel?csel.dataset.value:'flower',1)};
document.getElementById('dbg-spawn-5').onclick=()=>{const csel=document.getElementById('dbg-spawn-csel');dbgSpawnItem(csel?csel.dataset.value:'flower',5)};
// 修改生命和分数
document.getElementById('dbg-apply').onclick=()=>{
    const h=_dbgH();
    const s=parseInt(document.getElementById('dbg-set-score').value)||0;
    const beforeHearts=ctx.getHearts();ctx.setHearts(Math.max(0,Math.min(ctx.getMaxHearts(),h)));ctx.recordHealthTransition(beforeHearts,ctx.getHearts());
    ctx.setScore(Math.max(0,s));
    updateHeartsUI();
    document.getElementById('score').textContent=formatScore(ctx.getScore());
    if(ctx.getHearts()<=0)ctx.gameOver();
    toast('<i class="fa-solid fa-bug"></i> 已修改：'+ctx.getHearts()+'心 / '+ctx.getScore()+'分','s');
};
