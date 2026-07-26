// UI 覆盖层：暂停、教程、设置、结算（排行榜详情）、重开
// 依赖通过 setOverlaysCtx 注入：{ isPaused, setIsPaused, gameActive, setGameActive,
//   playStartTime, score, runStats, hearts, MAX_HEARTS, lastEntry,
//   Leaderboard, Duo, toast, resetRunState, startGameSession, updateSettingsPanel }
// 这样可避免与 main.js 产生循环导入，同时保持 UI 模块无状态侵入
//
// 模块内私有状态：
//   settingsPausedGame —— 打开设置时若游戏进行中且未暂停，则自动暂停；关闭时恢复
//   tutorialStep       —— 教程当前步索引
// 教程步进与 window.* 桥接：nextTutorialStep / skipTutorial 仍由 HTML 内联按钮调用

import {formatScore,formatTime,formatDate,escapeHtml} from '../core/format.js';

let _ctx=null;

/** 由 main.js 在初始化阶段注入依赖 */
export function setOverlaysCtx(ctx){
    _ctx=ctx;
}

// ===== 暂停 / 退出 =====
export function togglePause(forceState,silent){
    const {gameActive,isPaused,setIsPaused,playStartTime,score,runStats,hearts,MAX_HEARTS}=_ctx||{};
    if(!gameActive())return;
    // forceState: true=强制暂停, false=强制恢复, undefined=切换
    if(forceState!==undefined)setIsPaused(forceState);
    else setIsPaused(!isPaused());
    const overlay=document.getElementById('pause-overlay');
    if(isPaused()){
        // 更新暂停界面统计
        const pt=playStartTime()?Math.floor((Date.now()-playStartTime())/1000):0;
        const m=Math.floor(pt/60),s=pt%60;
        document.getElementById('ps-score').textContent=formatScore(score());
        document.getElementById('ps-time').textContent=(m>0?m+'分':'')+s+'秒';
        document.getElementById('ps-items').textContent=(runStats()&&runStats().items)||0;
        document.getElementById('ps-hearts').textContent=hearts()+' / '+MAX_HEARTS();
        if(!silent)overlay.classList.add('show');
    }else{
        overlay.classList.remove('show');
    }
}

export function quitGame(){
    const {setIsPaused,setGameActive}=_ctx||{};
    setIsPaused(false);
    document.getElementById('pause-overlay').classList.remove('show');
    setGameActive(false);
    location.reload();
}

// ===== 设置面板 =====
let settingsPausedGame=false;

export function openSettings(){
    const {gameActive,isPaused,updateSettingsPanel}=_ctx||{};
    settingsPausedGame=gameActive()&&!isPaused();
    if(settingsPausedGame)togglePause(true,true);
    updateSettingsPanel&&updateSettingsPanel();
    document.getElementById('settings-modal').classList.add('show');
}

export function closeSettings(){
    const {isPaused,gameActive}=_ctx||{};
    document.getElementById('settings-modal').classList.remove('show');
    if(settingsPausedGame&&isPaused()&&gameActive())togglePause(false,true);
    settingsPausedGame=false;
}

// ===== 排行榜详情弹窗（结算后查看 / 主菜单查看） =====
export function showDetailModal(mode='solo'){
    const {Leaderboard}=_ctx||{};
    const d=Leaderboard.get();
    const list=document.getElementById('dm-list');
    document.querySelectorAll('.rank-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.rank===mode));
    if(mode==='duo'){
        const entries=Array.isArray(d.duoEntries)?d.duoEntries:[];
        if(!entries.length){list.innerHTML='<div class="lb-empty">暂无双人战绩</div>';}else{list.innerHTML=entries.map((entry,index)=>{
            const top=index<3?'top'+(index+1):'';const names=(entry.players||[]).map(player=>escapeHtml(player.name)).join(' & ')||escapeHtml(entry.name||'双人队伍');
            return `<div class="dm-item ${top}"><span class="rk">${index+1}</span><span class="nm">${names}</span><span class="sc">${formatScore(entry.score)}</span><span class="pt">${formatTime(entry.playTime||0)}</span><span class="ts">${formatDate(entry.ts||Date.now())}</span></div>`;
        }).join('');}
    }else if(!d.entries.length){list.innerHTML='<div class="lb-empty">暂无记录</div>';}else{list.innerHTML=d.entries.map((entry,index)=>{
        const top=index<3?'top'+(index+1):'';return `<div class="dm-item ${top}"><span class="rk">${index+1}</span><span class="nm">${escapeHtml(entry.name)}</span><span class="sc">${formatScore(entry.score)}</span><span class="pt">${formatTime(entry.playTime)}</span><span class="ts">${formatDate(entry.ts)}</span></div>`;
    }).join('');}
    document.getElementById('detail-modal').classList.add('show');
}

// ===== 重开 =====
export async function restartGame(){
    const {Leaderboard,Duo,toast,lastEntry,resetRunState,startGameSession,genDefaultName}=_ctx||{};
    // 如果用户在输入框改了名（与缓存不同），先更新缓存和记录
    const cachedName=Leaderboard.getCachedName();
    const inputEl=document.getElementById('go-name');
    const inputValue=inputEl?(inputEl.value||'').trim():'';
    if(inputValue&&inputValue!==cachedName){
        // 用户改了名但没点"确定"，尝试更新
        Leaderboard.setCachedName(inputValue);
        if(lastEntry()){
            const d=Leaderboard.get();
            const e=d.entries.find(x=>x.id===lastEntry().id);
            if(e){e.name=inputValue;Leaderboard.save(d)}
        }
    }else if(!cachedName){
        const v=inputValue||genDefaultName();
        Leaderboard.setCachedName(v);
        if(lastEntry()){
            const d=Leaderboard.get();
            const e=d.entries.find(x=>x.id===lastEntry().id);
            if(e){e.name=v;Leaderboard.save(d)}
        }
    }
    if(Duo.active){
        try{await Duo.restart();}catch(error){
            const messages={ONLY_HOST_CAN_RESTART:'请等待房主开启下一局。',WAITING_FOR_FRIEND:'好友尚未结束本局，暂时不能开启下一局。'};
            toast(messages[error.message]||'无法开启下一局，请稍后重试。','m');
        }
        return;
    }
    resetRunState();
    startGameSession();
}

// ===== 新手教程 =====
let tutorialStep=0;
const TUTORIAL_TOTAL_STEPS=4;

export function showTutorial(){
    const {gameActive,isPaused}=_ctx||{};
    tutorialStep=0;
    updateTutorialStep();
    document.getElementById('tutorial').classList.add('show');
    // 教程显示时自动暂停游戏（避免后台出事）
    if(gameActive()&&!isPaused())togglePause(true,true);
}

export function updateTutorialStep(){
    document.querySelectorAll('#tutorial .tut-step').forEach((el,i)=>el.classList.toggle('active',i===tutorialStep));
    document.querySelectorAll('#tutorial .tut-dot').forEach((el,i)=>{
        el.classList.toggle('active',i===tutorialStep);
        el.classList.toggle('done',i<tutorialStep);
    });
    const curEl=document.getElementById('tut-cur');
    if(curEl)curEl.textContent=tutorialStep+1;
    const nextBtn=document.getElementById('tut-next');
    if(tutorialStep>=TUTORIAL_TOTAL_STEPS-1){
        nextBtn.innerHTML='<i class="fa-solid fa-check"></i> 开始游戏';
    }else{
        nextBtn.innerHTML='下一步 <i class="fa-solid fa-arrow-right" style="font-size:11px"></i>';
    }
}

export function nextTutorialStep(){
    tutorialStep++;
    if(tutorialStep>=TUTORIAL_TOTAL_STEPS){
        finishTutorial();
    }else{
        updateTutorialStep();
    }
}

export function skipTutorial(){
    finishTutorial();
}

export function finishTutorial(){
    const {isPaused,gameActive}=_ctx||{};
    document.getElementById('tutorial').classList.remove('show');
    localStorage.setItem('tutorial_done','1');
    // 关闭教程时如果游戏被自动暂停了，恢复运行
    if(isPaused()&&gameActive())togglePause();
}
