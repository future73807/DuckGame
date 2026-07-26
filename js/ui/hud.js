// HUD/Toast/事件提示
// 依赖通过 setHudCtx 注入：
//   { hearts, MAX_HEARTS, streakItems, activeEventTime }
//   - hearts/MAX_HEARTS/streakItems/activeEventTime 均为 main.js 中的 let 变量，
//     必须传 getter 函数（() => value），否则传入的是当时的值快照，会过时
// toast/hideEventHud/showWarn/hideWarn 不依赖外部状态，可直接调用
// EV_TINT/EV_BORDER/STREAK_ICONS/STREAK_COLORS 从 core/config.js 直接 import
import {EV_TINT,EV_BORDER,STREAK_ICONS,STREAK_COLORS} from '../core/config.js';

let _ctx=null;

/** 由 main.js 在初始化阶段注入依赖 */
export function setHudCtx(ctx){
    _ctx=ctx;
}

// ===== Toast（全局轻提示） =====
export function toast(t,type){
    const el=document.getElementById('toast');
    document.getElementById('toast-text').innerHTML=t;
    el.className='toast show '+type;
    setTimeout(()=>el.className='toast',1200);
}

// ===== 血量 HUD =====
export function updateHeartsUI(){
    const {hearts,MAX_HEARTS}=_ctx||{};
    const el=document.getElementById('hearts-hud');
    if(!el)return;
    const h=hearts(),mh=MAX_HEARTS();
    let html='';
    for(let i=0;i<mh;i++){
        html+=`<span class="hp ${i<h?'':'empty'}"><i class="fa-solid fa-heart"></i></span>`;
    }
    el.innerHTML=html;
}

// ===== 三连收集栏 HUD =====
export function updateStreakUI(){
    const {streakItems}=_ctx||{};
    const hud=document.getElementById('streak-hud');
    const si=streakItems();
    for(let i=0;i<3;i++){
        const el=document.getElementById('s'+i);
        if(i<si.length){
            el.className='si active';
            el.innerHTML=`<i class="fa-solid ${STREAK_ICONS[si[i]]||'fa-circle'}"></i>`;
            el.style.color=STREAK_COLORS[si[i]]||'#fff';
        }else{
            el.className='si';
            el.innerHTML='●';
            el.style.color='rgba(255,255,255,.3)';
        }
    }
    hud.style.display='flex';
}

// ===== 事件 HUD（顶部事件状态条） =====
export function showEventHud(e){
    const {activeEventTime}=_ctx||{};
    const el=document.getElementById('event-hud');
    el.style.display='flex';
    el.style.background=EV_TINT[e.t]||'rgba(0,0,0,.5)';
    el.style.borderColor=EV_BORDER[e.t]||'rgba(255,255,255,.1)';
    el.querySelector('.ev-icon').innerHTML='<i class="fa-solid '+e.ic+'"></i>';
    el.querySelector('.ev-name').textContent=e.n;
    el.querySelector('.ev-fx').textContent=e.fx||'';
    el.querySelector('.ev-time').textContent=Math.ceil(activeEventTime())+'s';
}

export function hideEventHud(){
    document.getElementById('event-hud').style.display='none';
}

// ===== 事件预警（红色/绿色闪光横幅） =====
export function showWarn(e){
    const el=document.getElementById('event-warn');
    el.style.background=EV_TINT[e.t]||'rgba(200,40,40,.85)';
    el.style.borderColor=EV_BORDER[e.t]||'rgba(255,255,255,.1)';
    // 边框发光颜色与事件类型一致（通过 CSS 变量驱动 warnPulse 动画）
    const glowMap={good:'rgba(90,230,150,1)',bad:'rgba(255,80,80,1)',neutral:'rgba(255,220,110,1)'};
    el.style.setProperty('--warn-glow',glowMap[e.t]||'rgba(255,80,80,1)');
    el.querySelector('.warn-txt').innerHTML=' 即将来临：<i class="fa-solid '+e.ic+'"></i> '+e.n+' · '+(e.fx||'');
    el.classList.add('show');
}

export function hideWarn(){
    document.getElementById('event-warn').classList.remove('show');
}
