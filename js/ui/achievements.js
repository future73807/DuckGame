// 成就面板：成就列表与弹层渲染
// 依赖通过 setAchievementsCtx 注入：
//   { Achievements, isPaused, gameActive, togglePause }
//   - Achievements:  成就数据/逻辑对象（const 引用，直接传）
//   - isPaused/gameActive:  getter 函数（() => boolean），因为 main.js 中是 let 变量
//   - togglePause:  函数引用（(...args) => window.togglePause(...args)），因 window 后赋值
// Achievements 对象本身（数据/逻辑）仍留在 main.js，待阶段7玩法子系统迁移时再处理
let _ctx=null;

/** 由 main.js 在初始化阶段注入依赖 */
export function setAchievementsCtx(ctx){
    _ctx=ctx;
}

function rewardText(r){
    if(!r)return'';
    const parts=[];
    if(r.scoreBonus)parts.push('得分+'+Math.round(r.scoreBonus*100)+'%');
    if(r.speedBonus)parts.push('速度+'+Math.round(r.speedBonus*100)+'%');
    if(r.shieldBonus)parts.push('护盾+'+Math.round(r.shieldBonus*100)+'%');
    if(r.whirlResist)parts.push('漩涡抗性+'+Math.round(r.whirlResist*100)+'%');
    if(r.streakBonus)parts.push('连胜+'+r.streakBonus+'s');
    if(r.maxHearts)parts.push('生命+'+r.maxHearts);
    return parts.length?'<i class="fa-solid fa-gift"></i> '+parts.join(' · '):'';
}

export function showAchievements(){
    const {Achievements,isPaused,gameActive,togglePause}=_ctx||{};
    const list=Achievements.getList();
    const listEl=document.getElementById('ach-list');
    const rewards=Achievements.getRewards();
    const unlockedCount=list.filter(a=>a.unlocked).length;
    const _isPaused=isPaused();
    const _gameActive=gameActive();
    // 副标题
    document.getElementById('ach-sub').textContent=`解锁 ${unlockedCount} / ${list.length} · 永久成长属性`;
    // 汇总卡片
    const sumEl=document.getElementById('ach-summary');
    const sumItems=[
        {lbl:'已解锁',val:unlockedCount+'<small>/'+list.length+'</small>'},
        {lbl:'得分加成',val:'+'+Math.round((rewards.scoreBonus||0)*100)+'%'},
        {lbl:'速度加成',val:'+'+Math.round((rewards.speedBonus||0)*100)+'%'},
        {lbl:'生命上限',val:'+'+(rewards.maxHearts||0)}
    ];
    sumEl.innerHTML=sumItems.map(s=>`<div class="ach-sum-item"><div class="lbl">${s.lbl}</div><div class="val">${s.val}</div></div>`).join('');
    // 成就列表
    listEl.innerHTML=list.map(a=>{
        const cur=Math.min(a.current,a.target);
        const pct=Math.round(a.progress*100);
        const curText=a.stat==='totalDistance'?Math.round(cur)+'m':a.stat==='playTime'?Math.floor(cur/60)+'分'+(cur%60)+'秒':cur;
        const tgtText=a.stat==='totalDistance'?a.target+'m':a.stat==='playTime'?Math.floor(a.target/60)+'分':a.target;
        return `<div class="ach-card ${a.unlocked?'unlocked':''}">
            <div class="ach-icon"><i class="fa-solid ${a.icon}"></i></div>
            <div class="ach-body">
                <div class="ach-name">${a.name} ${a.unlocked?'<i class="fa-solid fa-check-circle ach-check"></i>':''}</div>
                <div class="ach-desc">${a.desc}</div>
                <div class="ach-reward">${rewardText(a.reward)||''}</div>
                <div class="ach-progress">
                    <div class="ach-bar"><div class="ach-bar-fill" style="width:${a.unlocked?100:pct}%"></div></div>
                    <div class="ach-prog-text">${a.unlocked?'已完成':curText+' / '+tgtText}</div>
                </div>
            </div>
        </div>`}).join('');
    document.getElementById('ach-modal').classList.add('show');
    // 清除"有新成就"高亮
    document.getElementById('ach-btn').classList.remove('has-new');
    // 打开成就面板时自动暂停游戏（防止鸭子在后台死亡）
    if(_gameActive&&!_isPaused)togglePause(true,true);
}

export function closeAchievements(){
    const {isPaused,gameActive,togglePause}=_ctx||{};
    const _isPaused=isPaused();
    const _gameActive=gameActive();
    document.getElementById('ach-modal').classList.remove('show');
    // 关闭面板时恢复游戏（如果之前被自动暂停）
    if(_isPaused&&_gameActive)togglePause();
}
