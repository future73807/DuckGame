import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {genUUID,escapeHtml,formatTime,formatDate,formatScore} from './core/format.js';
import {EVENTS,EV_TINT,EV_BORDER,EV_W_NORMAL,EV_W_MERCY,STREAK_ICONS,STREAK_COLORS,DEFAULT_DUCK_SKIN,DUCK_SKINS,WING_BLOBS,isValidDuckSkin} from './core/config.js';
import * as Storage from './core/storage.js';
import {showShareModal,downloadShareCard,closeShareModal,setShareCardCtx} from './ui/share-card.js';
import {showAchievements,closeAchievements,setAchievementsCtx} from './ui/achievements.js';
import {toast,updateHeartsUI,updateStreakUI,showEventHud,hideEventHud,showWarn,hideWarn,setHudCtx} from './ui/hud.js';
import {Leaderboard,genDefaultName} from './services/leaderboard.js';
import {togglePause,quitGame,openSettings,closeSettings,showDetailModal,restartGame,showTutorial,updateTutorialStep,nextTutorialStep,skipTutorial,finishTutorial,setOverlaysCtx} from './ui/overlays.js';
import {createSwirlPostfx} from './render/postfx.js';
import {createRuntime} from './render/runtime.js';
import {createWater} from './render/water.js';
import {createEnvironment} from './render/environment.js';

// ===== 检测 =====
const isMobile=/Mobi|Android|iPhone/i.test(navigator.userAgent)||('ontouchstart' in window&&innerWidth<1024);
function checkO(){if(isMobile&&innerHeight>innerWidth){document.getElementById('rotate-hint').style.display='flex';return false}document.getElementById('rotate-hint').style.display='none';return true}
checkO();window.addEventListener('resize',checkO);window.addEventListener('orientationchange',()=>setTimeout(checkO,300));
if(isMobile)document.getElementById('joy-zone').style.display='block';
document.getElementById('tutorial').dataset.device=isMobile?'mobile':'desktop';
document.getElementById('tut-device').innerHTML=isMobile?'<i class="fa-solid fa-mobile-screen-button"></i> 手机触控':'<i class="fa-solid fa-display"></i> 键盘与鼠标';
document.getElementById('help').dataset.device=isMobile?'mobile':'desktop';

// 全屏
document.getElementById('fs-btn').onclick=()=>{const el=document.documentElement;if(!document.fullscreenElement){(el.requestFullscreen||el.webkitRequestFullscreen).call(el)}else{(document.exitFullscreen||document.webkitExitFullscreen).call(document)}};
document.addEventListener('fullscreenchange',()=>{document.querySelector('#fs-btn i').className=document.fullscreenElement?'fa-solid fa-compress':'fa-solid fa-expand';dispatchEvent(new Event('resize'))});

// 音乐
let audioCtx=null,musicOn=localStorage.getItem('duck_music')!=='0',sfxOn=localStorage.getItem('duck_sfx')!=='0',musicGain=null,musicOscs=[];
function initAudio(){
    if(audioCtx)return;
    try{
        audioCtx=new(window.AudioContext||window.webkitAudioContext)();
        musicGain=audioCtx.createGain();musicGain.gain.value=.62;musicGain.connect(audioCtx.destination);
    }catch(e){console.warn('AudioContext 创建失败',e);audioCtx=null}
}
// 音乐：轻快流畅版 BGM —— C 大调 120 BPM，平滑旋律 + 4 拍长贝斯 + 轻底鼓 + 稀疏镲，避免过度跳跃
// 流畅感来自：连绵旋律（4 拍音 + 2 拍音交替）+ 拉长断奏（dur=拍*0.6）+ 4 拍长贝斯铺垫 + 无切分
// 好听感来自：C-Am-Dm-G 经典卡农进行 + 三度和声 + 高音装饰 + 三角波圆润音色
let _bgmTimer=null,_noiseBuf=null;
function startBGM(){
    if(!audioCtx)return;
    // 节拍：120 BPM → 每拍 0.5s（中等偏慢，舒服的轻快节奏）
    const BPM=120,beat=60/BPM,sixteenth=beat/4,eighth=beat/2;
    // C 大调音阶频率
    const N={C2:65.41,D2:73.42,E2:82.41,F2:87.31,G2:98.00,A2:110.00,B2:123.47,
             C3:130.81,D3:146.83,E3:164.81,F3:174.61,G3:196.00,A3:220.00,B3:246.94,
             C4:261.63,D4:293.66,E4:329.63,F4:349.23,G4:392.00,A4:440.00,B4:493.88,
             C5:523.25,D5:587.33,E5:659.25,F5:698.46,G5:783.99,A5:880.00,B5:987.77,
             C6:1046.50};
    // 准备白噪声 buffer（用于打击乐，复用）
    if(!_noiseBuf||_noiseBuf.sampleRate!==audioCtx.sampleRate){
        _noiseBuf=audioCtx.createBuffer(1,audioCtx.sampleRate*0.5,audioCtx.sampleRate);
        const d=_noiseBuf.getChannelData(0);
        for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    }
    // 主旋律（16 拍 = 8 小节）：连绵流畅的长线条，每音 2-4 拍
    // 节奏型：长 → 长 → 长 → 长 → 长 → 长 → 长 → 长（避免短促跳跃）
    const melody=[
        [N.E4,0,2,.32], [N.D4,2,2,.28], [N.C4,4,2,.30], [N.E4,6,2,.28],
        [N.G4,8,2,.34], [N.E4,10,2,.28], [N.D4,12,2,.30], [N.C4,14,2,.32]
    ];
    // 三度平行和声：低于主旋律三度，柔和支撑
    const harm=[
        [N.C4,0,2,.16], [N.A3,2,2,.14], [N.A3,4,2,.15], [N.C4,6,2,.14],
        [N.E4,8,2,.17], [N.C4,10,2,.14], [N.A3,12,2,.15], [N.G3,14,2,.16]
    ];
    // 高音装饰：每 4 拍一个高音点缀，轻柔"叮咚"
    const decor=[
        [N.C5,1],[N.G5,5],[N.E5,9],[N.G5,13]
    ];
    // 贝斯：每和弦 4 拍长音（C-Am-Dm-G 卡农进行），持续感铺垫
    const bass=[
        [N.C2,0,4,.30], [N.A2,4,4,.30], [N.D3,8,4,.30], [N.G2,12,4,.30]
    ];
    // 底鼓：仅强拍（0/4/8/12）轻击，温和节奏感
    const kickBeats=[[0,.32],[4,.32],[8,.32],[12,.32]];
    // 闭镲：仅 8 分音符弱拍（每拍后半），轻柔沙沙感
    const hatBeats=[];
    for(let b=0;b<16;b++){hatBeats.push([b+.5,.06]);}
    function playNote(freq,start,dur,type,vol){
        const o=audioCtx.createOscillator(),e=audioCtx.createGain();
        o.type=type;o.frequency.value=freq;
        // 较长断奏：attack 5ms → 指数衰减（dur = 拍*0.6），让音连贯不跳跃
        e.gain.setValueAtTime(0,start);
        e.gain.linearRampToValueAtTime(vol,start+.005);
        e.gain.exponentialRampToValueAtTime(.0001,start+dur);
        o.connect(e);e.connect(musicGain);
        o.start(start);o.stop(start+dur+.05);
        musicOscs.push(o);
    }
    // 底鼓：低频正弦从 120Hz 滑下 —— 轻柔"咚"声
    function playKick(start,vol){
        const o=audioCtx.createOscillator(),e=audioCtx.createGain();
        o.type='sine';
        o.frequency.setValueAtTime(120,start);
        o.frequency.exponentialRampToValueAtTime(50,start+.1);
        e.gain.setValueAtTime(vol,start);
        e.gain.exponentialRampToValueAtTime(.0001,start+.18);
        o.connect(e);e.connect(musicGain);
        o.start(start);o.stop(start+.2);
        musicOscs.push(o);
    }
    // 闭镲：高通白噪声 + 短衰减 —— "沙"声
    function playHat(start,vol){
        const s=audioCtx.createBufferSource();s.buffer=_noiseBuf;
        const filt=audioCtx.createBiquadFilter();
        filt.type='highpass';filt.frequency.value=7000;
        const g=audioCtx.createGain();
        g.gain.setValueAtTime(vol,start);
        g.gain.exponentialRampToValueAtTime(.0001,start+.04);
        s.connect(filt);filt.connect(g);g.connect(musicGain);
        s.start(start);s.stop(start+.05);
        musicOscs.push(s);
    }
    // 调度函数：每轮 16 拍循环；用闭包变量 cycleStart 记录本轮起点
    function scheduleCycle(){
        if(!musicOn||!audioCtx)return;
        const t=cycleStart;  // 本轮起点时间
        try{
            melody.forEach(([f,b,d,v])=>{playNote(f,t+b*beat,beat*d*.6,'triangle',v)});
            harm.forEach(([f,b,d,v])=>{playNote(f,t+b*beat,beat*d*.6,'sine',v)});
            decor.forEach(([f,b])=>{playNote(f,t+b*beat,eighth*.5,'sine',.10)});
            bass.forEach(([f,b,d,v])=>{playNote(f,t+b*beat,beat*d*.85,'triangle',v)});
            kickBeats.forEach(([b,v])=>{playKick(t+b*beat,v)});
            hatBeats.forEach(([b,v])=>{playHat(t+b*beat,v)});
        }catch(e){console.warn('BGM 调度异常',e)}
        // 推进到下一轮，提前 300ms 排下一轮 setTimeout，确保连续循环
        cycleStart=t+16*beat;
        _bgmTimer=setTimeout(scheduleCycle,16*beat*1000-300);
    }
    let cycleStart=audioCtx.currentTime+.1;
    scheduleCycle();
}
function stopBGM(){if(_bgmTimer){clearTimeout(_bgmTimer);_bgmTimer=null}musicOscs.forEach(o=>{try{o.stop()}catch(e){}});musicOscs=[]}
let musicStarted=false;
// 修复 AudioContext autoplay 报错：
// - 必须在用户手势内创建/启动 AudioContext，否则浏览器会拦截
// - resume() 返回 Promise，需在 then 中启动 BGM，避免在 suspended 状态下 sch 报错
function autoStartMusic(){
    if(musicStarted)return;
    initAudio();
    if(!audioCtx)return;
    if(musicOn){
        // audioCtx.state 可能是 suspended（autoplay 拦截），需 resume 后再 startBGM
        const resumeP=audioCtx.resume();
        if(resumeP&&typeof resumeP.then==='function'){
            resumeP.then(()=>{
                if(musicOn&&audioCtx.state==='running'){
                    startBGM();
                    musicStarted=true;  // 真正启动后才标记
                }
            }).catch(e=>console.warn('AudioContext.resume 失败',e));
        }else{
            // 旧浏览器无 Promise resume，直接尝试 startBGM
            try{startBGM();musicStarted=true}catch(e){console.warn('startBGM 失败',e)}
        }
    }
}
document.addEventListener('touchstart',autoStartMusic,{once:true});
document.addEventListener('click',autoStartMusic,{once:true});
document.addEventListener('keydown',autoStartMusic,{once:true});
document.getElementById('music-btn').onclick=()=>{
    initAudio();
    musicOn=!musicOn;
    localStorage.setItem('duck_music',musicOn?'1':'0');
    document.querySelector('#music-btn i').className=musicOn?'fa-solid fa-volume-high':'fa-solid fa-volume-xmark';
    if(musicOn){
        if(audioCtx){
            const p=audioCtx.resume();
            if(p&&p.then)p.then(()=>{if(musicOn&&audioCtx.state==='running')startBGM()}).catch(()=>{});
            else try{startBGM()}catch(e){}
        }
    }else{stopBGM()}
};
document.querySelector('#music-btn i').className=musicOn?'fa-solid fa-volume-high':'fa-solid fa-volume-xmark';
// ===== 自然音效引擎（去电子音：全部用"快速起音+指数衰减"包络 + 低通滤波 + 噪声成分，不用平稳蜂鸣音） =====
function playSFX(t,sc){
    if(!audioCtx)initAudio();if(!audioCtx||!sfxOn)return;
    const n=audioCtx.currentTime;
    // 包络音调：f0→f1 滑音 + 快速起音指数衰减 + 可选低通（木质/水声质感）
    const tone=({f0,f1=0,dur=.2,type='sine',vol=.2,lp=0,at=.004,when=0})=>{
        const o=audioCtx.createOscillator(),e=audioCtx.createGain();
        o.type=type;o.frequency.setValueAtTime(f0,n+when);
        if(f1)o.frequency.exponentialRampToValueAtTime(f1,n+when+dur);
        e.gain.setValueAtTime(0,n+when);e.gain.linearRampToValueAtTime(vol,n+when+at);
        e.gain.exponentialRampToValueAtTime(.0001,n+when+dur);
        let src=o;
        if(lp){const f=audioCtx.createBiquadFilter();f.type='lowpass';f.frequency.value=lp;o.connect(f);src=f}
        src.connect(e);e.connect(audioCtx.destination);
        o.start(n+when);o.stop(n+when+dur+.05)};
    // 噪声脉冲：白噪声经滤波 + 包络（水花/闷击/风声质感），fq 可滑动
    const noise=({dur=.1,ftype='bandpass',fq=1500,fq1=0,Q=1,vol=.12,at=.003,when=0})=>{
        const len=Math.max(1,Math.floor(audioCtx.sampleRate*dur));
        const buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate);
        const d=buf.getChannelData(0);
        for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
        const src=audioCtx.createBufferSource();src.buffer=buf;
        const f=audioCtx.createBiquadFilter();f.type=ftype;f.Q.value=Q;
        f.frequency.setValueAtTime(fq,n+when);
        if(fq1)f.frequency.exponentialRampToValueAtTime(fq1,n+when+dur);
        const g=audioCtx.createGain();
        g.gain.setValueAtTime(0,n+when);g.gain.linearRampToValueAtTime(vol,n+when+at);
        g.gain.exponentialRampToValueAtTime(.0001,n+when+dur);
        src.connect(f);f.connect(g);g.connect(audioCtx.destination);
        src.start(n+when);src.stop(n+when+dur+.02)};
    switch(t){
        case'paddle':{ // 划水"啪嗒"：带通噪声短脉冲（背景音，最轻）
            const sf=sc||1;
            noise({dur:.07,fq:1300,Q:1,vol:.07*Math.min(sf,1.6)});
            break}
        case'grass': // 水草+1：清脆小水泡"啵"
            tone({f0:540,f1:940,dur:.09,vol:.18,lp:2800});
            noise({dur:.04,fq:3200,vol:.05});
            break;
        case'flower': // 花朵+2：马林巴双音"叮咚"
            tone({f0:660,f1:640,dur:.2,vol:.2,lp:3400});
            tone({f0:1320,f1:1320,dur:.07,vol:.06,lp:3400});
            tone({f0:880,f1:860,dur:.24,vol:.17,lp:3400,when:.07});
            break;
        case'collect': // 荷叶/通用收集：三连小水泡上行
            tone({f0:500,f1:640,dur:.07,vol:.16,lp:2800});
            tone({f0:640,f1:820,dur:.07,vol:.15,lp:2800,when:.06});
            tone({f0:820,f1:1040,dur:.09,vol:.14,lp:2800,when:.12});
            break;
        case'rock': // 撞石头：超沉重"咚"——极低频体感冲击 + 厚重低鸣 + 碎石脆响点缀（重击感拉满，警戒靠"重"不靠"刺"）
            tone({f0:75,f1:28,dur:.55,type:'triangle',vol:.7,lp:240});   // 主低频撞击：更深更长更响
            tone({f0:140,f1:50,dur:.5,type:'sine',vol:.4,lp:400,when:.02}); // 二次低音加厚，体感更重
            noise({dur:.4,ftype:'lowpass',fq:160,vol:.5});               // 厚重低频闷响
            noise({dur:.18,ftype:'lowpass',fq:380,vol:.28,when:.05});    // 中低频体感延续
            noise({dur:.04,fq:2400,Q:2,vol:.15});                        // 石面脆响点缀（更短更弱，不抢戏）
            break;
        case'hit': // 受伤通用：钝击"砰" + 低鸣
            tone({f0:200,f1:60,dur:.24,vol:.32,lp:600});
            noise({dur:.1,ftype:'lowpass',fq:450,vol:.2});
            break;
        case'die': // 死亡：悲伤下行滑音 + 缓缓沉入水底（延迟.15s起，先让最后一下受伤音落地）
            tone({f0:520,f1:130,dur:.7,type:'triangle',vol:.26,lp:2200,when:.15});
            tone({f0:340,f1:85,dur:.8,vol:.18,lp:1200,when:.3});
            noise({dur:.9,fq:800,fq1:150,Q:1,vol:.15,when:.45});
            break;
        case'suck': // 被漩涡吸入瞬间：上升卷水"呜——咻"（加强版：更响 + 尾部低鸣）
            noise({dur:.55,fq:400,fq1:1800,Q:1.6,vol:.3});
            tone({f0:200,f1:520,dur:.4,vol:.18,lp:1400});
            tone({f0:520,f1:160,dur:.35,vol:.18,lp:1400,when:.4});
            noise({dur:.4,ftype:'lowpass',fq:300,vol:.12,when:.3});
            break;
        case'pull': // 磁铁吸附：顺滑上滑"嗞溜"（柔和正弦滑音+泛音，不再像木鱼敲击）
            tone({f0:620,f1:1560,dur:.14,vol:.09,lp:3200});
            tone({f0:1240,f1:1900,dur:.09,vol:.04,lp:4000,when:.03});
            break;
        case'shieldbreak': // 护盾被击碎：真实玻璃破碎——尖锐噪声裂纹 + 多片短促碎片叮当 + 高频碎屑下落 + 低闷"砰"（避免滑音造成鸟叫感）
            // 初始尖锐"啪"裂纹（玻璃受力瞬间）：噪声为主，无滑音
            noise({dur:.05,fq:5200,Q:3,vol:.36});
            noise({dur:.03,fq:8500,Q:4,vol:.18});
            // 玻璃碎片叮当：极短噪声脉冲（不同时间、不同频率，模拟碎片四溅撞击）——不用滑音，避免鸟叫
            noise({dur:.05,fq:3800,Q:3,vol:.24,when:.03});
            noise({dur:.04,fq:5200,Q:3.5,vol:.2,when:.07});
            noise({dur:.06,fq:2800,Q:2.5,vol:.22,when:.11});
            noise({dur:.04,fq:6200,Q:4,vol:.18,when:.15});
            noise({dur:.05,fq:3400,Q:3,vol:.2,when:.19});
            noise({dur:.04,fq:4800,Q:3.5,vol:.16,when:.23});
            // 高频碎屑下落（持续噪声带，模拟细小玻璃粒洒落）
            noise({dur:.3,fq:5800,Q:1.2,vol:.18,when:.1});
            noise({dur:.2,fq:7500,Q:1.8,vol:.12,when:.2});
            // 低闷"砰"落地感（碎片落到桌面/地面，重物感）
            tone({f0:180,f1:60,dur:.25,type:'triangle',vol:.32,lp:500,when:.05});
            noise({dur:.2,ftype:'lowpass',fq:280,vol:.28,when:.08});
            break;
        case'shield': // 护盾：水晶"叮"长音
            tone({f0:1180,f1:1160,dur:.4,vol:.15,lp:4000});
            tone({f0:2360,f1:2360,dur:.18,vol:.05,lp:4000});
            break;
        case'multi': // 倍率触发：上行琶音 + 高频闪光
            [523,659,784,1047].forEach((f,i)=>tone({f0:f,f1:f,dur:.13,vol:.16,lp:3600,when:i*.055}));
            noise({dur:.3,fq:5200,Q:2,vol:.06,when:.2});
            break;
        case'whirl': // 漩涡吞没：大水轰鸣——更响更长更低沉（噪声下卷 + 深低鸣 + 闷雷底）
            noise({dur:1,fq:700,fq1:140,Q:1.4,vol:.34});
            tone({f0:240,f1:55,dur:.9,type:'triangle',vol:.24,lp:400});
            noise({dur:.5,ftype:'lowpass',fq:180,vol:.2,when:.2});
            break;
        case'event': // 事件触发：柔和提示"叮-咚"
            tone({f0:740,f1:720,dur:.16,vol:.15,lp:3200});
            tone({f0:988,f1:960,dur:.26,vol:.14,lp:3200,when:.11});
            break;
        case'firework': // 烟花绽放：闷响"嘭" + 高频噼啪散落
            noise({dur:.28,fq:420,fq1:120,Q:1.2,vol:.24});
            noise({dur:.5,fq:3600,fq1:1800,Q:.8,vol:.1,when:.08});
            tone({f0:1200,f1:300,dur:.3,type:'triangle',vol:.06,when:.05});
            break;
        case'heal': // 爱心回血：温暖上行"噜"
            tone({f0:440,f1:660,dur:.2,vol:.17,lp:2600});
            tone({f0:660,f1:880,dur:.24,vol:.14,lp:2600,when:.08});
            break;
        case'chew': // 国庆吃蛋糕：三口咀嚼"吧唧"——短促带通噪声咀嚼 + 末尾满足"嗯~"
            for(let ci=0;ci<3;ci++){
                noise({dur:.055,ftype:'bandpass',fq:420+ci*160,Q:2.2,vol:.2,when:ci*.1});
                tone({f0:150-ci*15,f1:70,dur:.06,type:'triangle',vol:.16,lp:500,when:ci*.1+.015});
            }
            tone({f0:520,f1:760,dur:.18,vol:.1,lp:2400,when:.34}); // 满足的尾音
            break;
        case'magnet': // 磁铁：磁吸"嗞-叮"
            noise({dur:.14,fq:2200,Q:3,vol:.1});
            tone({f0:760,f1:1180,dur:.16,vol:.13,lp:3400,when:.04});
            break;
    }
}
document.getElementById('help-btn').onclick=()=>document.getElementById('help').classList.toggle('show');
// 调试模式：开关面板 + 立即触发指定事件 + 在附近生成物品 + 修改生命分数
// 通过 <meta name="env" content="MODE=dev"> 决定是否显示调试按钮，避免外部 fetch
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
        const hh=document.getElementById('dbg-set-hearts');if(hh)hh.textContent=hearts;
        const is=document.getElementById('dbg-set-score');if(is)is.value=score;
        if(typeof updateDebugBlessingStatus==='function')updateDebugBlessingStatus();
    }
};
// 生命 +/− 按钮（本地显示值，应用修改时才写入 hearts）
function _dbgH(){const el=document.getElementById('dbg-set-hearts');return el?parseInt(el.textContent)||0:0}
function _dbgSetH(v){const el=document.getElementById('dbg-set-hearts');if(el)el.textContent=Math.max(0,Math.min(MAX_HEARTS,v))}
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
    if(dbgNextEvent){pendingEvent=dbgNextEvent;warnedFor=null}else{pendingEvent=null;warnedFor=null}
});
bindCsel('dbg-spawn-csel',null);
bindCsel('dbg-blessing-csel',null);
bindCsel('dbg-festival-csel',null);
function updateDebugBlessingStatus(){
    const el=document.getElementById('dbg-blessing-status');
    if(!el||typeof Blessings==='undefined')return;
    const daily=Blessings.current?.name||'未选择';
    const festival=Blessings.festival?`${Blessings.festival.name} · ${Blessings.festival.desc}`:'无节日加成';
    el.textContent=`今日：${daily}；节日：${festival}`;
}
document.getElementById('dbg-apply-blessings').onclick=()=>{
    const dailyId=document.getElementById('dbg-blessing-csel')?.dataset.value||'';
    const festivalKey=document.getElementById('dbg-festival-csel')?.dataset.value||'';
    Blessings.applyDebugSelection(dailyId,festivalKey);
    if(typeof updateSettingsPanel==='function')updateSettingsPanel();
    updateDebugBlessingStatus();
    const effects=Blessings.getEffects().map(effect=>effect.name).join(' + ');
    toast('<i class="fa-solid fa-wand-magic-sparkles"></i> 已生效：'+(effects||'无'),'s');
};
document.getElementById('dbg-trigger').onclick=()=>{
    const csel=document.getElementById('dbg-event-csel');
    const sel=csel?csel.dataset.value:'';
    // 立即触发：若有事件进行中，先结束
    if(activeEvent)endEvent();
    const key=sel||pickEvent();
    startEvent(key);
    globalEventTimer=30;
    toast('<i class="fa-solid fa-bug"></i> 已触发：'+EVENTS[key].n,'s');
};
// 在鸭子附近生成指定物品（包括漩涡）
function dbgSpawnItem(type,count=1){
    if(!duckModel){toast('<i class="fa-solid fa-bug"></i> 鸭子未加载','m');return}
    const dp=duckModel.position;
    for(let i=0;i<count;i++){
        const ang=Math.random()*Math.PI*2,dist=3+Math.random()*8;
        const x=dp.x+Math.cos(ang)*dist,z=dp.z+Math.sin(ang)*dist;
        if(type==='whirlpool'){
            const w=mkWhirlpool(x,z);
            scene.add(w.group,w.rim,w.field);if(w.lantern)scene.add(w.lantern);
            whirlZones.push(w.zone);
            whirlpools.push(w);
        }else{
            let mesh,radius;
            switch(type){
                case'rock':{const rs=.3+Math.random()*.5;const rm=1+Math.floor(Math.random()*5)*.5;mesh=isFestival('festival_national_day')?mkCake(new THREE.Vector3(x,-.1,z),rs):mkRock(new THREE.Vector3(x,-.1,z),rs);mesh.scale.multiplyScalar(rm);radius=rs*1.2*rm;break}
                case'flower':{const fm=1+Math.floor(Math.random()*3)*.5;mesh=mkFlower(x,z);mesh.scale.multiplyScalar(fm);radius=.4*fm;break}
                case'grass':{const gm=1+Math.floor(Math.random()*3)*.5;mesh=isFestival('festival_dragon_boat')?mkZongzi(x,z):mkGrass(x,z,5+Math.floor(Math.random()*4));mesh.scale.multiplyScalar(gm);radius=.4*gm;break}
                case'lily':{const ls=.3+Math.random()*.25;const lm=1+Math.floor(Math.random()*3)*.5;mesh=mkLily(x,z,ls);mesh.scale.multiplyScalar(lm);radius=ls*lm;break}
                case'magnet':{const mm=1+Math.floor(Math.random()*3)*.5;mesh=mkMagnet(x,z);mesh.scale.multiplyScalar(mm);radius=.35*mm;break}
                case'heart':{mesh=mkHeart(x,z);radius=.6;break}
                default:continue;
            }
            if(mesh){scene.add(mesh);items.push({mesh,type,r:radius,coll:false})}
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
    hearts=Math.max(0,Math.min(MAX_HEARTS,h));
    score=Math.max(0,s);
    updateHeartsUI();
    document.getElementById('score').textContent=formatScore(score);
    if(hearts<=0)gameOver();
    toast('<i class="fa-solid fa-bug"></i> 已修改：'+hearts+'心 / '+score+'分','s');
};

// ===== 渲染器（已迁移至 js/render/runtime.js） =====
const {canvas,renderer,scene,camera,controls,quality,cam,applyDRS,resize:resizeRuntime}=createRuntime();

// ===== 漩涡吸入后处理（已迁移到 js/render/postfx.js） =====
// sinkFx 强度仍由 main.js 维护，postfx 只负责渲染逻辑
const swirlPostfx=createSwirlPostfx({renderer,scene,camera,width:innerWidth,height:innerHeight});

// ===== Canvas 贴图工具 =====
function mkTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);return new THREE.CanvasTexture(c)}

// ===== 卡通水面 =====
// 统一波浪高度函数：水面网格、鸭子、道具全部共用（世界坐标采样），保证鸭子严丝合缝地浮在浪上
// 状态变量保留在 main.js（被多处读写），通过 waterState getter/setter 透传给 water.js
let waveBoost=1; // 海浪事件期间的振幅倍率（平滑过渡）
let waveClock=0,waveSpeed=1; // 波浪相位时间（独立于 gameClock，可变速：暴风雨加快、平静减慢）
// 渲染时钟：水面网格顶点每次更新时定格一次。鸭子/道具/涟漪/鲨鱼全部以它采样，
// 与"实际渲染出来的浪面"严格一致，根治网格隔帧更新导致的鸭子闪烁/被浪穿模。
let renderedWaveClock=0;
const whirlZones=[]; // 活跃漩涡对水体的凹陷 {x,z,r,depth}
// waterState：连接 main.js 顶层 let 变量与 water.js 内部读取的桥接对象
const waterState={get waveBoost(){return waveBoost},set waveBoost(v){waveBoost=v},get waveClock(){return waveClock},set waveClock(v){waveClock=v},get waveSpeed(){return waveSpeed},set waveSpeed(v){waveSpeed=v},get renderedWaveClock(){return renderedWaveClock},set renderedWaveClock(v){renderedWaveClock=v},whirlZones};
const{waveHeight,mkWaveRing,mkWaveDisk,setWaveDetail,updatePhase:waterUpdatePhase,followTarget:waterFollowTarget,updateVertices:waterUpdateVertices,waterMesh,waveMesh,waterMat,waterColDeep,waterColLight,waterColFoam}=createWater({scene,quality,getFrameCount:()=>frameCount,getWaveEventDir:()=>waveEventDir,state:waterState});
// envState：连接 main.js 顶层 let 变量与 environment.js 内部读写的桥接对象
// timeOfDay/evWindDir/envBright/stormFactor/lightningFlash/camShake/windActive/rainbowActive/stormActive/windSpeedMul
// 均为 main.js 顶层 let 变量（部分在后续代码才声明，getter 延迟访问避免 TDZ）
const envState={
    get timeOfDay(){return timeOfDay},set timeOfDay(v){timeOfDay=v},
    get evWindDir(){return evWindDir},
    get envBright(){return envBright},set envBright(v){envBright=v},
    get stormFactor(){return stormFactor},set stormFactor(v){stormFactor=v},
    get lightningFlash(){return lightningFlash},set lightningFlash(v){lightningFlash=v},
    get camShake(){return camShake},set camShake(v){camShake=v},
    get windActive(){return windActive},
    get rainbowActive(){return rainbowActive},
    get stormActive(){return stormActive},
    get windSpeedMul(){return windSpeedMul},
};
const {setCartoonSky,updateClouds,updateStormFx,updateSkyFx,updateSkyAmbience,cycleTime,setTime,resize:resizeEnvironment,sunLight:envSunLight}=createEnvironment({
    scene,camera,renderer,quality,
    waterMat,waterColDeep,waterColLight,waterColFoam,
    getDuckModel:()=>duckModel,
    getGameClock:()=>gameClock,
    duoRand,duoIsGuest,
    isFestival,
    getAudioCtx:()=>audioCtx,
    getMusicOn:()=>musicOn,
    state:envState,
});
window.cycleTime=cycleTime; // HTML onclick 引用
window.__setTime=setTime; // 调试：直接设置时间

let envBright=1; // 环境亮度（白天1/日落~0.6/夜晚0.22），用于漩涡等自发光贴图随昼夜变暗（由 environment.js setCartoonSky 写入）


// ===== 共享贴图：光点/辉光/浪花 =====
const sparkTex=mkTex(32,32,(x)=>{const g=x.createRadialGradient(16,16,0,16,16,16);
    g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.3,'rgba(160,220,255,.9)');g.addColorStop(1,'rgba(80,180,255,0)');
    x.fillStyle=g;x.fillRect(0,0,32,32);
    x.strokeStyle='rgba(220,245,255,.9)';x.lineWidth=1.6;x.beginPath();x.moveTo(16,0);x.lineTo(16,32);x.moveTo(0,16);x.lineTo(32,16);x.stroke()});
const glowTex=mkTex(128,128,(x)=>{const g=x.createRadialGradient(64,64,0,64,64,64);
    g.addColorStop(0,'rgba(255,255,255,.9)');g.addColorStop(.4,'rgba(180,230,255,.35)');g.addColorStop(1,'rgba(120,200,255,0)');
    x.fillStyle=g;x.fillRect(0,0,128,128)});
const wakeTex=mkTex(512,64,(x)=>{ // 横向排列的泡沫团（沿圆环重复）
    for(let i=0;i<22;i++){const bx=i*24+Math.random()*10,by=22+Math.random()*20,br=5+Math.random()*9;
        const g=x.createRadialGradient(bx,by,0,bx,by,br);
        g.addColorStop(0,'rgba(235,250,255,.95)');g.addColorStop(1,'rgba(235,250,255,0)');
        x.fillStyle=g;x.beginPath();x.arc(bx,by,br,0,Math.PI*2);x.fill()}});
wakeTex.wrapS=THREE.RepeatWrapping;

// ===== 暴风雨状态变量（特效本体已迁移至 environment.js） =====
let stormFactor=0,lightningFlash=0,camShake=0;
// 确定性 PRNG：基于种子的伪随机数，双人模式两端使用相同种子得到相同结果
function duoRand(seed){const x=Math.sin(seed*12.9898+78.233)*43758.5453;return x-Math.floor(x)}
window.duoRand=duoRand; // 调试暴露（生产无副作用）

// 随机海浪事件系统
const arrowCanvas=document.createElement('canvas');
arrowCanvas.width=1024;arrowCanvas.height=1024;
const arrowCtx=arrowCanvas.getContext('2d');
function drawArrowTexture(angle){
    arrowCtx.clearRect(0,0,1024,1024);
    arrowCtx.save();
    arrowCtx.translate(512,512);
    arrowCtx.rotate(angle);
    arrowCtx.strokeStyle='rgba(100,220,255,.5)';
    arrowCtx.lineWidth=3;
    for(let i=0;i<12;i++){
        const y=-400+i*70;
        for(let j=-4;j<4;j++){
            const x=j*100;
            arrowCtx.beginPath();
            arrowCtx.moveTo(x-30,y);
            arrowCtx.lineTo(x+30,y);
            arrowCtx.stroke();
            arrowCtx.beginPath();
            arrowCtx.moveTo(x+30,y);
            arrowCtx.lineTo(x+18,y-10);
            arrowCtx.moveTo(x+30,y);
            arrowCtx.lineTo(x+18,y+10);
            arrowCtx.stroke();
        }
    }
    arrowCtx.restore();
}
drawArrowTexture(0);
const arrowTex=new THREE.CanvasTexture(arrowCanvas);
arrowTex.wrapS=arrowTex.wrapT=THREE.RepeatWrapping;
arrowTex.repeat.set(3,3);
const arrowPlane=new THREE.Mesh(
    new THREE.PlaneGeometry(200,200,40,40),
    new THREE.MeshBasicMaterial({map:arrowTex,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,fog:false})
);
arrowPlane.rotation.x=-Math.PI/2;
arrowPlane.position.y=0.03;
scene.add(arrowPlane);
let waveEventTimer=10+Math.random()*15,waveEventActive=false,waveEventDir={x:0,z:0},waveEventStrength=0,waveEventDuration=0;

// ===== 昼夜状态变量（实现已迁移至 environment.js） =====
let timeOfDay=12;const TIME_SPEED=0.5;
// 刮风事件风向（事件开始时随机选取；由 environment.js 通过 envState 读取）
let evWindDir={x:1,z:0};

// ===== 物品 =====
const items=[];const MAP=14;let eventRockBoost=0,eventWaveTarget=1,waveSpeedTarget=1;
// playStartTime 提前声明（用于难度递进计算），后续在 gameActive 段重新赋值
let playStartTime=Date.now();
function mkRock(p,s){const g=new THREE.DodecahedronGeometry(1,1);const a=g.attributes.position;for(let i=0;i<a.count;i++){let x=a.getX(i),y=a.getY(i),z=a.getZ(i);const n=Math.sin(x*3.7)*Math.cos(y*2.3)*Math.sin(z*4.1)*.15;x+=n;y+=n*.5;z+=n;y*=.55;a.setXYZ(i,x,y,z)}g.computeVertexNormals();const tint=.92+Math.random()*.16;const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:new THREE.Color(0x8d8177).multiplyScalar(tint),roughness:.85,flatShading:true}));m.position.copy(p);m.scale.setScalar(s);m.rotation.set(Math.random(),Math.random(),0);m.castShadow=true;m.receiveShadow=true;return m}
function mkGrass(x,z,n){const g=new THREE.Group();const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,side:THREE.DoubleSide});const cRoot=new THREE.Color(0x1d5c22),cTip=new THREE.Color(0x8fdd55),cc=new THREE.Color();for(let i=0;i<n;i++){const h=.4+Math.random()*.35,w=.05+Math.random()*.035;const geo=new THREE.PlaneGeometry(w,h,1,6);const a=geo.attributes.position;const cols=new Float32Array(a.count*3);const bend=(Math.random()-.5)*.4;for(let j=0;j<a.count;j++){let px=a.getX(j),py=a.getY(j);const t=py/h+.5;px*=1-t*.85;px+=t*t*bend;a.setX(j,px);cc.copy(cRoot).lerp(cTip,t);cols[j*3]=cc.r;cols[j*3+1]=cc.g;cols[j*3+2]=cc.b}geo.setAttribute('color',new THREE.BufferAttribute(cols,3));geo.computeVertexNormals();const b=new THREE.Mesh(geo,mat);b.position.set((Math.random()-.5)*.6,h*.5,(Math.random()-.5)*.6);b.rotation.y=Math.random()*Math.PI;b.castShadow=true;g.add(b)}g.position.set(x,0,z);return g}
function mkLily(x,z,s){const g=new THREE.Group();const pg=new THREE.CircleGeometry(s,24,0,Math.PI*1.85);const pa=pg.attributes.position;const pcols=new Float32Array(pa.count*3);const cIn=new THREE.Color(0x46a857),cOut=new THREE.Color(0x1e6b31),cc=new THREE.Color();for(let i=0;i<pa.count;i++){const px=pa.getX(i),py=pa.getY(i);const r=Math.min(Math.sqrt(px*px+py*py)/s,1);pa.setZ(i,r*r*.14*s);cc.copy(cIn).lerp(cOut,r);pcols[i*3]=cc.r;pcols[i*3+1]=cc.g;pcols[i*3+2]=cc.b}pg.setAttribute('color',new THREE.BufferAttribute(pcols,3));pg.computeVertexNormals();const pad=new THREE.Mesh(pg,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,side:THREE.DoubleSide}));pad.rotation.x=-Math.PI/2;pad.receiveShadow=true;g.add(pad);
// 卡通莲花：一圈微翘的粉色花瓣 + 黄色花心
const petalMat=new THREE.MeshStandardMaterial({color:0xff9ec7,roughness:.45,emissive:0x40001a,emissiveIntensity:.25});for(let i=0;i<6;i++){const a=i/6*Math.PI*2;const p=new THREE.Mesh(new THREE.SphereGeometry(s*.22,10,8),petalMat);p.scale.set(1,.42,1.6);p.position.set(Math.cos(a)*s*.2,s*.13,Math.sin(a)*s*.2);p.rotation.y=Math.PI/2-a;p.rotateX(-.35);g.add(p)}const heart=new THREE.Mesh(new THREE.SphereGeometry(s*.13,10,8),new THREE.MeshStandardMaterial({color:0xffd94d,roughness:.4,emissive:0x553300,emissiveIntensity:.4}));heart.position.y=s*.16;heart.scale.y=.75;g.add(heart);g.position.set(x,.01,z);return g}
function mkFlower(x,z){const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.CylinderGeometry(.015,.02,.5,8),new THREE.MeshStandardMaterial({color:0x2a6a2a})).translateY(.25));
// 花茎叶子
const leafMat=new THREE.MeshStandardMaterial({color:0x3f8f3f,roughness:.6});for(const s of[-1,1]){const leaf=new THREE.Mesh(new THREE.SphereGeometry(.07,8,6),leafMat);leaf.scale.set(1.7,.25,.7);leaf.position.set(s*.09,.16,0);leaf.rotation.z=s*.5;g.add(leaf)}
// 外层花瓣（暖黄、尖端微翘）
const pm=new THREE.MeshStandardMaterial({color:0xffd93c,roughness:.45,emissive:0x442200,emissiveIntensity:.25});for(let i=0;i<8;i++){const a=(i/8)*Math.PI*2;const p=new THREE.Mesh(new THREE.SphereGeometry(.07,10,8),pm);p.scale.set(1,.4,1.7);p.position.set(Math.cos(a)*.1,.5,Math.sin(a)*.1);p.rotation.y=Math.PI/2-a;p.rotateX(-.3);g.add(p)}
// 花心
const core=new THREE.Mesh(new THREE.SphereGeometry(.055,12,10),new THREE.MeshStandardMaterial({color:0xff8c1a,roughness:.4,emissive:0x552200,emissiveIntensity:.35}));core.position.y=.52;core.scale.y=.7;g.add(core);g.position.set(x,-.02,z);return g}
// 卡通横向 U 形马蹄铁磁铁（一体化：TubeGeometry 沿 U 形曲线生成单根管子，groups 多材质分段着色）
function mkMagnet(x,z){
    const poleLen=.5,poleR=.13,gap=.22;
    // 横放 U 形马蹄铁路径（XZ 平面，y=0；开口朝 -X 方向，两极水平指向左）：
    // 红极尖（左）→ 弯角过渡 → 红极根（右）→ 银色半圆弧（向 +X 凸出）→ 蓝极根 → 弯角过渡 → 蓝极尖
    const pts=[
        new THREE.Vector3(-poleLen,0,-gap),
        new THREE.Vector3(-poleLen*.55,0,-gap),      // 过渡点（让直杆平滑接入弧）
        new THREE.Vector3(-poleLen*.15,0,-gap*0.96), // 微微内收，让弯角更圆润
        new THREE.Vector3(0,0,-gap),
    ];
    // 银弧：x = gap*sin(a) 从 0 经 +gap 到 0；z = -gap*cos(a) 从 -gap 经 0 到 +gap
    for(let i=1;i<24;i++){
        const a=Math.PI*(i/24);
        pts.push(new THREE.Vector3(gap*Math.sin(a),0,-gap*Math.cos(a)));
    }
    pts.push(new THREE.Vector3(0,0,gap));
    pts.push(new THREE.Vector3(-poleLen*.15,0,gap*0.96)); // 弯角过渡
    pts.push(new THREE.Vector3(-poleLen*.55,0,gap));
    pts.push(new THREE.Vector3(-poleLen,0,gap));
    const curve=new THREE.CatmullRomCurve3(pts,false,'catmullrom',.5);
    const tubularSeg=120,radialSeg=24;   // 更高段数 + 圆周细分 → 更圆润
    const tubeGeo=new THREE.TubeGeometry(curve,tubularSeg,poleR,radialSeg,false);
    // 按 tubularSeg 比例划分 groups：红极 0-25%，银弧 25-75%，蓝极 75-100%
    const totalIdx=tubeGeo.index?tubeGeo.index.count:tubeGeo.attributes.position.count;
    const perSeg=totalIdx/(tubularSeg+1);
    const redEnd=Math.floor(perSeg*(tubularSeg*.25));
    const silverEnd=Math.floor(perSeg*(tubularSeg*.75));
    tubeGeo.addGroup(0,redEnd,0);
    tubeGeo.addGroup(redEnd,silverEnd-redEnd,1);
    tubeGeo.addGroup(silverEnd,totalIdx-silverEnd,2);
    const redMat=new THREE.MeshStandardMaterial({color:0xff4466,roughness:.35,emissive:0xff2244,emissiveIntensity:.45,metalness:.1});
    const blueMat=new THREE.MeshStandardMaterial({color:0x4488ff,roughness:.35,emissive:0x2266ff,emissiveIntensity:.45,metalness:.1});
    const silverMat=new THREE.MeshStandardMaterial({color:0xe8edf5,roughness:.2,metalness:.95,emissive:0x222a36,emissiveIntensity:.15});
    const magnetMesh=new THREE.Mesh(tubeGeo,[redMat,silverMat,blueMat]);
    magnetMesh.castShadow=true;
    // 两极顶端的银色圆头（圆润封顶，标识 N/S 极）
    const capGeo=new THREE.SphereGeometry(poleR*1.02,16,12);
    const redCap=new THREE.Mesh(capGeo,silverMat);
    redCap.position.set(-poleLen,0,-gap);redCap.castShadow=true;
    const blueCap=new THREE.Mesh(capGeo,silverMat);
    blueCap.position.set(-poleLen,0,gap);blueCap.castShadow=true;
    // N/S 字母标识（白色小圆环，贴在极帽 -X 外侧，圆环面朝 -X）
    const labelMat=new THREE.MeshBasicMaterial({color:0xffffff});
    const nLabel=new THREE.Mesh(new THREE.TorusGeometry(.05,.015,8,16),labelMat);
    nLabel.position.set(-poleLen-poleR*1.05,0,-gap);
    nLabel.rotation.y=Math.PI/2;
    const sLabel=new THREE.Mesh(new THREE.TorusGeometry(.05,.015,8,16),labelMat);
    sLabel.position.set(-poleLen-poleR*1.05,0,gap);
    sLabel.rotation.y=Math.PI/2;
    const g=new THREE.Group();
    g.add(magnetMesh,redCap,blueCap,nLabel,sLabel);
    g.position.set(x,0,z);return g}

// 动态刷新
// SPAWN_R 由 32 扩大到 64，覆盖区域为原来的 4 倍（π·r²）
// 同时大幅提高目标数量，让刷新更密集（鸭子周围一圈始终有充足道具）
const SPAWN_R=64,DESPAWN_R=100,MAX_I=1200;
const MAGNET_RANGE=16,MAGNET_DURATION=12;// 磁铁吸引范围16单位（减半），持续12秒
let magnetTimer=0,magnetActive=false;
function spawnAround(cx,cz){
    const cnt={rock:0,flower:0,grass:0,lily:0,magnet:0};items.forEach(i=>{if(!i.coll)cnt[i.type]++});
    // 目标数量按面积比例扩大（4 倍），并额外提升密度
    // 难度递进：石头目标数量随时间提升（30 → 50，满级）
    const _diff=difficultyFactor();
    const tgt={rock:30+Math.round(20*_diff)+eventRockBoost,flower:90,grass:80,lily:42,magnet:2};  // 4x 区域 + 密集
    for(const[type,target]of Object.entries(tgt)){while(cnt[type]<target&&items.length<MAX_I){
    // 磁铁刷新概率 50%（稀有道具）
    if(type==='magnet'&&Math.random()>.5)break;
    // 用 sqrt 分布让物品在圆盘上均匀分布（不偏向外圈），鸭子周围一圈也有
    const ang=Math.random()*Math.PI*2,dist=3+Math.sqrt(Math.random())*(SPAWN_R-3);const x=cx+Math.cos(ang)*dist,z=cz+Math.sin(ang)*dist;let mesh,radius;
    switch(type){case'rock':{const rs=.3+Math.random()*.5;const rm=1+Math.floor(Math.random()*5)*.5;mesh=isFestival('festival_national_day')?mkCake(new THREE.Vector3(x,-.1,z),rs):mkRock(new THREE.Vector3(x,-.1,z),rs);mesh.scale.multiplyScalar(rm);radius=rs*1.2*rm;break}case'flower':{const fm=1+Math.floor(Math.random()*3)*.5;mesh=mkFlower(x,z);mesh.scale.multiplyScalar(fm);radius=.4*fm;break}case'grass':{const gm=1+Math.floor(Math.random()*3)*.5;mesh=isFestival('festival_dragon_boat')?mkZongzi(x,z):mkGrass(x,z,5+Math.floor(Math.random()*4));mesh.scale.multiplyScalar(gm);radius=.4*gm;break}case'lily':{const ls=.3+Math.random()*.25;const lm=1+Math.floor(Math.random()*3)*.5;mesh=mkLily(x,z,ls);mesh.scale.multiplyScalar(lm);radius=ls*lm;break}case'magnet':{const mm=1+Math.floor(Math.random()*3)*.5;mesh=mkMagnet(x,z);mesh.scale.multiplyScalar(mm);radius=.35*mm;break}}
    if(mesh){scene.add(mesh);items.push({mesh,type,r:radius,coll:false});cnt[type]++}}}
    for(let i=items.length-1;i>=0;i--){const it=items[i];const dx=it.mesh.position.x-cx,dz=it.mesh.position.z-cz;if(Math.sqrt(dx*dx+dz*dz)>DESPAWN_R||it.coll){scene.remove(it.mesh);items.splice(i,1)}}
}
spawnAround(0,0);

// ===== 双人模式场景同步（房主权威） =====
let duoItemsHash=0;
const duoLocalCollected=new Map();
function duoMarkCollected(x,z){duoLocalCollected.set(Math.round(x*2)+','+Math.round(z*2),performance.now()+5000)}
function duoIsCollected(x,z){const k=Math.round(x*2)+','+Math.round(z*2);const e=duoLocalCollected.get(k);if(e===undefined)return false;if(performance.now()>e){duoLocalCollected.delete(k);return false}return true}
function duoIsGuest(){return typeof Duo!=='undefined'&&Duo.active&&Duo.role==='guest'}
function duoSerializeScene(){
    const its=[];
    for(const it of items){
        if(it.coll)continue;
        // 道具雨掉落中：附带 y 坐标，让客机端也能看到掉落动画
        if(it.falling!==undefined&&it.falling>0&&it.mesh.position.y>1){
            its.push([it.type,it.mesh.position.x,it.mesh.position.z,it.mesh.scale.y,Math.round(it.mesh.position.y*100)/100])
        }else{
            its.push([it.type,it.mesh.position.x,it.mesh.position.z,it.mesh.scale.y])
        }
    }
    // 漩涡：房主权威同步（位置 + 缩放）
    const ws=[];
    for(const w of whirlpools){ws.push([w.x,w.z,w.scale])}
    let h=its.length;
    for(let i=0;i<its.length;i++)h=(h*31+Math.round(its[i][1]*10)+Math.round(its[i][2]*10))|0;
    for(let i=0;i<ws.length;i++)h=(h*31+Math.round(ws[i][0]*10)+Math.round(ws[i][1]*10))|0;
    // 鲨鱼位置同步（房主权威）：[x, z, rotationY] 或 null
    let sharkData=null;
    if(shark){const p=shark.g.position;sharkData=[Math.round(p.x*100)/100,Math.round(p.z*100)/100,shark.g.rotation.y]}
    // 事件状态同步：wind/storm/rainbow 布尔值 + 风向 evWindDir（随机量必须房主权威同步）
    return{clk:gameClock,evT:globalEventTimer,evN:activeEvent,evTm:activeEventTime,wS:waveSpeed,wST:waveSpeedTarget,eWT:eventWaveTarget,ih:h,items:its,whirls:ws,
        waveDir:[waveEventDir.x,waveEventDir.z],waveStr:waveEventStrength,waveActive:waveEventActive?1:0,waveDur:waveEventDuration,
        shark:sharkData,
        windAct:windActive?1:0,windMul:windSpeedMul,evWindDir:[evWindDir.x,evWindDir.z],
        stormAct:stormActive?1:0,rbAct:rainbowActive?1:0};
}
function duoApplyScene(sc){
    if(!sc)return;
    window.__duoApplyCalls=window.__duoApplyCalls||[];
    window.__duoApplyCalls.push({t:Date.now(),whirls:sc.whirls?JSON.parse(JSON.stringify(sc.whirls)):null,itemsCount:sc.items?sc.items.length:0,ih:sc.ih});
    if(window.__duoApplyCalls.length>20)window.__duoApplyCalls.shift();
    // 时钟平滑同步：客机时钟每帧自增，这里只校准漂移，不硬跳（硬跳会让所有 gameClock 驱动的动画瞬间抽帧=画面抖动）
    if(typeof sc.clk==='number'){
        const diff=sc.clk-gameClock;
        if(Math.abs(diff)>1.2)gameClock=sc.clk;              // 漂移过大（开局/严重丢包）才硬同步
        else if(Math.abs(diff)>.02)gameClock+=diff*.2;       // 小幅漂移每次收敛 20%，视觉上无感
    }
    waveSpeed=sc.wS;waveSpeedTarget=sc.wST;eventWaveTarget=sc.eWT;
    globalEventTimer=sc.evT;activeEventTime=sc.evTm;
    if(activeEvent!==sc.evN){activeEvent=sc.evN;if(activeEvent){startEvent(activeEvent);activeEventTime=sc.evTm}else endEvent()}
    // 水流方向箭头事件同步（房主权威）：方向 / 强度 / 是否激活 / 剩余时长
    if(Array.isArray(sc.waveDir)){
        const newDir={x:sc.waveDir[0],z:sc.waveDir[1]};
        const dirChanged=Math.abs(newDir.x-waveEventDir.x)>.01||Math.abs(newDir.z-waveEventDir.z)>.01;
        waveEventDir=newDir;waveEventStrength=sc.waveStr||0;waveEventActive=!!sc.waveActive;waveEventDuration=sc.waveDur||0;
        // 方向变化时重绘箭头贴图（与房主一致）
        if(dirChanged&&waveEventActive){const ang=Math.atan2(newDir.z,newDir.x);drawArrowTexture(ang);arrowTex.needsUpdate=true}
        if(!waveEventActive){arrowPlane.material.opacity=0}
    }
    // 鲨鱼同步（房主权威）：客机端按房主数据创建/更新/销毁本地鲨鱼
    if(sc.shark){
        const[sx,sz,sry]=sc.shark;
        if(!shark){spawnShark();if(shark){shark.g.position.set(sx,0,sz);shark.g.rotation.y=sry}}
        else{shark.g.position.x=sx;shark.g.position.z=sz;shark.g.rotation.y=sry}
    }else{removeShark()}
    // 事件状态同步（房主权威）：wind/storm/rainbow 布尔值 + 风向 evWindDir
    // 必须在 startEvent/endEvent 之后执行，覆盖本地随机生成的 evWindDir，确保两端粒子方向一致
    if(sc.windAct!==undefined){
        windActive=!!sc.windAct;
        windSpeedMul=Number.isFinite(sc.windMul)?sc.windMul:1;
        if(Array.isArray(sc.evWindDir)&&sc.evWindDir.length>=2){
            evWindDir={x:sc.evWindDir[0],z:sc.evWindDir[1]};
        }
    }
    if(sc.stormAct!==undefined)stormActive=!!sc.stormAct;
    if(sc.rbAct!==undefined){
        const newRb=!!sc.rbAct;
        if(newRb!==rainbowActive){
            rainbowActive=newRb;
            if(rainbowActive)document.getElementById('rainbow-overlay').classList.add('show');
            else document.getElementById('rainbow-overlay').classList.remove('show');
        }
    }
    if(sc.ih===duoItemsHash)return;
    duoItemsHash=sc.ih;
    // 道具增量调和：按"类型+坐标指纹"匹配房主快照，只增删差异项并复用存活网格。
    // 旧实现每次 hash 变化全量重建（最高 ~1200 个 mesh），客机端几何分配/GC 风暴 → 帧率暴跌，
    // 且所有漂浮动画相位重置 → 满屏道具集体跳变（画面抖动的另一主因）。
    const r5=v=>Math.round(v*20)/20; // 0.05 精度网格对齐，容忍房主端浮点微差
    const keyOf=(type,x,z)=>type+'|'+r5(x)+'|'+r5(z);
    const want=new Map();
    if(Array.isArray(sc.items)){
        for(const it of sc.items){
            const[type,x,z,scale,fy]=it;
            if(duoIsCollected(x,z))continue;
            want.set(keyOf(type,x,z),{type,x,z,scale,fy});
        }
    }
    const baseR={rock:.6,flower:.4,grass:.4,lily:.4,magnet:.35,heart:.6};
    for(let i=items.length-1;i>=0;i--){
        const it=items[i];
        const k=keyOf(it.type,it.duoHX??it.mesh.position.x,it.duoHZ??it.mesh.position.z);
        const snap=want.get(k);
        if(!snap){ // 快照里没有了（被吃/消失/漂远）→ 移除
            scene.remove(it.mesh);items.splice(i,1);continue;
        }
        want.delete(k); // 匹配成功：复用现有 mesh（动画相位/状态保留，无任何跳变）
        it.duoHX=snap.x;it.duoHZ=snap.z;
        if(!it.coll){
            if(Math.abs(it.mesh.scale.y-snap.scale)>.02)it.mesh.scale.setScalar(snap.scale);
            const mdx=snap.x-it.mesh.position.x,mdz=snap.z-it.mesh.position.z;
            if(mdx*mdx+mdz*mdz>1)it.mesh.position.set(snap.x,it.mesh.position.y,snap.z); // 位移>1 才纠正（磁铁吸附微移不打断）
        }
    }
    // 快照里有而本地没有 → 新建（仅增量，通常每次 0~2 个）
    for(const it of want.values()){
        const{type,x,z,scale,fy}=it;
        let mesh;
        switch(type){case'rock':{const rs=.5;mesh=isFestival('festival_national_day')?mkCake(new THREE.Vector3(x,-.1,z),rs):mkRock(new THREE.Vector3(x,-.1,z),rs);break}case'flower':{mesh=mkFlower(x,z);break}case'grass':{mesh=isFestival('festival_dragon_boat')?mkZongzi(x,z):mkGrass(x,z,7);break}case'lily':{mesh=mkLily(x,z,.4);break}case'magnet':{mesh=mkMagnet(x,z);break}case'heart':{mesh=mkHeart(x,z);break}}
        if(mesh){
            mesh.scale.setScalar(scale);
            const isFalling=typeof fy==='number'&&fy>1;
            if(isFalling)mesh.position.y=fy;
            scene.add(mesh);
            const itemObj={mesh,type,r:(baseR[type]||.4)*scale,coll:false,duoHX:x,duoHZ:z};
            if(isFalling){itemObj.falling=10;itemObj.fallVy=0}
            items.push(itemObj);
        }
    }
    // 漩涡增量调和：按坐标指纹匹配，只增删差异，存活漩涡不动（避免吸力环/贴图相位重置闪跳）
    const wkey=(x,z)=>Math.round(x*10)/10+'|'+Math.round(z*10)/10;
    const wantW=new Map();
    if(Array.isArray(sc.whirls))for(const w of sc.whirls)wantW.set(wkey(w[0],w[1]),{x:w[0],z:w[1],wm:w[2]});
    for(let i=whirlpools.length-1;i>=0;i--){
        const w=whirlpools[i];
        const snap=wantW.get(wkey(w.x,w.z));
        if(!snap){
            scene.remove(w.group);if(w.rim)scene.remove(w.rim);if(w.field)scene.remove(w.field);if(w.lantern)scene.remove(w.lantern);
            const zi=whirlZones.indexOf(w.zone);if(zi>=0)whirlZones.splice(zi,1);
            whirlpools.splice(i,1);continue;
        }
        wantW.delete(wkey(w.x,w.z));
        if(Math.abs((w.scale||1)-snap.wm)>.02){w.scale=snap.wm;w.group.scale.setScalar(snap.wm)}
    }
    for(const w of wantW.values())whirlpools.push(mkWhirlpool(w.x,w.z,w.wm));
}

// 护盾
const shieldMesh=new THREE.Mesh(new THREE.SphereGeometry(1.8,32,24),new THREE.MeshPhysicalMaterial({color:0x44ddff,transparent:true,opacity:0,roughness:0,metalness:.3,clearcoat:1,side:THREE.DoubleSide,depthWrite:false}));shieldMesh.renderOrder=20;shieldMesh.visible=false;scene.add(shieldMesh);
// 卡通王冠（程序化建模：圆润金环+胶囊尖柱+彩宝石；加载后挂为鸭子子节点，自动跟随头部位置与倾斜）
const crownGroup=new THREE.Group();
crownGroup.visible=false;
{
const crownInner=new THREE.Group();
const goldMat=new THREE.MeshStandardMaterial({color:0xffc93c,roughness:.28,metalness:.08,emissive:0x7a4d00,emissiveIntensity:.35,side:THREE.DoubleSide});
// 圆润底环：光滑圆环 + 上下两条圆边
const band=new THREE.Mesh(new THREE.CylinderGeometry(.40,.46,.26,32,1,true),goldMat);crownInner.add(band);
const rimB=new THREE.Mesh(new THREE.TorusGeometry(.46,.06,12,32),goldMat);rimB.rotation.x=Math.PI/2;rimB.position.y=-.13;crownInner.add(rimB);
const rimT=new THREE.Mesh(new THREE.TorusGeometry(.42,.05,12,32),goldMat);rimT.rotation.x=Math.PI/2;rimT.position.y=.13;crownInner.add(rimT);
// 圆润尖柱：胶囊体半埋进圆环（无接缝过渡），微微外张，顶端带小球
for(let i=0;i<5;i++){const a=i/5*Math.PI*2;const spike=new THREE.Mesh(new THREE.CapsuleGeometry(.115,.22,6,16),goldMat);spike.position.set(Math.cos(a)*.40,.16,Math.sin(a)*.40);spike.quaternion.setFromAxisAngle(new THREE.Vector3(-Math.sin(a),0,Math.cos(a)),-.16);const tip=new THREE.Mesh(new THREE.SphereGeometry(.085,12,10),goldMat);tip.position.y=.26;spike.add(tip);crownInner.add(spike)}
// 彩宝石（圆球，半嵌在圆环上）
const gemCols=[0xff4d6d,0x4dc9ff,0x6dff8a,0xff8c4d,0xc94dff];
for(let i=0;i<5;i++){const a=(i+.5)/5*Math.PI*2;const gem=new THREE.Mesh(new THREE.SphereGeometry(.075,12,10),new THREE.MeshStandardMaterial({color:gemCols[i],roughness:.15,metalness:0,emissive:gemCols[i],emissiveIntensity:.5}));gem.position.set(Math.cos(a)*.45,0,Math.sin(a)*.45);crownInner.add(gem)}
crownInner.scale.setScalar(1.04); // 抵消父级(鸭子)的0.72缩放，世界尺寸≈0.75
crownGroup.add(crownInner);
}
// 连胜特效光环（柔和发光球）
const auraMat=new THREE.MeshBasicMaterial({color:0xffd700,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false});
const auraMesh=new THREE.Mesh(new THREE.SphereGeometry(2.5,24,16),auraMat);auraMesh.visible=false;auraMesh.renderOrder=30;scene.add(auraMesh);
// 磁吸激活时的范围圈（贴浪面的能量虚线环，不再被海浪盖住一半）
const magnetDashTex=mkTex(256,32,(x)=>{
    x.clearRect(0,0,256,32);x.lineCap='round';
    for(let i=0;i<8;i++){const x0=i*32+6;
        const g=x.createLinearGradient(x0,0,x0+20,0);
        g.addColorStop(0,'rgba(140,215,255,.15)');g.addColorStop(.5,'rgba(220,245,255,1)');g.addColorStop(1,'rgba(140,215,255,.15)');
        x.strokeStyle=g;x.lineWidth=6;
        x.beginPath();x.moveTo(x0,16);x.lineTo(x0+20,16);x.stroke()}
});
magnetDashTex.wrapS=THREE.RepeatWrapping;
const magnetRangeRing=mkWaveRing(2,96,new THREE.MeshBasicMaterial({map:magnetDashTex,transparent:true,opacity:0,color:0x86d4ff,depthWrite:false,fog:false,side:THREE.DoubleSide}),6);
magnetRangeRing.visible=false;scene.add(magnetRangeRing);
// 内收脉冲环（两圈交替从外向内收缩，表现"吸入"）
const magnetPulse=[];
for(let i=0;i<2;i++){
    const t=mkTex(64,8,(x)=>{const g=x.createLinearGradient(0,0,64,0);g.addColorStop(0,'rgba(150,220,255,0)');g.addColorStop(.5,'rgba(200,240,255,.9)');g.addColorStop(1,'rgba(150,220,255,0)');x.fillStyle=g;x.fillRect(0,0,64,8)});
    t.wrapS=THREE.RepeatWrapping;
    const r=mkWaveRing(1,72,new THREE.MeshBasicMaterial({map:t,transparent:true,opacity:0,color:0x9fe0ff,depthWrite:false,fog:false,side:THREE.DoubleSide}),8);
    r.visible=false;scene.add(r);magnetPulse.push(r);
}
// 磁场粒子（星芒贴图 + 顶点渐变色，螺旋向鸭子汇聚）
const MAG_PARTICLES=140;
const magParticleGeo=new THREE.BufferGeometry();
const magParticlePos=new Float32Array(MAG_PARTICLES*3);
const magParticleCol=new Float32Array(MAG_PARTICLES*3);
const magParticleData=[]; // 每个粒子的 {angle,radius,yOff,speed}
for(let i=0;i<MAG_PARTICLES;i++){
    const angle=Math.random()*Math.PI*2;
    const radius=2+Math.random()*(MAGNET_RANGE-2);
    magParticleData.push({angle,radius,yOff:(Math.random()-.5)*1.2,speed:.6+Math.random()*.9});
}
magParticleGeo.setAttribute('position',new THREE.BufferAttribute(magParticlePos,3));
magParticleGeo.setAttribute('color',new THREE.BufferAttribute(magParticleCol,3));
const magParticleMat=new THREE.PointsMaterial({
    size:.32,transparent:true,opacity:0,vertexColors:true,
    blending:THREE.AdditiveBlending,depthWrite:false,fog:false,map:sparkTex
});
const magParticles=new THREE.Points(magParticleGeo,magParticleMat);
magParticles.frustumCulled=false;magParticles.visible=false;scene.add(magParticles);
// 鸭子周身磁场辉光
const magGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,transparent:true,opacity:0,color:0x7fd4ff,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
magGlow.scale.set(2.6,2.6,1);magGlow.visible=false;scene.add(magGlow);
// 磁铁 HUD（激活时显示倒计时）
const magnetHud=document.createElement('div');magnetHud.id='magnet-hud';
magnetHud.style.cssText='background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#66bbff;padding:5px 14px;border-radius:10px;font-size:14px;display:none;align-items:center;gap:6px;border:1px solid rgba(102,187,255,.4);pointer-events:none;box-shadow:0 0 16px rgba(102,187,255,.3)';
magnetHud.innerHTML='<i class="fa-solid fa-magnet"></i> 磁吸 <span style="color:#ffd700;font-weight:bold;font-size:16px" id="mag-time">0</span>s';
document.getElementById('hud').appendChild(magnetHud);

// 游戏状态
let score=0,hasShield=false,shieldTimer=0,invincible=0;
let isPaused=false; // 暂停状态
// 成就永久奖励（游戏开始时计算一次）
let activeRewards={scoreBonus:0,speedBonus:0,shieldBonus:0,whirlResist:0,streakBonus:0,maxHearts:0};
// toast 已迁移到 ui/hud.js（main.js 通过 import 使用，无需 window 桥接）
let streakItems=[];let streakActive=false;let streakTimer=0;let scoreMultiplier=1;let streakType='';let bigTimer=0;// 'same' or 'diff'
// STREAK_ICONS/STREAK_COLORS 已迁移到 core/config.js
function addScore(n,type='score'){
    const blessingMult=Blessings.getScoreMult(n>0?type:null);
    const achBonus=1+(activeRewards.scoreBonus||0);
    const mult=(streakActive?scoreMultiplier:1)*blessingMult*achBonus;
    const actual=n*mult;
    score=Math.max(0,score+actual);
    document.getElementById('score').textContent=formatScore(score);
    if(mult>1&&n>0){
        let msg=`<i class="fa-solid fa-fire"></i> +${Math.floor(n*achBonus)}`;
        if(streakActive&&scoreMultiplier>1) msg+=`×${scoreMultiplier}`;
        if(blessingMult>1) msg+=` <i class="fa-solid fa-star"></i> ×${blessingMult}`;
        toast(msg,actual>=0?'p':'m');
    }
}
function trackStreak(type){
    if(type==='rock')return;// 岩石不计入连胜
    // 成就追踪：累计收集道具数（含血瓶/磁铁）
    Achievements.updateStat('totalItems',1);
    runStats.items++;
    // 血瓶(heart)也算入；每收集3个判定一次
    streakItems.push(type);
    updateStreakUI();
    if(streakItems.length>=3){
        const [a,b,c]=streakItems;
        if(a===b&&b===c){
            // 3个相同 → 同色连胜10倍
            activateStreak('same',a);
        }else if(a!==b&&b!==c&&a!==c){
            // 3个完全不同 → 异色连胜5倍
            activateStreak('diff','');
        }else{
            // 混合（2同1异）→ 不触发连胜，仅提示
            toast('<i class="fa-solid fa-xmark"></i> 组合失败','m');
        }
        // 判定后清空进度，开启下一轮收集
        streakItems=[];
        updateStreakUI();
    }
}
// updateStreakUI 已迁移到 ui/hud.js
function activateStreak(kind,itemType){streakActive=true;streakTimer=10+(activeRewards.streakBonus||0);streakType=kind;
// 成就追踪：累计触发连胜次数
Achievements.updateStat('streaks',1);
if(kind==='same'){scoreMultiplier=10;document.getElementById('multi-text').innerHTML='<i class="fa-solid fa-fire"></i> ×10 连胜！';playSFX('multi')}else{scoreMultiplier=5;document.getElementById('multi-text').innerHTML='<i class="fa-solid fa-star"></i> ×5 连胜！';playSFX('multi')}
document.getElementById('multi-text').classList.add('show');setTimeout(()=>document.getElementById('multi-text').classList.remove('show'),3000);
document.getElementById('combo-border').classList.add('active');
// 鸭子变大4倍+无敌3s+积分倍率 全部持续10秒
if(duckModel)duckModel.scale.setScalar(.72*4);bigTimer=10;invincible=3;
// 皇冠可见
crownGroup.visible=true;
// 显示计时器
document.getElementById('streak-timer').style.display='inline';
toast(`<i class="fa-solid fa-crown"></i> ${kind==='same'?'同色':'混色'}连胜 ${scoreMultiplier}倍积分！`,'p')}
function updateStreak(dt){if(!streakActive)return;streakTimer-=dt;document.getElementById('streak-timer').textContent=Math.ceil(streakTimer)+'s';
// 变大持续10s，到时缩回正常尺寸（积分倍率仍持续至 streakTimer 结束）
if(bigTimer>0){bigTimer-=dt;if(bigTimer<=0){bigTimer=0;if(duckModel)duckModel.scale.setScalar(.72)}}
if(streakTimer<=0){streakActive=false;scoreMultiplier=1;streakType='';
document.getElementById('combo-border').classList.remove('active');
document.getElementById('multi-text').classList.remove('show');document.getElementById('streak-timer').style.display='none';
if(duckModel)duckModel.scale.setScalar(.72);bigTimer=0;invincible=0;crownGroup.visible=false;auraMesh.visible=false;
updateStreakUI()}}
function activateShield(){hasShield=true;shieldTimer=15*(1+(activeRewards.shieldBonus||0));document.getElementById('shield-hud').style.display='flex';shieldMesh.visible=true;playSFX('shield');toast('<i class="fa-solid fa-shield-halved"></i> 护盾','s')}
function activateMagnet(){
    magnetActive=true;magnetTimer=MAGNET_DURATION*Blessings.getMagnetMult();
    magnetRangeRing.visible=true;
    magnetPulse.forEach(r=>r.visible=true);
    magParticles.visible=true;
    magGlow.visible=true;
    magnetHud.style.display='flex';
    playSFX('shield');
    toast('<i class="fa-solid fa-magnet"></i> 磁吸激活','s');
}
function updateMagnet(dt){
    if(!magnetActive)return;
    magnetTimer-=dt;
    const dp=duckModel.position;
    const breathe=.5+Math.sin(gameClock*4)*.25;
    const mRange=getMagnetRange(); // 元旦磁铁范围 ×2
    // 范围圈：贴合浪面跟随鸭子，虚线流动 + 呼吸闪烁
    magnetRangeRing.userData.update(dp.x,dp.z,mRange-1.2,mRange,.15);
    magnetRangeRing.material.opacity=.55+Math.sin(gameClock*4)*.2;
    magnetDashTex.offset.x-=dt*.8;
    // 内收脉冲环：两圈交替从外缘收缩到鸭子
    for(let i=0;i<2;i++){
        const ph=(gameClock*.45+i*.5)%1,r=1+ph*(mRange-1);
        magnetPulse[i].userData.update(dp.x,dp.z,Math.max(r-.5,.2),r,.12);
        magnetPulse[i].material.opacity=(1-ph)*.4;
    }
    // 磁场粒子：螺旋向内 + 抬升汇聚到鸭子，颜色由青渐白
    const pos=magParticleGeo.attributes.position,col=magParticleGeo.attributes.color;
    for(let i=0;i<MAG_PARTICLES;i++){
        const p=magParticleData[i];
        p.angle+=dt*p.speed*1.5;            // 角速度（环绕）
        p.radius-=dt*p.speed*2.2;           // 径向速度（向内吸入）
        if(p.radius<.6){                    // 到达中心，重置到外圈
            p.radius=mRange-Math.random()*2;
            p.angle=Math.random()*Math.PI*2;
            p.yOff=(Math.random()-.5)*1.2;
        }
        const t=1-p.radius/mRange;          // 0=外圈，1=近身
        const y=dp.y+.3+p.yOff*(1-t)+Math.sin(gameClock*3+p.angle*2)*.15+t*.6;
        pos.setXYZ(i,dp.x+Math.cos(p.angle)*p.radius,y,dp.z+Math.sin(p.angle)*p.radius);
        col.setXYZ(i,.35+t*.65,.75+t*.25,1);
    }
    pos.needsUpdate=true;col.needsUpdate=true;
    magParticleMat.opacity=.85*breathe;
    // 鸭子周身辉光
    magGlow.position.set(dp.x,dp.y+.7,dp.z);
    magGlow.material.opacity=.3+Math.sin(gameClock*5)*.15;
    const gs=2.4+Math.sin(gameClock*5)*.3;magGlow.scale.set(gs,gs,1);
    document.getElementById('mag-time').textContent=Math.ceil(Math.max(0,magnetTimer));
    if(magnetTimer<=0){magnetActive=false;magnetRangeRing.visible=false;magnetRangeRing.material.opacity=0;magnetPulse.forEach(r=>{r.visible=false;r.material.opacity=0});magParticles.visible=false;magParticleMat.opacity=0;magGlow.visible=false;magGlow.material.opacity=0;magnetHud.style.display='none'}
}

// 随机海浪事件
const cur={x:0,z:0,y:0};let waveT=0;
function updateCur(dt){
    waveT+=dt*1.2;cur.y=Math.sin(waveT)*1.2;
    // duo guest：水流方向箭头事件由房主 scene 同步负责，跳过本地随机生成
    if(!duoIsGuest()){
        waveEventTimer-=dt;
        if(!waveEventActive&&waveEventTimer<=0){
            waveEventActive=true;
            const a=Math.random()*Math.PI*2;
            waveEventDir={x:Math.cos(a),z:Math.sin(a)};
            waveEventStrength=.8+Math.random()*.6;
            waveEventDuration=3+Math.random()*3;
            drawArrowTexture(a);arrowTex.needsUpdate=true;
        }
    }
    if(waveEventActive){
        if(!duoIsGuest())waveEventDuration-=dt;
        cur.x=waveEventDir.x*waveEventStrength;
        cur.z=waveEventDir.z*waveEventStrength;
        arrowPlane.material.opacity=Math.min(1,Math.max(0,waveEventDuration)/.5)*.6;
        arrowTex.offset.x+=dt*waveEventDir.x*.02;
        arrowTex.offset.y+=dt*waveEventDir.z*.02;
        if(waveEventDuration<=0){
            waveEventActive=false;
            if(!duoIsGuest())waveEventTimer=12+Math.random()*18;
            cur.x=0;cur.z=0;
            arrowPlane.material.opacity=0;
        }
    }
    // 浪高振幅随海浪事件平滑增减（事件时波涛汹涌，平时平缓）
    waveBoost+=((Math.max(waveEventActive?1.55:1,eventWaveTarget))-waveBoost)*Math.min(1,dt*1.2);
    return cur}

// 鸭子（base64 内嵌 GLB 模型）
let duckModel=null;const duckVel=new THREE.Vector3();const mv={f:false,b:false,l:false,r:false,str:0};
let duoRemoteDuck=null,duoRemoteTarget=null,duoLocalNameLabel=null,duoRemoteSkin=null,duoRemotePalette=null;
let duoRemoteShield=null,duoRemoteMagnetRing=null,duoRemoteCrown=null,duoRemoteAura=null,duoRemoteMagGlow=null,duoRemoteMagnetPulse=[],duoRemoteMagParticles=null,duoRemoteMagParticleGeo=null,duoRemoteMagParticleData=[],duoRemoteMagParticleMat=null;
const duoRemotePosition=new THREE.Vector3();
// 远程鸭子航迹推算（Dead Reckoning）：对端状态约 5.5Hz 到达，按速度外推 + 柔性收敛，消除橡皮筋抖动
let duoRemotePrevSnap=null,duoRemotePrevSnapT=0,duoRemotePrevTarget=null;
const duoRemoteVel=new THREE.Vector3();
function duoOffsetXFor(role){return role==='guest'?3.5:role==='host'?-3.5:0}
function createDuoNameLabel(name){
    const labelCanvas=document.createElement('canvas');labelCanvas.width=360;labelCanvas.height=96;
    const ctx=labelCanvas.getContext('2d');ctx.fillStyle='rgba(9,15,26,.76)';ctx.roundRect(8,8,344,80,38);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='600 38px -apple-system, BlinkMacSystemFont, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name||'鸭鸭',180,49);
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(labelCanvas),transparent:true,depthTest:false}));label.userData.duoNameLabel=true;label.userData.duoName=name||'鸭鸭';
    label.position.set(0,2.7,0);label.scale.set(2.7,.72,1);return label;
}
function setDuoRemoteNameLabel(name){
    if(!duoRemoteDuck)return;
    const nextName=name||'好友',current=duoRemoteDuck.children.find(node=>node.userData?.duoNameLabel);
    if(current?.userData?.duoName===nextName)return;
    if(current)duoRemoteDuck.remove(current);
    duoRemoteDuck.add(createDuoNameLabel(nextName));
}
function setDuoLocalNameLabel(name){
    if(duoLocalNameLabel?.parent)duoLocalNameLabel.parent.remove(duoLocalNameLabel);
    duoLocalNameLabel=null;
    if(!duckModel)return;
    duoLocalNameLabel=createDuoNameLabel(name);duckModel.add(duoLocalNameLabel);
}
function removeDuoRemoteDuck(){
    if(duoRemoteDuck)scene.remove(duoRemoteDuck);
    if(duoRemoteShield){scene.remove(duoRemoteShield);duoRemoteShield.geometry.dispose();duoRemoteShield.material.dispose();duoRemoteShield=null}
    if(duoRemoteMagnetRing){scene.remove(duoRemoteMagnetRing);duoRemoteMagnetRing.geometry.dispose();duoRemoteMagnetRing.material.dispose();duoRemoteMagnetRing=null}
    if(duoRemoteCrown){scene.remove(duoRemoteCrown);duoRemoteCrown=null}
    if(duoRemoteAura){scene.remove(duoRemoteAura);duoRemoteAura.geometry.dispose();duoRemoteAura.material.dispose();duoRemoteAura=null}
    if(duoRemoteMagGlow){scene.remove(duoRemoteMagGlow);duoRemoteMagGlow.material.dispose();duoRemoteMagGlow=null}
    if(duoRemoteMagnetPulse.length){duoRemoteMagnetPulse.forEach(r=>{scene.remove(r);r.geometry.dispose();r.material.dispose()});duoRemoteMagnetPulse=[]}
    if(duoRemoteMagParticles){scene.remove(duoRemoteMagParticles);duoRemoteMagParticleGeo.dispose();duoRemoteMagParticleMat.dispose();duoRemoteMagParticles=null;duoRemoteMagParticleGeo=null;duoRemoteMagParticleMat=null;duoRemoteMagParticleData=[]}
    if(duoLocalNameLabel?.parent)duoLocalNameLabel.parent.remove(duoLocalNameLabel);
    duoLocalNameLabel=null;
    duoRemoteDuck=null;duoRemoteTarget=null;duoRemoteSkin=null;duoRemotePalette=null;
}
function createDuoRemoteDuck(name,state){
    removeDuoRemoteDuck();
    if(!duckModel)return;
    duoRemoteDuck=duckModel.clone(true);
    duoRemoteDuck.name='duo-remote-duck';
    const inheritedLabels=[];
    duoRemoteDuck.traverse(node=>{
        if(node.userData.duoNameLabel){inheritedLabels.push(node);return}
        if(!node.isMesh||!node.material)return;
        if(Array.isArray(node.material))node.material=node.material.map(mat=>{const next=mat.clone();if(mat.userData.duckOriginalMap)next.userData.duckOriginalMap=mat.userData.duckOriginalMap;return next});
        else{const original=node.material;node.material=original.clone();if(original.userData.duckOriginalMap)node.material.userData.duckOriginalMap=original.userData.duckOriginalMap}
    });
    inheritedLabels.forEach(label=>label.parent?.remove(label));
    duoRemoteSkin=state?.skin||'classic';
    duoRemotePalette=state?.palette||null;
    // 自定义皮肤缺合法 palette 时降级为 classic（避免误用本地 palette）
    if(duoRemoteSkin==='custom'&&( !duoRemotePalette || typeof duoRemotePalette!=='object' || !/^#[0-9a-fA-F]{6}$/.test(duoRemotePalette.body||'') || !/^#[0-9a-fA-F]{6}$/.test(duoRemotePalette.beak||'') )){duoRemoteSkin='classic';duoRemotePalette=null}
    applyDuckSkinToRoot(duoRemoteDuck,duoRemoteSkin,duoRemotePalette);
    duoRemoteDuck.add(createDuoNameLabel(name||'好友'));
    if(state){
        // 初始状态（房主/客机刚加入，state.x/z 均为 0）时，把对端鸭子放在本地鸭子对面，避免重叠
        // 优先使用 Duo.role 决定对端所在侧（房主端看到客机在 +3.5，客机端看到房主在 -3.5）
        let rx=state.x,rz=state.z;
        if(rx===0&&rz===0&&typeof Duo!=='undefined'&&Duo.active){
            rx=Duo.role==='host'?3.5:-3.5;
            rz=0;
        }
        const y=waveHeight(rx,rz,renderedWaveClock)-.08;
        duoRemoteDuck.position.set(rx,y,rz);duoRemoteDuck.rotation.y=state.ry||0;
    }
    duoRemoteDuck.visible=!!state&&!state.down;scene.add(duoRemoteDuck);
    // 远程鸭子的盾/磁铁光环/连胜皇冠/光环（与本地版本独立，避免互相覆盖可见性）
    if(!duoRemoteShield){
        duoRemoteShield=new THREE.Mesh(new THREE.SphereGeometry(1.8,32,24),new THREE.MeshPhysicalMaterial({color:0x44ddff,transparent:true,opacity:0,roughness:0,metalness:.3,clearcoat:1,side:THREE.DoubleSide,depthWrite:false}));
        duoRemoteShield.renderOrder=20;duoRemoteShield.visible=false;scene.add(duoRemoteShield);
    }
    if(!duoRemoteMagnetRing){
        duoRemoteMagnetRing=mkWaveRing(2,96,new THREE.MeshBasicMaterial({map:magnetDashTex,transparent:true,opacity:0,color:0x86d4ff,depthWrite:false,fog:false,side:THREE.DoubleSide}),6);
        duoRemoteMagnetRing.visible=false;scene.add(duoRemoteMagnetRing);
    }
    if(!duoRemoteCrown){
        duoRemoteCrown=crownGroup.clone(true);
        duoRemoteCrown.visible=false;scene.add(duoRemoteCrown);
    }
    if(!duoRemoteAura){
        duoRemoteAura=new THREE.Mesh(new THREE.SphereGeometry(2.5,24,16),auraMat.clone());
        duoRemoteAura.visible=false;duoRemoteAura.renderOrder=30;scene.add(duoRemoteAura);
    }
    // 远程鸭子磁铁吸引特效：脉冲环 + 鸭子辉光（与本地 magnetPulse / magGlow 对应，target.mt>0 时显示）
    if(duoRemoteMagnetPulse.length===0){
        for(let i=0;i<2;i++){
            const r=mkWaveRing(1,72,new THREE.MeshBasicMaterial({map:magnetPulse[i].material.map,transparent:true,opacity:0,color:0x9fe0ff,depthWrite:false,fog:false,side:THREE.DoubleSide}),8);
            r.visible=false;scene.add(r);duoRemoteMagnetPulse.push(r);
        }
    }
    if(!duoRemoteMagGlow){
        duoRemoteMagGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,transparent:true,opacity:0,color:0x7fd4ff,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
        duoRemoteMagGlow.scale.set(2.6,2.6,1);duoRemoteMagGlow.visible=false;scene.add(duoRemoteMagGlow);
    }
    // 远程鸭子磁场粒子（与本地 magParticles 对应，target.mt>0 时显示）
    if(!duoRemoteMagParticles){
        duoRemoteMagParticleGeo=new THREE.BufferGeometry();
        const pos=new Float32Array(MAG_PARTICLES*3),col=new Float32Array(MAG_PARTICLES*3);
        for(let i=0;i<MAG_PARTICLES;i++){
            duoRemoteMagParticleData.push({angle:Math.random()*Math.PI*2,radius:2+Math.random()*(MAGNET_RANGE-2),yOff:(Math.random()-.5)*1.2,speed:.6+Math.random()*.9});
        }
        duoRemoteMagParticleGeo.setAttribute('position',new THREE.BufferAttribute(pos,3));
        duoRemoteMagParticleGeo.setAttribute('color',new THREE.BufferAttribute(col,3));
        duoRemoteMagParticleMat=new THREE.PointsMaterial({size:.32,transparent:true,opacity:0,vertexColors:true,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,map:sparkTex});
        duoRemoteMagParticles=new THREE.Points(duoRemoteMagParticleGeo,duoRemoteMagParticleMat);
        duoRemoteMagParticles.frustumCulled=false;duoRemoteMagParticles.visible=false;scene.add(duoRemoteMagParticles);
    }
}
function updateDuoRemoteDuck(dt){
    if(!duoRemoteDuck||!duoRemoteTarget)return;
    const target=duoRemoteTarget;
    if(target.down){duoRemoteDuck.visible=false;return}
    duoRemoteDuck.visible=true;
    // 对端鸭子初始 state.x/z 为 0 时，使用 Duo.role 决定对端所在侧，避免两只鸭子重叠
    let tx=target.x,tz=target.z;
    if(tx===0&&tz===0&&typeof Duo!=='undefined'&&Duo.active){
        tx=Duo.role==='host'?3.5:-3.5;
        tz=0;
    }
    const y=waveHeight(tx,tz,renderedWaveClock)-.08+Math.sin(gameClock*1.8)*.035;
    // ---- 航迹推算：先按估计速度外推，再向最新快照柔性收敛 ----
    // 旧实现 dt*6 硬 lerp 追 5.5Hz 的离散目标点 → 每个新快照到达都"弹射"一下（橡皮筋抖动）
    const nowMs=performance.now();
    if(duoRemotePrevTarget&&duoRemotePrevSnapT>0){
        const snapDt=(duoRemotePrevSnapT-duoRemotePrevSnap.t)/1000;
        if(snapDt>.05&&snapDt<1.5){
            const ivx=(duoRemotePrevTarget.x-duoRemotePrevSnap.x)/snapDt;
            const ivz=(duoRemotePrevTarget.z-duoRemotePrevSnap.z)/snapDt;
            // 速度低通滤波，抑制网络抖动带来的速度毛刺；限速 6 防止异常值
            duoRemoteVel.x+=(ivx-duoRemoteVel.x)*.35;duoRemoteVel.z+=(ivz-duoRemoteVel.z)*.35;
            const spd=Math.hypot(duoRemoteVel.x,duoRemoteVel.z);
            if(spd>6){duoRemoteVel.x*=6/spd;duoRemoteVel.z*=6/spd}
        }
    }
    // 快照已过去的时间：外推补偿网络延迟（封顶 400ms，避免无限发散）
    const age=Math.min(.4,(nowMs-duoRemotePrevSnapT)/1000);
    const px=tx+duoRemoteVel.x*age,pz=tz+duoRemoteVel.z*age;
    duoRemotePosition.set(px,0,pz);
    // 位置收敛：误差小则慢速柔性逼近（视觉连续），误差大（重生/瞬移）直接归位
    const dx=px-duoRemoteDuck.position.x,dz=pz-duoRemoteDuck.position.z;
    const err2=dx*dx+dz*dz;
    if(err2>16){duoRemoteDuck.position.set(px,y,pz);duoRemoteVel.set(0,0,0)} // 瞬移：直接落位并清空速度
    else{
        // 误差越大收敛越快（dt*2~dt*10 自适应），小误差几乎不动 → 全程无级平滑
        const k=Math.min(1,dt*(2+Math.min(8,Math.sqrt(err2)*2.5)));
        duoRemoteDuck.position.x+=dx*k;duoRemoteDuck.position.z+=dz*k;
        duoRemoteDuck.position.y=waveHeight(duoRemoteDuck.position.x,duoRemoteDuck.position.z,renderedWaveClock)-.08+Math.sin(gameClock*1.8)*.035;
    }
    // 朝向：由移动方向推算（连续平滑）+ 快照 ry 慢速校准（防漂移）
    if(Math.abs(duoRemoteVel.x)+Math.abs(duoRemoteVel.z)>.15){
        const moveRy=Math.atan2(duoRemoteVel.x,duoRemoteVel.z);
        let md=moveRy-duoRemoteDuck.rotation.y;md=Math.atan2(Math.sin(md),Math.cos(md));
        duoRemoteDuck.rotation.y+=md*Math.min(1,dt*5);
    }
    let diff=(target.ry||0)-duoRemoteDuck.rotation.y;diff=Math.atan2(Math.sin(diff),Math.cos(diff));
    duoRemoteDuck.rotation.y+=diff*Math.min(1,dt*2.5);
    // ---- 对端特效同步：盾/磁铁/变大/无敌 ----
    // 远程鸭子盾：target.sh>0 时显示半透明盾罩
    if(target.sh>0){
        duoRemoteShield.visible=true;
        duoRemoteShield.position.copy(duoRemoteDuck.position);duoRemoteShield.position.y+=.3*.72;
        duoRemoteShield.scale.setScalar(.72);
        duoRemoteShield.material.opacity=.15+Math.sin(gameClock*3)*.08;
        duoRemoteShield.rotation.y=gameClock*.5;
    }else{duoRemoteShield.visible=false}
    // 远程鸭子变大效果：target.bt>0 时缩放 4 倍
    const targetScale=target.bt>0?.72*4:.72;
    duoRemoteDuck.scale.setScalar(targetScale);
    // 远程鸭子无敌闪烁：target.iv>0 时半透明。
    // 材质表在创建时缓存一次，避免每帧 traverse 遍历整棵子树（客机每帧数百次对象枚举 → 卡顿来源之一）
    if(!duoRemoteDuck.userData.fxMats){
        const mats=[];
        duoRemoteDuck.traverse(n=>{if(n.isMesh&&n.material){const m=Array.isArray(n.material)?n.material:[n.material];m.forEach(mm=>mats.push(mm))}});
        duoRemoteDuck.userData.fxMats=mats;
    }
    if(target.iv>0){duoRemoteDuck.userData.fxMats.forEach(mm=>{mm.transparent=true;mm.opacity=.5+Math.sin(gameClock*8)*.3})}
    else{duoRemoteDuck.userData.fxMats.forEach(mm=>{if(mm.opacity!==1)mm.opacity=1})}
    // 远程鸭子磁铁光环 + 脉冲环 + 辉光：target.mt>0 时显示
    if(target.mt>0&&duoRemoteMagnetRing){
        duoRemoteMagnetRing.visible=true;
        const mRange=16;
        const rdx=duoRemoteDuck.position.x,rdz=duoRemoteDuck.position.z;
        if(typeof duoRemoteMagnetRing.userData.update==='function')duoRemoteMagnetRing.userData.update(rdx,rdz,mRange-1.2,mRange,.15);
        else duoRemoteMagnetRing.position.set(rdx,waveHeight(rdx,rdz,renderedWaveClock),rdz);
        duoRemoteMagnetRing.material.opacity=.55+Math.sin(gameClock*4)*.2;
        // 脉冲环（两圈交替从外向内收缩，与本地 magnetPulse 一致）
        for(let i=0;i<duoRemoteMagnetPulse.length;i++){
            const ph=(gameClock*.45+i*.5)%1,r=1+ph*(mRange-1);
            const pr=duoRemoteMagnetPulse[i];
            if(typeof pr.userData.update==='function')pr.userData.update(rdx,rdz,Math.max(r-.5,.2),r,.12);
            pr.material.opacity=(1-ph)*.4;
            pr.visible=true;
        }
        // 鸭子周身磁场辉光（与本地 magGlow 一致）
        if(duoRemoteMagGlow){
            duoRemoteMagGlow.visible=true;
            duoRemoteMagGlow.position.set(rdx,duoRemoteDuck.position.y+.7,rdz);
            duoRemoteMagGlow.material.opacity=.3+Math.sin(gameClock*5)*.15;
            const gs=2.4+Math.sin(gameClock*5)*.3;duoRemoteMagGlow.scale.set(gs,gs,1);
        }
        // 磁场粒子：螺旋向内汇聚到鸭子（与本地 magParticles 一致）
        if(duoRemoteMagParticles){
            duoRemoteMagParticles.visible=true;
            const pos=duoRemoteMagParticleGeo.attributes.position,col=duoRemoteMagParticleGeo.attributes.color;
            for(let i=0;i<MAG_PARTICLES;i++){
                const p=duoRemoteMagParticleData[i];
                p.angle+=dt*p.speed*1.5;
                p.radius-=dt*p.speed*2.2;
                if(p.radius<.6){p.radius=mRange-Math.random()*2;p.angle=Math.random()*Math.PI*2;p.yOff=(Math.random()-.5)*1.2}
                const t=1-p.radius/mRange;
                const y=duoRemoteDuck.position.y+.3+p.yOff*(1-t)+Math.sin(gameClock*3+p.angle*2)*.15+t*.6;
                pos.setXYZ(i,rdx+Math.cos(p.angle)*p.radius,y,rdz+Math.sin(p.angle)*p.radius);
                col.setXYZ(i,.35+t*.65,.75+t*.25,1);
            }
            pos.needsUpdate=true;col.needsUpdate=true;
            duoRemoteMagParticleMat.opacity=.85*(.5+Math.sin(gameClock*4)*.25);
        }
    }else if(duoRemoteMagnetRing){
        duoRemoteMagnetRing.visible=false;duoRemoteMagnetRing.material.opacity=0;
        for(let i=0;i<duoRemoteMagnetPulse.length;i++){duoRemoteMagnetPulse[i].visible=false;duoRemoteMagnetPulse[i].material.opacity=0}
        if(duoRemoteMagGlow){duoRemoteMagGlow.visible=false;duoRemoteMagGlow.material.opacity=0}
        if(duoRemoteMagParticles){duoRemoteMagParticles.visible=false;duoRemoteMagParticleMat.opacity=0}
    }
    // 远程鸭子连胜皇冠 + 光环：target.sk>0 时显示（与本地 streakActive 一致，包含 streakBonus 延长）
    if(duoRemoteCrown&&duoRemoteAura){
        if(target.sk>0){
            duoRemoteCrown.visible=true;
            duoRemoteCrown.position.copy(duoRemoteDuck.position);
            duoRemoteCrown.position.y+=1.754*targetScale; // 跟随 scale 的 y 偏移（本地 crownGroup 在 duckModel 中 y=1.754）
            duoRemoteCrown.scale.setScalar(targetScale);  // 王冠跟随鸭子 scale（变大时同步变大）
            duoRemoteCrown.rotation.y=gameClock*2;
            duoRemoteCrown.children.forEach((c,i)=>{if(c.material)c.material.opacity=.7+Math.sin(gameClock*6+i)*.3});
            duoRemoteAura.visible=true;
            duoRemoteAura.position.copy(duoRemoteDuck.position);duoRemoteAura.position.y+=.5;
            duoRemoteAura.material.opacity=.04+Math.sin(gameClock*3)*.02;
            duoRemoteAura.rotation.y=gameClock*.5;
            const auraScale=duoRemoteDuck.scale.x*1.5+Math.sin(gameClock*2)*.2;
            duoRemoteAura.scale.setScalar(auraScale);
        }else{duoRemoteCrown.visible=false;duoRemoteAura.visible=false}
    }
}
const loader=new GLTFLoader();
const bar=document.getElementById('load-bar'),loadTxt=document.querySelector('#loader .txt');
const loaderBoot=window.__duckLoadBoot;
let loadProgress=loaderBoot?.progress||8;
function setLoadProgress(pct,msg){
    if(loaderBoot?.timer){clearInterval(loaderBoot.timer);loaderBoot.timer=null}
    loadProgress=Math.max(loadProgress,Math.min(100,pct));
    bar.style.width=loadProgress+'%';
    loadTxt.textContent=(msg||'加载中')+'... '+Math.floor(loadProgress)+'%';
}
// 分步加载，每步之间让出主线程给浏览器重绘
setLoadProgress(5,'初始化');
setLoadProgress(15,'加载模型');
loader.load('./assets/duck.glb',
    g=>{
        setLoadProgress(80,'场景构建');
        duckModel=g.scene;duckModel.scale.setScalar(.72);duckModel.position.set(0,.05,0);
        duckModel.traverse(c=>{if(c.isMesh){c.castShadow=true;c.receiveShadow=true;
            // Physical 材质 + 清漆层：搪胶小鸭的柔亮光泽感（高光柔、反射清）
            const om=c.material;if(om)c.material=new THREE.MeshPhysicalMaterial({color:0xffffff,map:om.map||null,roughness:.5,metalness:0,clearcoat:.42,clearcoatRoughness:.46,reflectivity:.5,sheen:.18,sheenRoughness:.7,sheenColor:0xffffff})}});
        scene.add(duckModel);
        applyDuckSkin(activeDuckSkin);
        duckModel.add(crownGroup);crownGroup.position.set(0.339,1.754,-0.047);
        setLoadProgress(100,'完成');hideLoader();
    },
    e=>{ if(e&&e.lengthComputable){const pct=15+Math.floor(e.loaded/e.total*65);setLoadProgress(pct,'加载模型');} },
    e=>{console.error('模型加载失败:',e);document.getElementById('err-msg').textContent=(e&&e.message)||String(e);document.getElementById('err-popup').style.display='block';document.getElementById('loader').classList.add('done')}
);
function startGameSession(){
    if(gameActive)return;
    hideModeEntry();
    document.getElementById('loader').classList.add('done');
    document.getElementById('help').classList.remove('show');
    const rewards=Achievements.getRewards();
    activeRewards=rewards;
    MAX_HEARTS=Math.min(8,5+(rewards.maxHearts||0));
    Blessings.apply();
    FestivalFx.start();
    updateHeartsUI();
    runStats={items:0,distance:0,startTime:Date.now()};
    gameActive=true;playStartTime=Date.now();
    // 双人模式：本地鸭子初始偏移到一侧（房主=-3.5，客机=+3.5），避免两只鸭子重叠
    if(Duo.active&&duckModel){const duoOffsetX=Duo.role==='guest'?3.5:Duo.role==='host'?-3.5:0;duckModel.position.set(duoOffsetX,.05,0);duckModel.rotation.set(0,0,0);duckModel.scale.setScalar(.72)}
    autoStartMusic();
    if(Duo.active)Duo.beginGame();
    setTimeout(()=>showBlessingSplash(),350);
    if(!localStorage.getItem('tutorial_done'))setTimeout(()=>showTutorial(),4200);
}
function resetRunState(){
    // 原地开新局：销毁仅属于上一局的临时对象，保留设置、皮肤、祝福和已保存成绩。
    document.getElementById('gameover').classList.remove('show');
    document.getElementById('pause-overlay').classList.remove('show');
    document.getElementById('share-modal').classList.remove('show');
    document.getElementById('blessing-splash').classList.remove('show');
    stopBlessingFx();
    document.getElementById('tutorial').classList.remove('show');
    isPaused=false;gameActive=false;lastEntry=null;pendingScore=0;pendingPlayTime=0;
    FestivalFx.stop();
    for(const item of items)scene.remove(item.mesh);items.length=0;
    for(const whirl of whirlpools){scene.remove(whirl.group);if(whirl.rim)scene.remove(whirl.rim);if(whirl.field)scene.remove(whirl.field);if(whirl.lantern)scene.remove(whirl.lantern)}
    whirlpools.length=0;whirlZones.length=0;
    for(const fx of transientFx)scene.remove(fx.m);transientFx.length=0;
    endEvent();removeShark();hideWarn();
    score=0;hearts=3;hasShield=false;shieldTimer=0;invincible=0;
    shieldMesh.visible=false;shieldMesh.material.opacity=0;
    document.getElementById('shield-hud').style.display='none';
    magnetActive=false;magnetTimer=0;magnetRangeRing.visible=false;magnetRangeRing.material.opacity=0;
    magnetPulse.forEach(r=>{r.visible=false;r.material.opacity=0});magParticles.visible=false;magParticleMat.opacity=0;magGlow.visible=false;magGlow.material.opacity=0;magnetHud.style.display='none';
    streakItems=[];streakActive=false;streakTimer=0;scoreMultiplier=1;streakType='';bigTimer=0;
    crownGroup.visible=false;auraMesh.visible=false;document.getElementById('combo-border').classList.remove('active');document.getElementById('combo-border').style.opacity='0';document.getElementById('multi-text').classList.remove('show');
    duckSink.state='none';duckSink.t=0;duckSink.whirl=null;sinkFx=0;screenShakeT=0;duckVel.set(0,0,0);
    heartTimer=8;whirlSpawnTimer=0;globalEventTimer=30;activeEventTime=0;pendingEvent=null;warnedFor=null;waveSpeed=1;waveSpeedTarget=1;eventWaveTarget=1;
    if(duckModel){duckModel.visible=true;const duoOffsetX=(typeof Duo!=='undefined'&&Duo.active&&Duo.role==='guest')?3.5:(typeof Duo!=='undefined'&&Duo.active&&Duo.role==='host')?-3.5:0;duckModel.position.set(duoOffsetX,.05,0);duckModel.rotation.set(0,0,0);duckModel.scale.setScalar(.72)}
    if(controls){controls.target.set(0,1,0)}
    document.getElementById('score').textContent='0';updateHeartsUI();updateStreakUI();if(!duoIsGuest())spawnAround(0,0);
    // 重开后重新发放节日特效：Blessings.apply 重算护盾/生命，FestivalFx.start 重建月亮/覆盖层粒子
    Blessings.apply();FestivalFx.start();updateHeartsUI();
}
function hideModeEntry(){
    const solo=document.getElementById('start-btn'),duo=document.getElementById('duo-btn');
    if(solo)solo.style.display='none';
    if(duo)duo.style.display='none';
}
function showModeEntry(){
    if(gameActive)return;
    const solo=document.getElementById('start-btn'),duo=document.getElementById('duo-btn');
    if(solo)solo.style.display='block';
    if(duo)duo.style.display='block';
}
function hideLoader(){
    setTimeout(()=>{
        loadTxt.textContent='加载完成，准备出发！';
        // 模式入口出现后，进度提示不再占位，避免与两枚入口按钮重叠。
        loadTxt.style.display='none';
        const btn=document.getElementById('start-btn');
        btn.innerHTML='<i class="fa-solid fa-compass"></i> 单人模式';
        showModeEntry();
        btn.onclick=startGameSession;
        document.getElementById('duo-btn').onclick=window.openDuoModal;
    },300)
}
// 相机：用 OrbitControls 自由旋转，自动跟随鸭子位置
let cameraYaw=0;
function updateCam(dt){if(!duckModel)return;
// 手动操控计时器衰减
if(cam.manualCamTimer>0)cam.manualCamTimer-=dt;
if(cam.manualCamTimer<=0){
    // 相机自动跟随：保持当前方向角，平滑跟随鸭子
    const lookDir=controls.target.clone().sub(camera.position);
    const camDist=camera.position.distanceTo(controls.target);
    const azimuth=Math.atan2(lookDir.x,lookDir.z);
    // 相机高度：固定偏移 + 极缓慢跟随鸭子 Y（避免浪面起伏导致相机卡顿）
    // 用 .008 的低通滤波平滑鸭子 Y 变化，消除浪面高频抖动传递到相机
    if(!updateCam._smoothDuckY)updateCam._smoothDuckY=duckModel.position.y;
    updateCam._smoothDuckY+=(duckModel.position.y-updateCam._smoothDuckY)*.008;
    const targetPos=duckModel.position.clone().add(new THREE.Vector3(
        -Math.sin(azimuth)*camDist, updateCam._smoothDuckY+4.2, -Math.cos(azimuth)*camDist
    ));
    camera.position.lerp(targetPos,.04);
}
controls.target.lerp(duckModel.position.clone().add(new THREE.Vector3(0,1,0)),.05);
if(stormActive){const d=camera.position.distanceTo(controls.target);if(d>9)camera.position.lerp(controls.target,dt*.4);}
// 雷击震动
if(camShake>0){camShake-=dt;const s=camShake*.5;camera.position.x+=(Math.random()-.5)*s;camera.position.y+=(Math.random()-.5)*s*.6;camera.position.z+=(Math.random()-.5)*s}
}

// 碰撞
function checkHit(){if(!duckModel)return;const dp=duckModel.position;
for(const it of items){if(it.coll)continue;
// 水平距离判定（忽略Y轴差异），碰撞范围加大
const dx=dp.x-it.mesh.position.x,dz=dp.z-it.mesh.position.z;
const hDist=Math.sqrt(dx*dx+dz*dz);
const duckScale=duckModel.scale.x/.72;const duckRadius=0.6*duckScale;const hitR=it.r+duckRadius; // 碰撞半径随鸭子变大
if(hDist<hitR){
// 无敌状态：跳过岩石碰撞，但可以收集物品
if(invincible>0&&it.type==='rock')continue;
switch(it.type){case'rock':{
// 国庆：石头变成蛋糕，撞碎得分不扣血（咀嚼音效 + 奶油色碎屑）
if(Blessings.festival?.id==='festival_national_day'){
    addScore(2,'score');toast('<i class="fa-solid fa-cake-candles"></i> +2','p');playSFX('chew');trackStreak('flower');
    spawnRockShatter(it.mesh.position.clone(),it.mesh.scale.x,[0xfff1dd,0xff9db0,0xd91e36]);
    it.coll=true;scene.remove(it.mesh);
    break;
}
const kb=dp.clone().sub(it.mesh.position).normalize().multiplyScalar(2);takeDamage(1,'rock');duckVel.add(kb);
// 保护机制：撞击后石头粉碎销毁，避免连续扣血
const rockScale=it.mesh.scale.x;
spawnRockShatter(it.mesh.position.clone(),rockScale);
    it.coll=true;scene.remove(it.mesh); // 立即从场景移除，下一帧由 despawn 逻辑清理 items
    break;}
case'flower':addScore(2,'flower');if(rainbowActive)addScore(5);if(!streakActive||scoreMultiplier<=1)toast('<i class="fa-solid fa-sun"></i> +2','p');playSFX('flower');trackStreak('flower');it.coll=true;it.mesh.visible=false;setTimeout(()=>{const _ra=Math.random()*Math.PI*2,_rd=10+Math.random()*15;it.mesh.position.set(duckModel.position.x+Math.cos(_ra)*_rd,-.02,duckModel.position.z+Math.sin(_ra)*_rd);it.mesh.visible=true;it.coll=false},2000);break;
case'grass':addScore(1,'grass');if(rainbowActive)addScore(5);if(!streakActive||scoreMultiplier<=1)toast('<i class="fa-solid fa-seedling"></i> +1','p');playSFX('grass');trackStreak('grass');it.coll=true;it.mesh.visible=false;setTimeout(()=>{const _ra=Math.random()*Math.PI*2,_rd=10+Math.random()*15;it.mesh.position.set(duckModel.position.x+Math.cos(_ra)*_rd,0,duckModel.position.z+Math.sin(_ra)*_rd);it.mesh.visible=true;it.coll=false},2000);break;
case'lily':if(!it.coll){addScore(3,'lily');if(!streakActive||scoreMultiplier<=1)toast('<i class="fa-solid fa-spa" style="color:#ff9ec7"></i> 荷叶','p');playSFX('collect');trackStreak('lily');activateShield();it.coll=true;it.mesh.visible=false;setTimeout(()=>{const _ra=Math.random()*Math.PI*2,_rd=10+Math.random()*15;it.mesh.position.set(duckModel.position.x+Math.cos(_ra)*_rd,.01,duckModel.position.z+Math.sin(_ra)*_rd);it.mesh.visible=true;it.coll=false},3000)}break;
    case'heart':heal(1);playSFX('heal');trackStreak('heart');it.coll=true;scene.remove(it.mesh);spawnHeartParticles(it.mesh.position.clone());break;
    case'magnet':activateMagnet();playSFX('magnet');trackStreak('magnet');it.coll=true;scene.remove(it.mesh);break}}}}

// 更新鸭子
let duckYaw=0; // 鸭子面朝方向（弧度，自动跟随移动方向）
let duckSpeed=0; // 当前速度
const DUCK_MAX_SPEED=4.0,DUCK_ACCEL=5.0,DUCK_DECEL=6.0;
// GLB 模型初始朝向修正：经典 Rubber Duck 模型面朝 -Z，需旋转 Math.PI 使其面朝 +Z
const DUCK_ROT_OFFSET=Math.PI;
// 拨水尾迹 + 尾部水花：随鸭子的速度周期性生成（节流，避免每帧过多特效）
let duckWakeTimer=0,duckSplashTimer=0,_paddleSfxTimer=0,_magnetSfxTimer=0;
// 鸭子尾迹：不规则涟漪环（顶点扰动）+ 多层延迟扩散，模拟真实水波纹
// 制作不规则环：用 RingGeometry，对每个顶点施加随机径向扰动，形成自然水波边缘
function makeIrregularRing(innerR,outerR,segments,jitter){
    const geo=new THREE.RingGeometry(innerR,outerR,segments);
    const pos=geo.attributes.position;
    // 为每个顶点施加径向扰动（沿其到中心的法线方向偏移）
    for(let i=0;i<pos.count;i++){
        const x=pos.getX(i),y=pos.getY(i);
        const len=Math.sqrt(x*x+y*y);
        if(len<1e-4)continue;
        // 随机扰动量 ±jitter，使用 sin/cos 让扰动有连续性而非纯随机
        const ang=Math.atan2(y,x);
        const n=Math.sin(ang*3+Math.random()*6)*.5
               +Math.sin(ang*7+Math.random()*4)*.3
               +Math.sin(ang*13+Math.random()*2)*.2;
        const off=n*jitter;
        pos.setX(i,x+(x/len)*off);
        pos.setY(i,y+(y/len)*off);
    }
    pos.needsUpdate=true;
    geo.computeVertexNormals();
    return geo;
}
function spawnDuckWake(pos,yaw,speed,scaleFactor){
    scaleFactor=scaleFactor||1;
    // 大鸭子体型大 → 尾部位置后移、涟漪半径/扰动/水珠尺寸全部按 scaleFactor 放大
    const backOff=.55*scaleFactor;
    const backX=pos.x-Math.sin(yaw)*backOff,backZ=pos.z-Math.cos(yaw)*backOff;
    const baseY=waveHeight(backX,backZ,renderedWaveClock);
    const baseScale=(Math.min(1.4,.5+speed*.2))*scaleFactor;
    // 三层涟漪扩散：依次延迟启动、初始半径递增、寿命递减，形成"一波未平一波又起"的水波感
    // 每层使用独立的不规则环几何体（顶点扰动量不同），让形状自然随机；半径与扰动随体型放大
    const layers=[
        {delay:0,   inner:.24*scaleFactor,outer:.28*scaleFactor,jitter:.04*scaleFactor,life:1.4,opacity:.55,scaleMul:1.0},
        {delay:.18, inner:.30*scaleFactor,outer:.34*scaleFactor,jitter:.05*scaleFactor,life:1.2,opacity:.40,scaleMul:1.3},
        {delay:.38, inner:.36*scaleFactor,outer:.40*scaleFactor,jitter:.06*scaleFactor,life:1.0,opacity:.28,scaleMul:1.7}
    ];
    layers.forEach(L=>{
        const ring=new THREE.Mesh(
            makeIrregularRing(L.inner,L.outer,28,L.jitter),
            new THREE.MeshBasicMaterial({
                color:0xc8e6ff,transparent:true,opacity:L.opacity,side:THREE.DoubleSide,
                depthWrite:false,depthTest:false,fog:false
            })
        );
        ring.position.set(backX,baseY+.08,backZ);
        ring.rotation.x=-Math.PI/2;
        ring.renderOrder=999;
        scene.add(ring);
        ring.scale.setScalar(baseScale*L.scaleMul);
        // 通过 delay 控制启动时间：life 初始扣减 delay，让后两层"延后开始扩散"
        transientFx.push({
            m:ring,wake:true,wakeDelay:L.delay,
            vx:0,vy:0,vz:0,
            life:L.life+L.delay,max:L.life+L.delay,
            baseOpacity:L.opacity
        });
    });
    // 两侧小水珠：向后外侧漂移，形成自然 V 形拨水（大鸭子水珠更粗、漂得更远）
    for(let side=-1;side<=1;side+=2){
        const m=new THREE.Mesh(
            new THREE.SphereGeometry((.05+Math.random()*.03)*scaleFactor,10,8),
            new THREE.MeshBasicMaterial({
                color:0xeaf6ff,transparent:true,opacity:.8,fog:false,
                depthWrite:false,depthTest:false
            })
        );
        const offX=(Math.cos(yaw)*.4*side-Math.sin(yaw)*.3)*scaleFactor;
        const offZ=(-Math.sin(yaw)*.4*side-Math.cos(yaw)*.3)*scaleFactor;
        m.position.set(pos.x+offX,baseY+.05*scaleFactor,pos.z+offZ);
        m.renderOrder=1000;
        scene.add(m);
        const driftAng=yaw+Math.PI+(side*.5);
        const sp=(.4+speed*.15)*scaleFactor;
        transientFx.push({
            m,vx:Math.sin(driftAng)*sp,vy:.16*scaleFactor,vz:Math.cos(driftAng)*sp,
            life:.7,max:.7,gravity:1.5
        });
    }
}
function spawnTailSplash(pos,yaw,speed,scaleFactor){
    scaleFactor=scaleFactor||1;
    // 尾部水花：5-7 颗蓝白渐变水珠贴着水面向后飞溅
    // 关键：起始 y 只高出波面一点（.12），初速低、重力大，水花低矮贴水才自然
    const backOff=.5*scaleFactor;
    const backX=pos.x-Math.sin(yaw)*backOff,backZ=pos.z-Math.cos(yaw)*backOff;
    const baseY=waveHeight(backX,backZ,renderedWaveClock);
    const n=Math.floor((5+Math.floor(Math.min(speed,4)*.6))*Math.min(scaleFactor,2.2));
    for(let i=0;i<n;i++){
        // 高质量球体（12 段）+ 蓝白渐变色 + 不参与深度测试；半径随体型放大
        const isTop=Math.random()<.4;
        const m=new THREE.Mesh(
            new THREE.SphereGeometry((.06+Math.random()*.04)*scaleFactor,12,10),
            new THREE.MeshBasicMaterial({
                color:isTop?0xffffff:0xb8e3ff,
                transparent:true,opacity:.95,fog:false,
                depthWrite:false,depthTest:false
            })
        );
        // 起始位置：尾部水面之上 0.1-0.18，加少量横向偏移；偏移量随体型放大
        const sideOff=(Math.random()-.5)*.4*scaleFactor;
        m.position.set(
            backX+Math.cos(yaw)*sideOff,
            baseY+(.1+Math.random()*.08)*scaleFactor,
            backZ-Math.sin(yaw)*sideOff
        );
        m.renderOrder=1001;
        scene.add(m);
        // 后向飞溅：与鸭子朝向相反，加少量侧向扰动；初速低+重力大 → 低矮抛物线贴水面
        const spread=(Math.random()-.5)*.7;
        const backAng=yaw+Math.PI+spread;
        const sp=(1.6+Math.random()*1.8+speed*.25)*Math.min(scaleFactor,1.6);
        const vy0=(1.1+Math.random()*.7)*Math.min(scaleFactor,1.5);
        transientFx.push({m,vx:Math.sin(backAng)*sp,vy:vy0,vz:Math.cos(backAng)*sp,life:.7,max:.7,gravity:9});
    }
}
function updateDuck(dt){if(!duckModel)return;if(!gameActive)return;
// 变大时（连胜巨鸭）移动更灵敏：最大速度/加速度/转向随体型提升
const bigMul=1+(duckModel.scale.x/.72-1)*0.45;
    const achSpd=1+(activeRewards.speedBonus||0); // 成就永久速度加成
    const blessingSpd=Blessings.getSpeedMult();
    const maxSpd=DUCK_MAX_SPEED*bigMul*achSpd*blessingSpd,accel=DUCK_ACCEL*bigMul*achSpd*blessingSpd;
// ===== 视角相对控制 =====
// 用 controls.target - camera.position 获取可靠的视角方向
const _lookDir=controls.target.clone().sub(camera.position);
_lookDir.y=0; _lookDir.normalize(); // 视角前方（水平投影）
const camFwd=_lookDir; // 相机看的前方
const camRight=new THREE.Vector3(-camFwd.z,0,camFwd.x); // 相机右方
// 计算目标速度方向（相机坐标系）
let moveDir=new THREE.Vector3(0,0,0);
const joyActive=mv._joySpeed!==undefined&&mv._joySpeed>0;
if(joyActive){
  // 摇杆模式：mv.joyDx/joyDy 已存为归一化方向
  moveDir.addScaledVector(camFwd, mv.joyDy||0);
  moveDir.addScaledVector(camRight, mv.joyDx||0);
  if(moveDir.length()>0.01)moveDir.normalize();
   const targetSpd=Math.min(maxSpd,mv._joySpeed*bigMul*achSpd*blessingSpd);
  duckSpeed+=(targetSpd-duckSpeed)*dt*8*Math.min(bigMul,2);
}else{
  // 键盘模式：W/S=前后, A/D=左右
  if(mv.f)moveDir.add(camFwd);
  if(mv.b)moveDir.sub(camFwd);
  if(mv.l)moveDir.sub(camRight);
  if(mv.r)moveDir.add(camRight);
  if(moveDir.length()>0.01){
    moveDir.normalize();
    duckSpeed=Math.min(maxSpd,duckSpeed+accel*dt);
  }else{
    // 松开按键减速停止
    if(duckSpeed>0)duckSpeed=Math.max(0,duckSpeed-DUCK_DECEL*dt);
    else if(duckSpeed<0)duckSpeed=Math.min(0,duckSpeed+DUCK_DECEL*dt);
  }
}
// 目标速度
const tv=moveDir.clone().multiplyScalar(duckSpeed);
// 水流影响（始终影响，增强效果）
const c=updateCur(dt);
tv.x+=c.x*1.5; tv.z+=c.z*1.5;
if(windActive){tv.multiplyScalar(windSpeedMul);}
duckVel.lerp(tv,tv.length()>.1?Math.min(.32,.12*bigMul):.06);
const _beforeX=duckModel.position.x,_beforeZ=duckModel.position.z;
duckModel.position.add(duckVel.clone().multiplyScalar(dt));
// 成就追踪：累计移动距离（单位：米，目标 10000=10km）
const _moved=Math.hypot(duckModel.position.x-_beforeX,duckModel.position.z-_beforeZ);
if(_moved>0.001){Achievements.updateStat('totalDistance',_moved);runStats.distance+=_moved}
// 鸭子自动面向移动方向
const hVel=duckVel.clone(); hVel.y=0;
if(hVel.length()>0.15){
  const targetYaw=Math.atan2(hVel.x,hVel.z);
  let diff=targetYaw-duckYaw;
  while(diff>Math.PI)diff-=Math.PI*2;while(diff<-Math.PI)diff+=Math.PI*2;
  duckYaw+=diff*dt*8*Math.min(bigMul,1.8); // 平滑转向（变大时更灵敏）
}
// 鸭子始终浮在海浪之上：以 renderedWaveClock 采样，与"渲染中的水面网格"严格同相，
// 网格隔帧更新期间鸭子不再与浪面错位 → 根治闪烁与被浪穿模（暴风雨时尤其明显）
const px=duckModel.position.x,pz=duckModel.position.z;
const duckScale=duckModel.scale.x/.72;
const hC=waveHeight(px,pz,renderedWaveClock);
// 数值求浪面坡度，让鸭子随浪面倾斜（更真实的漂浮感）
const ws=.9;
const slopeX=(waveHeight(px+ws,pz,renderedWaveClock)-waveHeight(px-ws,pz,renderedWaveClock))/(2*ws);
const slopeZ=(waveHeight(px,pz+ws,renderedWaveClock)-waveHeight(px,pz-ws,renderedWaveClock))/(2*ws);
// 逆风吃力姿态：减速时鸭子前倾（向前顶风）、bob 减弱（更费力更迟钝）
const headwindFactor=(windActive&&windSpeedMul<1)?1:0;
const bobFreq=headwindFactor?1.0:1.8;
const bobY=Math.sin(gameClock*bobFreq)*.04*(1-headwindFactor*.4);
// 模型底部相对原点约 0.072*duckScale，让底部略没入水中（waveHeight 对时空均光滑，直接赋值无抖动）
duckModel.position.y=hC-0.11*duckScale+bobY;
// 鸭子朝向（模型默认面朝+X，需补偿-90°使嘴巴朝运动方向）
duckModel.rotation.order='YXZ';
duckModel.rotation.y=duckYaw-Math.PI/2;
// 世界坡度 → 鸭子本地前进/侧向坡度
const fwdX=Math.sin(duckYaw),fwdZ=Math.cos(duckYaw);
const slopeF=slopeX*fwdX+slopeZ*fwdZ; // 前进方向坡度→抬头/低头
const slopeS=slopeX*fwdZ-slopeZ*fwdX; // 侧向坡度→左右侧倾
// 摇摆动画 + 浪面倾斜（逆风时前倾吃力姿态：rotation.x 正值=向前倾，旋转频率减半更迟钝）
const sf=Math.min(duckVel.length()/DUCK_MAX_SPEED,1);
const swayFreq=headwindFactor?4:8;     // 逆风时摇摆变慢，表现挣扎
const headwindLean=headwindFactor*.18; // 顶风前倾量
duckModel.rotation.z=Math.sin(gameClock*swayFreq)*sf*.06+Math.sin(gameClock*.9)*.03+c.x*.04+slopeF*.5;
duckModel.rotation.x=-c.z*.04+slopeS*.5+headwindLean;
// 拨水尾迹 + 尾部水花：鸭子在移动时按周期生成（速度越快越频繁）
// 涟漪/水花按体型缩放：大鸭子产生更夸张的拨水效果
// 划水音效仅在鸭子高速移动且较长时间间隔触发一次，避免叠加产生嗡嗡声
if(duckVel.length()>0.6){
    duckWakeTimer-=dt;
    if(duckWakeTimer<=0){
        spawnDuckWake(duckModel.position,duckYaw,duckSpeed,duckScale);
        duckWakeTimer=Math.max(.12,.4-sf*.25);
    }
    duckSplashTimer-=dt;
    if(duckSplashTimer<=0&&duckVel.length()>1.5){
        spawnTailSplash(duckModel.position,duckYaw,duckSpeed,duckScale);
        duckSplashTimer=Math.max(.08,.22-sf*.12);
    }
    // 划水音效：仅当鸭子实际在拨水（速度>1.2）时按节奏触发，模拟双脚交替"啪嗒啪嗒"
    _paddleSfxTimer-=dt;
    if(_paddleSfxTimer<=0&&duckVel.length()>1.2){
        playSFX('paddle',duckScale);
        // 0.28-0.4s 一次，模拟脚掌交替入水的自然节奏
        _paddleSfxTimer=.28+Math.random()*.12;
    }
}
if(hasShield){shieldMesh.position.copy(duckModel.position);shieldMesh.position.y+=.3*duckScale;shieldMesh.scale.setScalar(duckScale);shieldMesh.material.opacity=.15+Math.sin(gameClock*3)*.08;shieldMesh.rotation.y=gameClock*.5;shieldTimer-=dt;if(shieldTimer<=0){hasShield=false;document.getElementById('shield-hud').style.display='none';shieldMesh.visible=false;shieldMesh.scale.setScalar(1)}}
// 连胜特效：光环+皇冠（仅连胜60s期间显示）
if(streakActive&&duckModel){crownGroup.visible=true;
// 王冠是鸭子子节点，位置/倾斜/缩放自动跟随，只需原地旋转
crownGroup.rotation.y=gameClock*2;crownGroup.children.forEach((c,i)=>{if(c.material)c.material.opacity=.7+Math.sin(gameClock*6+i)*.3});auraMesh.visible=true;auraMesh.position.copy(duckModel.position);auraMesh.position.y+=.5;auraMesh.material.opacity=.04+Math.sin(gameClock*3)*.02;auraMesh.rotation.y=gameClock*.5;const auraScale=duckModel.scale.x*1.5+Math.sin(gameClock*2)*.2;auraMesh.scale.setScalar(auraScale)}else{crownGroup.visible=false;auraMesh.visible=false}
updateStreak(dt);
if(invincible>0)invincible-=dt;
// 无敌显示：在上方护盾的位置显示无敌+剩余秒数（仅3秒）
const invHud=document.getElementById('invincible-hud');
const shieldHud=document.getElementById('shield-hud');
if(invincible>0){
    invHud.style.display='flex';
    shieldHud.style.display='none'; // 无敌时隐藏护盾，由无敌 HUD 接管该位置
    document.getElementById('inv-time').textContent=Math.ceil(Math.max(0,invincible));
}else{
    invHud.style.display='none';
    if(hasShield)shieldHud.style.display='flex'; // 恢复护盾显示
}
// 磁铁激活：吸引附近所有可收集道具（花/草/荷叶/血瓶/磁铁）向鸭子靠近，石头不吸引
if(magnetActive&&duckModel){const dp=duckModel.position;const mRange=getMagnetRange();let attracting=false;for(const it of items){if(it.coll||it.type==='rock')continue;const dx=dp.x-it.mesh.position.x,dz=dp.z-it.mesh.position.z;const d=Math.sqrt(dx*dx+dz*dz);if(d<mRange&&d>0.1){
// 吸引动画：越近吸力越强（指数加速）；道具轻微浮起+旋转，表现被磁场牵引
const t=1-d/mRange; // 0=远，1=近
const f=(0.5+t*t*8)*dt; // 近距离加速
it.mesh.position.x+=dx/d*f;it.mesh.position.z+=dz/d*f;
it.magT=Math.min(1,(it.magT||0)+dt*3);
attracting=true;
}}
// 有道具正被吸附时周期性播放轻微吸附声
_magnetSfxTimer-=dt;
if(attracting&&_magnetSfxTimer<=0){playSFX('pull');_magnetSfxTimer=.4}
}
updateMagnet(dt);
if(!duoIsGuest())spawnAround(duckModel.position.x,duckModel.position.z);checkHit()}

// 键盘（W/S 前后，A/D 左右，均相对相机视角）
if(!isMobile){addEventListener('keydown',e=>{switch(e.code){case'KeyW':case'ArrowUp':mv.f=true;break;case'KeyS':case'ArrowDown':mv.b=true;break;case'KeyA':case'ArrowLeft':mv.l=true;break;case'KeyD':case'ArrowRight':mv.r=true;break;case'KeyM':document.getElementById('music-btn').click();break}});
addEventListener('keyup',e=>{switch(e.code){case'KeyW':case'ArrowUp':mv.f=false;break;case'KeyS':case'ArrowDown':mv.b=false;break;case'KeyA':case'ArrowLeft':mv.l=false;break;case'KeyD':case'ArrowRight':mv.r=false;break}})}

// 摇杆（视角相对：推上=朝相机前方移动，推右=朝相机右方移动）
let joySensitivity=Math.max(.5,Math.min(1.5,Number(localStorage.getItem('duck_joy_sensitivity'))||1));
if(isMobile){const zone=document.getElementById('joy-zone'),base=document.getElementById('joy-base'),knob=document.getElementById('joy-knob');
let ja=false,jc={x:0,y:0};
zone.ontouchstart=e=>{e.preventDefault();e.stopPropagation();const t=e.touches[0];ja=true;
const rect=zone.getBoundingClientRect();
const bx=t.clientX-rect.left,by=t.clientY-rect.top;
base.style.display='block';
base.style.left=Math.max(0,Math.min(bx-65,rect.width-130))+'px';
base.style.top=Math.max(0,Math.min(by-65,rect.height-130))+'px';
jc={x:t.clientX,y:t.clientY};knob.style.left='50%';knob.style.top='50%'};
zone.ontouchmove=e=>{e.preventDefault();if(!ja)return;const t=e.touches[0],dx=t.clientX-jc.x,dy=t.clientY-jc.y,dist=Math.sqrt(dx*dx+dy*dy),max=65,cl=Math.min(dist,max),ang=Math.atan2(dy,dx);knob.style.left=`${50+(cl/max)*50*Math.cos(ang)}%`;knob.style.top=`${50+(cl/max)*50*Math.sin(ang)}%`;const dead=18;if(dist>dead){
// 摇杆方向转换为归一化分量（上=前进，右=右移）
const speedRatio=Math.min((dist-dead)/(max-dead),1);
mv.joyDx=dx/dist; // 右分量
mv.joyDy=-dy/dist; // 前分量（屏幕Y轴向下，取反）
mv._joySpeed=speedRatio*DUCK_MAX_SPEED*joySensitivity;
}else{mv.f=mv.b=mv.l=mv.r=false;mv.str=0;mv._joySpeed=0;mv.joyDx=0;mv.joyDy=0}};
const rst=()=>{ja=false;base.style.display='none';mv.f=mv.b=mv.l=mv.r=false;mv.str=0;mv._joySpeed=0;mv.joyDx=0;mv.joyDy=0};zone.ontouchend=rst;zone.ontouchcancel=rst}

// 动画
// ===== v2.0 生命 / 排行榜 / 漩涡 / 血瓶 / 随机事件 系统 =====
// ---- 生命系统 ----
let hearts=3;let MAX_HEARTS=5;let gameActive=false;playStartTime=Date.now(); // gameActive 由"开始冒险"按钮点击后置 true
// 本局运行统计（用于暂停界面展示 + 成就追踪）
let runStats={items:0,distance:0,startTime:0};
// updateHeartsUI 已迁移到 ui/hud.js
function screenFlash(){const f=document.getElementById('red-flash');if(!f)return;f.classList.add('show');setTimeout(()=>f.classList.remove('show'),40)}
let screenShakeT=0; // 无护盾受伤时的画面抖动剩余时长（护盾挡住/无敌不抖，借此区分）
function takeDamage(amount=1,sfx='hit'){
    if(!gameActive)return;
    if(invincible>0)return; // 无敌期间免伤（连胜只在触发后3秒内无敌）
    if(hasShield){hasShield=false;shieldTimer=0;document.getElementById('shield-hud').style.display='none';shieldMesh.visible=false;toast('<i class="fa-solid fa-shield-halved"></i> 护盾挡住了','s');playSFX('shieldbreak');invincible=.5;
    // 成就追踪：累计挡住伤害次数
    Achievements.updateStat('shieldBlocks',1);
    return}
    hearts=Math.max(0,hearts-amount);
    updateHeartsUI();
    toast('-'+amount+' <i class="fa-solid fa-heart"></i>','m');
    screenFlash();playSFX(sfx);invincible=.6;screenShakeT=.35;
    if(hearts<=0)gameOver();
}
function heal(amount=1){
    if(!gameActive)return;
    const before=hearts;hearts=Math.min(MAX_HEARTS,hearts+amount);updateHeartsUI();
    if(hearts>before){toast('+'+(hearts-before)+' <i class="fa-solid fa-heart"></i>','p');playSFX('collect');
        const beats=document.getElementById('hearts-hud').querySelectorAll('.hp');const b=beats[hearts-1];if(b){b.classList.add('beat');setTimeout(()=>b.classList.remove('beat'),450)}
    }else{toast('<i class="fa-solid fa-heart"></i> 生命已满','p')}
}

// ---- 治愈粒子特效 ----
const transientFx=[];
function spawnHeartParticles(pos){
    for(let i=0;i<10;i++){
        const m=new THREE.Mesh(new THREE.SphereGeometry(.07,6,6),new THREE.MeshBasicMaterial({color:0xff5577,transparent:true,opacity:.95,fog:false}));
        m.position.copy(pos);scene.add(m);
        const a=Math.random()*Math.PI*2,sp=1+Math.random()*1.8;
        transientFx.push({m,vx:Math.cos(a)*sp,vy:1.6+Math.random()*1.2,vz:Math.sin(a)*sp,life:.9,max:.9});
    }
}
// ---- 岩石粉碎特效：生成多个小多面体碎片向四周飞溅 ----
// 岩石/蛋糕碎裂粒子；palette 可选（十六进制颜色数组，缺省为岩石灰）
function spawnRockShatter(pos,scale,palette){
    const tint=.92+Math.random()*.16;
    const baseColor=new THREE.Color(0x8d8177).multiplyScalar(tint);
    const count=8+Math.floor(Math.random()*4);
    for(let i=0;i<count;i++){
        const sz=(.15+Math.random()*.2)*scale;
        const g=new THREE.DodecahedronGeometry(sz,0);
        const col=palette?new THREE.Color(palette[i%palette.length]).multiplyScalar(.9+Math.random()*.2):baseColor.clone();
        const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:col,roughness:.9,flatShading:true,transparent:true,opacity:1,fog:false}));
        m.position.copy(pos);m.position.y+=Math.random()*.1;
        m.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);
        m.castShadow=false;
        scene.add(m);
        const a=Math.random()*Math.PI*2,sp=2+Math.random()*2.5;
        const vy=2.5+Math.random()*1.5;
        transientFx.push({
            m,
            vx:Math.cos(a)*sp,vy:vy,vz:Math.sin(a)*sp,
            rx:(Math.random()-.5)*8,ry:(Math.random()-.5)*8,rz:(Math.random()-.5)*8, // 角速度
            life:1.2+Math.random()*.3,max:1.5,
            gravity:5,shatter:true
        });
    }
    // 中心冲击波（短暂闪光）
    const ring=new THREE.Mesh(
        new THREE.RingGeometry(.1*scale,.2*scale,16),
        new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.9,side:THREE.DoubleSide,fog:false})
    );
    ring.position.copy(pos);ring.position.y+=.05;ring.rotation.x=-Math.PI/2;
    scene.add(ring);
    transientFx.push({m:ring,ring:true,vx:0,vy:0,vz:0,life:.4,max:.4});
}
function updateTransientFx(dt){
    for(let i=transientFx.length-1;i>=0;i--){const f=transientFx[i];f.life-=dt;
        if(f.ring){
            // 冲击波环（碰撞/破碎用）：扩大 + 淡出
            const t=Math.max(0,f.life/f.max);
            const sc=1+(1-t)*4;
            f.m.scale.setScalar(sc);
            f.m.material.opacity=t*.9;
        }else if(f.wake){
            // 不规则涟漪环：延迟启动 + 慢扩散 + 缓淡出，每帧贴合浪面（抬高 0.08 防遮挡）
            const delay=f.wakeDelay||0;
            const elapsed=f.max-f.life;  // 已经过去的时间
            if(elapsed<delay){
                // 延迟期内：保持初始状态不可见
                f.m.material.opacity=0;
            }else{
                // 启动后：基于自身 life 比例扩散 + 淡出
                const realLife=f.life;          // 剩余寿命
                const realMax=f.max-delay;      // 真实最大寿命
                const t=Math.max(0,realLife/realMax);  // 1=刚启动，0=消亡
                const sc=1+(1-t)*1.8;           // 扩散幅度 1→2.8 倍
                f.m.scale.setScalar(sc);
                // 入场快（前 10% 时间从 0 涨到 baseOpacity），主体缓淡出
                const fadeIn=Math.min(1,elapsed/0.08);
                f.m.material.opacity=f.baseOpacity*t*fadeIn;
                f.m.position.y=waveHeight(f.m.position.x,f.m.position.z,renderedWaveClock)+.08;
            }
        }else{
            // 通用粒子（含鸭子水珠尾迹、尾部水花、碎片等）：抛物线运动 + 重力 + 淡出
            f.m.position.x+=f.vx*dt;f.m.position.y+=f.vy*dt;f.m.position.z+=f.vz*dt;
            f.vy-=(f.gravity||3.2)*dt;
            // 旋转
            if(f.rx!==undefined)f.m.rotation.x+=f.rx*dt;
            if(f.ry!==undefined)f.m.rotation.y+=f.ry*dt;
            if(f.rz!==undefined)f.m.rotation.z+=f.rz*dt;
            const t=Math.max(0,f.life/f.max);
            f.m.material.opacity=f.shatter?Math.min(1,t*1.5):t*.95;
            f.m.scale.setScalar(Math.max(.1,t));
        }
        if(f.life<=0){scene.remove(f.m);transientFx.splice(i,1)}
    }
}

const Duo={
    active:false,role:null,room:null,remoteState:null,_apiURL:null,_pollTimer:null,_stateTimer:null,_statePending:false,_started:false,_down:false,_teamDefeated:false,_respawnTicker:null,_nameSyncTimer:null,_name:'',
    get API_URLS(){const base=location.protocol+'//'+location.hostname+':8123/api/duo';return [...new Set([base,location.origin+'/api/duo','/api/duo'])]},
    get playerId(){return Leaderboard.getUserId()},
    get name(){return (document.getElementById('duo-name').value||this._name||'').trim().slice(0,12)},
    get me(){return this.role==='host'?this.room?.host:this.room?.guest},
    get other(){return this.role==='host'?this.room?.guest:this.room?.host},
    async request(action,payload={}){
        const urls=this._apiURL?[this._apiURL,...this.API_URLS.filter(url=>url!==this._apiURL)]:this.API_URLS;
        let lastError=null;
        for(const url of urls){
            try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,playerId:this.playerId,name:this.name,role:this.role,...payload})});
                const data=await response.json();
                if(response.ok&&data.ok){this._apiURL=url;return data}
                if(data?.error)throw new Error(data.error);
            }catch(error){lastError=error}
        }
        throw lastError||new Error('SERVER_UNAVAILABLE');
    },
    activate(result){this.active=true;this.role=result.role;this.applyRoom(result.room);this.startPolling()},
    showRespawn(downAt){
        const overlay=document.getElementById('duo-respawn'),time=document.getElementById('duo-respawn-time');
        const refresh=()=>{const left=Math.max(0,Math.ceil((10000-(Date.now()-(downAt||Date.now())))/1000));time.textContent=left||'…'};
        clearInterval(this._respawnTicker);refresh();this._respawnTicker=setInterval(refresh,250);overlay.classList.add('show');
    },
    hideRespawn(){clearInterval(this._respawnTicker);this._respawnTicker=null;document.getElementById('duo-respawn').classList.remove('show')},
    finishRespawn(state){
        this._down=false;this.hideRespawn();
        if(!duckModel||!state)return;
        duckSink.state='none';sinkFx=0;duckVel.set(0,0,0);duckModel.visible=true;
        duckModel.position.set(state.x,waveHeight(state.x,state.z,renderedWaveClock)-.08,state.z);duckModel.rotation.y=state.ry||0;
        hearts=1;updateHeartsUI();gameActive=true;isPaused=false;
        clearInterval(this._stateTimer);this._stateTimer=setInterval(()=>this.sync(),180);this.sync();
        toast('<i class="fa-solid fa-heart-pulse"></i> 伙伴救援成功，保留 1 颗心','s');
    },
    applyRoom(room){
        if(!room)return;
        const wasDown=this._down,previousRound=this.room?.round,startsNewRound=previousRound!=null&&room.round!==previousRound;this.room=room;
        if(startsNewRound&&room.status==='running'){
            this._started=false;this._down=false;this._teamDefeated=false;resetRunState();
        }
        const mine=this.me,other=this.other;
        if(room.blessing&&(Blessings.current?.id!==room.blessing.id||Blessings.current?.mult!==room.blessing.mult))applyDuoBlessing(room.blessing);
        this.remoteState=other?.state||null;duoRemoteTarget=other?{...other.state,down:other.down}:null;
        // guest 应用 host 的场景快照（时钟/事件/物品）
        if(this.role==='guest'&&other?.state?.scene&&gameActive)duoApplyScene(other.state.scene);
    // 记录对端状态到达时间：用于远程鸭子航迹外推（Dead Reckoning）与遥控端瞬移判定
    if(other?.state){
        const st=other.state;
        duoRemotePrevSnap={x:duoRemotePrevTarget?duoRemotePrevTarget.x:st.x,z:duoRemotePrevTarget?duoRemotePrevTarget.z:st.z,t:duoRemotePrevSnapT||0};
        duoRemotePrevSnapT=performance.now();
        duoRemotePrevTarget={x:st.x,z:st.z,ry:st.ry||0};
    }
        const status=document.getElementById('duo-status'),roomMeta=document.getElementById('duo-room-meta'),actions=document.getElementById('duo-actions'),error=document.getElementById('duo-error');error.textContent='';
        actions.style.display=this.active?'none':'block';status.classList.toggle('show',this.active);
        status.classList.toggle('copy-action',this.active&&room.status==='waiting');
        roomMeta.classList.toggle('show',this.active&&room.status==='waiting');
        if(!this.active)return;
        const friendName=other?.name||'好友';
        if(room.status==='waiting'){roomMeta.innerHTML=`<div class="room-label">房间号</div><div class="duo-code">${room.code}</div><div class="duo-copy-row"><button class="duo-copy-btn primary" onclick="copyDuoInvite()"><i class="fa-solid fa-link"></i> 复制邀请链接</button><button class="duo-copy-btn" onclick="copyDuoCode()"><i class="fa-solid fa-hashtag"></i> 复制房间号</button></div>`;status.innerHTML='';}
        else if(room.status==='ready'&&this.role==='host')status.innerHTML=`${escapeHtml(friendName)} 已加入<br><button class="duo-btn primary" onclick="startDuoRoom()">开始对局</button>`;
        else if(room.status==='ready')status.textContent='已加入房间，等待房主开始。';
        else if(room.status==='running')status.textContent=mine?.down?'等待伙伴救援…':'对局开始，正在进入海面…';
        else if(room.status==='finished')status.textContent='双人战绩已计入双人排行榜。';
        document.getElementById('duo-hud').classList.remove('show');
        if(other&&gameActive&&!duoRemoteDuck)createDuoRemoteDuck(friendName,other.state);
        if(other?.name&&duoRemoteDuck)setDuoRemoteNameLabel(other.name);
        if(mine?.name&&duoLocalNameLabel?.userData?.duoName!==mine.name)setDuoLocalNameLabel(mine.name);
        if(other?.state?.skin&&duoRemoteDuck){
            let newSkin=other.state.skin;
            // 自定义皮肤必须带有效 palette（body/beak 均为合法 hex），否则降级为 classic，避免出现空白/黑色贴图或误用本地 palette
            let newPal=newSkin==='custom'?other.state.palette:null;
            if(newSkin==='custom'&&( !newPal || typeof newPal!=='object' || !/^#[0-9a-fA-F]{6}$/.test(newPal.body||'') || !/^#[0-9a-fA-F]{6}$/.test(newPal.beak||'') )){newSkin='classic';newPal=null}
            const palChanged=duoRemoteSkin!==newSkin||(newSkin==='custom'&&JSON.stringify(duoRemotePalette)!==JSON.stringify(newPal));
            if(palChanged){duoRemoteSkin=newSkin;duoRemotePalette=newPal;applyDuckSkinToRoot(duoRemoteDuck,newSkin,newPal)}
        }
        if(room.status==='finished'&&wasDown&&!this._teamDefeated){this._teamDefeated=true;this._down=false;this.hideRespawn();finishGameOver(true)}
        else if(mine?.down){this._down=true;if(duckModel)duckModel.visible=false;this.showRespawn(mine.downAt)}
        else if(wasDown)this.finishRespawn(mine?.state);
        if(room.status==='running'&&!gameActive&&!this._started&&!this._down){closeDuoModal();startGameSession()}
        if(room.status==='finished'){Leaderboard.loaded=false;Leaderboard.load().catch(()=>{})}
    },
    startPolling(){clearInterval(this._pollTimer);this._pollTimer=setInterval(()=>this.poll(),250)},
    async poll(){if(!this.active||!this.room)return;try{const result=await this.request('status',{room:this.room.code});this.applyRoom(result.room)}catch(error){}},
    queueNameSync(name){
        const next=String(name||'').trim().slice(0,12);if(!next)return;
        this._name=next;Leaderboard.setCachedName(next);clearTimeout(this._nameSyncTimer);
        if(!this.active||!this.room)return;
        this._nameSyncTimer=setTimeout(async()=>{try{const result=await this.request('status',{room:this.room.code});this.applyRoom(result.room)}catch(error){}},150);
    },
    beginGame(){
        if(this._started)return;
        this._started=true;const other=this.other;
        if(other)createDuoRemoteDuck(other.name,other.state);setDuoLocalNameLabel(this.me?.name||this.name);
        clearInterval(this._stateTimer);this._stateTimer=setInterval(()=>this.sync(),180);this.sync();
    },
    async sync(){
        if(!this.active||!this.room||!gameActive||this._down||this._statePending||!duckModel)return;
        this._statePending=true;
        try{const st={x:duckModel.position.x,y:duckModel.position.y,z:duckModel.position.z,ry:duckModel.rotation.y,score,hearts,skin:activeDuckSkin,
            sh:hasShield?shieldTimer:0,mt:magnetActive?magnetTimer:0,bt:bigTimer>0?bigTimer:0,iv:invincible>0?invincible:0,sk:streakActive?streakTimer:0};
        if(activeDuckSkin==='custom')st.palette=getDuckCustomPalette();
        if(this.role==='host')st.scene=duoSerializeScene();
        const result=await this.request('state',{room:this.room.code,state:st});this.applyRoom(result.room)}catch(error){}finally{this._statePending=false}
    },
    async down(){
        if(!this.active||!this.room||!duckModel)return false;
        const st={x:duckModel.position.x,y:duckModel.position.y,z:duckModel.position.z,ry:duckModel.rotation.y,score,hearts,skin:activeDuckSkin,
            sh:hasShield?shieldTimer:0,mt:magnetActive?magnetTimer:0,bt:bigTimer>0?bigTimer:0,iv:invincible>0?invincible:0,sk:streakActive?streakTimer:0};
        if(activeDuckSkin==='custom')st.palette=getDuckCustomPalette();
        const result=await this.request('down',{room:this.room.code,state:st});
        this.applyRoom(result.room);
        if(this.me?.down){gameActive=false;clearInterval(this._stateTimer);return true}
        return false;
    },
    async finish(finalScore,playTime){
        if(!this.active||!this.room)return;
        clearInterval(this._stateTimer);
        try{const result=await this.request('finish',{room:this.room.code,score:finalScore,playTime});this.applyRoom(result.room);if(result.room.status!=='finished')toast('<i class="fa-solid fa-user-group"></i> 等待好友完成对局','s')}catch(error){toast('双人战绩同步失败','m')}
    },
    async create(name){this._name=name;const result=await this.request('create',{blessing:Blessings.current});this.activate(result);this.syncProfile()},
    async join(code,name){this._name=name;const result=await this.request('join',{room:code});this.activate(result);this.syncProfile()},
    // 大厅阶段同步皮肤/调色板，确保开局前对方就能看到自定义皮肤
    async syncProfile(){
        if(!this.active||!this.room)return;
        try{const profile={skin:activeDuckSkin};if(activeDuckSkin==='custom')profile.palette=getDuckCustomPalette();const result=await this.request('profile',{room:this.room.code,skin:profile.skin,palette:profile.palette});this.applyRoom(result.room)}catch(error){}
    },
    async start(){const result=await this.request('start',{room:this.room.code});this.applyRoom(result.room);closeDuoModal();startGameSession()},
    async restart(){if(this.role!=='host')throw new Error('ONLY_HOST_CAN_RESTART');const result=await this.request('restart',{room:this.room.code});this._started=false;this.applyRoom(result.room)},
    reset(){clearInterval(this._pollTimer);clearInterval(this._stateTimer);clearTimeout(this._nameSyncTimer);this.hideRespawn();this.active=false;this.room=null;this.remoteState=null;this._started=false;this._down=false;this._teamDefeated=false;this._name='';if(duckModel)duckModel.visible=true;removeDuoRemoteDuck();document.getElementById('duo-hud').classList.remove('show')}
};
window.openDuoModal=function(){
    hideModeEntry();
    const code=(new URLSearchParams(location.search).get('duo')||'').replace(/\D/g,'').slice(0,6);
    document.getElementById('duo-name').value=Leaderboard.getCachedName()||'';
    document.getElementById('duo-code').value=code;
    document.getElementById('duo-error').textContent='';
    document.getElementById('duo-actions').style.display=Duo.active?'none':'block';
    document.getElementById('duo-status').classList.toggle('show',Duo.active);
    document.getElementById('duo-room-meta').classList.toggle('show',Duo.active&&Duo.room?.status==='waiting');
    document.getElementById('duo-modal').classList.add('show');
    if(Duo.active)Duo.applyRoom(Duo.room);
};
window.closeDuoModal=function(){if(!gameActive){if(Duo.active&&Duo.room?.status!=='running')Duo.reset();document.getElementById('duo-modal').classList.remove('show');showModeEntry()}};
function requireDuoName(){const input=document.getElementById('duo-name'),name=(input.value||'').trim().slice(0,12);if(name)return name;document.getElementById('duo-error').textContent='请先输入昵称，再创建或加入房间。';input.focus();return null}
window.createDuoRoom=async function(){const name=requireDuoName();if(!name)return;try{Leaderboard.setCachedName(name);await Duo.create(name)}catch(error){const messages={NAME_REQUIRED:'请先输入昵称。'};document.getElementById('duo-error').textContent=messages[error.message]||'无法创建房间，请确认 Node 服务已启动。'}};
window.joinDuoRoom=async function(){const name=requireDuoName();if(!name)return;const code=(document.getElementById('duo-code').value||'').replace(/\D/g,'').slice(0,6);if(code.length!==6){document.getElementById('duo-error').textContent='请输入 6 位数字房间号。';return}try{Leaderboard.setCachedName(name);await Duo.join(code,name)}catch(error){const messages={ROOM_NOT_FOUND:'未找到该房间。',ROOM_FULL:'房间已满。',NAME_REQUIRED:'请先输入昵称。'};document.getElementById('duo-error').textContent=messages[error.message]||'无法加入房间，请稍后重试。'}};
document.getElementById('duo-name').addEventListener('input',event=>Duo.queueNameSync(event.target.value));
window.copyDuoInvite=async function(){if(!Duo.room)return;const link=location.origin+location.pathname+'?duo='+Duo.room.code;try{await navigator.clipboard.writeText(link);toast('<i class="fa-solid fa-link"></i> 邀请链接已复制','s')}catch(error){document.getElementById('duo-error').textContent='复制失败，请手动复制链接：'+link}};
window.copyDuoCode=async function(){if(!Duo.room)return;try{await navigator.clipboard.writeText(Duo.room.code);toast('<i class="fa-solid fa-hashtag"></i> 房间号 '+Duo.room.code+' 已复制','s')}catch(error){document.getElementById('duo-error').textContent='复制失败，请手动记下房间号 '+Duo.room.code}};
window.startDuoRoom=()=>Duo.start().catch(error=>{document.getElementById('duo-error').textContent='暂时无法开始，请确认好友仍在房间内。'});
let lastEntry=null;
let pendingScore=0,pendingPlayTime=0;  // 待提交的分数（供 confirmName 重试重名时使用）
function renderLeaderboard(data){
    const list=document.getElementById('lb-list');
    if(!data.entries.length){list.innerHTML='<div class="lb-empty">暂无记录，成为第一名吧！</div>';return}
    list.innerHTML=data.entries.slice(0,20).map((e,i)=>{
        const me=lastEntry&&e.id===lastEntry.id?'me':'';const top=i<3?'top'+(i+1):'';
        return `<div class="lb-item ${top} ${me}"><span class="rk">${i+1}</span><span class="nm">${escapeHtml(e.name)}</span><span class="sc">${formatScore(e.score)}</span></div>`
    }).join('');
}
async function showGameOver(data, nameConflict, conflictedName, pwdWrong, isFirstTime, submittedName){
    const go=document.getElementById('gameover');
    document.getElementById('go-score').textContent=formatScore(score);
    try{await Leaderboard.load()}catch(e){}
    const latestData=Leaderboard.get();
    const myBestScore=Leaderboard.myBest();
    document.getElementById('go-best').textContent='我的最高分：'+formatScore(myBestScore);
    const cachedName=Leaderboard.getCachedName();
    const nameRow=document.querySelector('#go-name-wrap .go-name-row');
    const nameInput=document.getElementById('go-name');
    const nameWrap=document.getElementById('go-name-wrap');
    const duoResult=!!(Duo.active&&Duo.room);
    const duoNames=duoResult?[Duo.room.host?.name,Duo.room.guest?.name].filter(Boolean):[];
    document.getElementById('go-mode').textContent=duoResult?`双人同行 · ${duoNames.join(' 与 ')||'双人队伍'}`:`单人模式 · ${cachedName||submittedName||'勇敢鸭鸭'}`;
    if(duoResult){
        if(nameRow)nameRow.style.display='none';
        if(nameWrap)nameWrap.style.display='none';
    }else if(nameConflict){
        if(nameWrap)nameWrap.style.display='flex';
        if(nameRow)nameRow.style.display='flex';
        nameInput.value=conflictedName||'';
        if(pwdWrong){
            // 有密码保护 → 打开密码验证弹窗
            nameInput.placeholder='该昵称有密码保护';
            if(nameWrap)nameWrap.querySelector('.greeting').innerHTML='<i class="fa-solid fa-lock" style="color:#ffaa00"></i> 昵称"'+escapeHtml(conflictedName||'')+'"有密码保护';
            openPwdModal('verify',conflictedName);
        }else{
            nameInput.placeholder='昵称已被使用';
            if(nameWrap)nameWrap.querySelector('.greeting').innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#ff6b6b"></i> 昵称"'+escapeHtml(conflictedName||'')+'"已被使用';
            nameInput.focus();
        }
    }else if(cachedName){
        if(nameWrap)nameWrap.style.display='flex';
        if(nameRow)nameRow.style.display='none';
        if(nameWrap)nameWrap.querySelector('.greeting').innerHTML='欢迎回来，'+escapeHtml(cachedName)+'！ <button onclick="openPwdModal(\'set\',\''+escapeHtml(cachedName)+'\')" style="margin-left:8px;padding:2px 10px;border-radius:6px;border:1px solid rgba(143,224,255,.4);background:rgba(143,224,255,.1);color:#8fe0ff;font-size:11px;cursor:pointer"><i class="fa-solid fa-lock"></i> 设置密码</button>';
    }else{
        if(nameWrap)nameWrap.style.display='flex';
        // 首次游戏：显示输入框，填入已提交的名字，让用户可改名
        if(nameRow)nameRow.style.display='flex';
        nameInput.value=submittedName||genDefaultName();
        nameInput.placeholder='请输入昵称';
        if(nameWrap)nameWrap.querySelector('.greeting').textContent='首次游戏，请输入昵称';
    }
    renderLeaderboard(latestData);
    go.classList.add('show');
}
// 密码弹窗状态：mode='verify'(验证密码) | 'set'(设置密码)
let _pwdModalMode='set',_pwdModalName='';
window.openPwdModal=function(mode,name){
    _pwdModalMode=mode;_pwdModalName=name||'';
    const modal=document.getElementById('pwd-modal');
    const input1=document.getElementById('pwd-input');
    const input2=document.getElementById('pwd-input2');
    const desc=document.getElementById('pwd-modal-desc');
    const err=document.getElementById('pwd-error');
    const okBtn=document.getElementById('pwd-ok-btn');
    err.style.display='none';
    input1.value='';input2.value='';
    if(mode==='verify'){
        desc.textContent='昵称"'+_pwdModalName+'"有密码保护，请校验密码';
        input1.placeholder='校验密码';
        input2.style.display='none';
        okBtn.textContent='校验';
    }else{
        desc.innerHTML='为昵称"'+_pwdModalName+'"设置密码<br><span style="color:#888;font-size:11px">（可选，防止他人冒用）</span>';
        input1.placeholder='输入密码';
        input2.placeholder='再次输入密码';
        input2.style.display='block';
        okBtn.textContent='确认';
    }
    modal.style.display='flex';
    input1.focus();
    // 回车绑定确认/校验按钮
    input1.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();if(mode==='set'&&input2.style.display!=='none'){input2.focus();}else{confirmPwdModal();}}};
    input2.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();confirmPwdModal();}};
}
window.closePwdModal=function(){
    document.getElementById('pwd-modal').style.display='none';
};
// 密码弹窗确认按钮
window.confirmPwdModal=async function(){
    const input1=document.getElementById('pwd-input');
    const input2=document.getElementById('pwd-input2');
    const err=document.getElementById('pwd-error');
    const pwd=input1.value;
    if(!pwd){err.textContent='请输入密码';err.style.display='block';return}
    if(_pwdModalMode==='set'){
        if(pwd!==input2.value){err.textContent='两次密码不一致';err.style.display='block';return}
        if(pwd.length<4){err.textContent='密码至少4位';err.style.display='block';return}
    }
    if(_pwdModalMode==='verify'){
        // 校验密码：不清空输入框，保持弹窗，让用户修改后重新提交
        const r=await Leaderboard.submit(pendingScore,pendingPlayTime,_pwdModalName,pwd);
        if(r.nameConflict){
            err.textContent='密码错误，请重新输入';
            err.style.display='block';
            input1.value='';
            input1.focus();
            return;
        }
        // 校验成功
        closePwdModal();
        Leaderboard.setCachedName(_pwdModalName);
        lastEntry=r.entry;
        renderLeaderboard(r.data);
        document.getElementById('go-best').textContent='我的最高分：'+formatScore(Leaderboard.myBest());
        const nameRow=document.querySelector('#go-name-wrap .go-name-row');
        const nameWrap=document.getElementById('go-name-wrap');
        if(nameRow)nameRow.style.display='none';
        const pwdName=escapeHtml(_pwdModalName);
        if(nameWrap)nameWrap.querySelector('.greeting').innerHTML=`欢迎回来，${pwdName}！ <button onclick="openPwdModal('set','${pwdName}')" style="margin-left:8px;padding:2px 10px;border-radius:6px;border:1px solid rgba(143,224,255,.4);background:rgba(143,224,255,.1);color:#8fe0ff;font-size:11px;cursor:pointer"><i class="fa-solid fa-lock"></i> 设置密码</button>`;
        toast('<i class="fa-solid fa-check"></i> 密码验证成功','p');
    }else{
        // 设置密码
        closePwdModal();
        const cachedName=Leaderboard.getCachedName();
        if(!cachedName){toast('请先确定昵称','m');return}
        const r=await Leaderboard.submit(pendingScore,pendingPlayTime,cachedName,pwd);
        if(!r.nameConflict){
            toast('<i class="fa-solid fa-lock"></i> 密码已设置','p');
        }
    }
};
// 昵称确定按钮：保存昵称到缓存并重新提交（处理重名冲突或首次输入）
window.confirmName=async function(){
    const v=(document.getElementById('go-name').value||'').trim();
    if(!v){toast('请输入昵称','m');return}
    // 用全局 pendingScore/pendingPlayTime 重新 submit（submit 会做重名检测）
    const r=await Leaderboard.submit(pendingScore,pendingPlayTime,v);
    if(r.nameConflict){
        // 仍重名：提示并保留输入框，等用户再改名
        const nameInput=document.getElementById('go-name');
        const nameWrap=document.getElementById('go-name-wrap');
        if(r.pwdWrong){
            // 有密码保护 → 打开密码验证弹窗（可多次尝试）
            toast('"'+v+'"有密码保护','m');
            if(nameWrap)nameWrap.querySelector('.greeting').innerHTML='<i class="fa-solid fa-lock" style="color:#ffaa00"></i> 昵称"'+escapeHtml(v)+'"有密码保护';
            openPwdModal('verify',v);
        }else{
            toast('"'+v+'"已被使用','m');
            nameInput.value='';
            nameInput.placeholder='昵称已被使用';
            if(nameWrap)nameWrap.querySelector('.greeting').innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#ff6b6b"></i> 昵称"'+escapeHtml(v)+'"已被使用';
            nameInput.focus();
        }
        return;
    }
    // 成功：缓存昵称 + 刷新排行榜 + 隐藏输入框
    Leaderboard.setCachedName(v);
    lastEntry=r.entry;
    renderLeaderboard(r.data);
    document.getElementById('go-best').textContent='我的最高分：'+formatScore(Leaderboard.myBest());
    const nameRow=document.querySelector('#go-name-wrap .go-name-row');
    const nameWrap=document.getElementById('go-name-wrap');
    if(nameRow)nameRow.style.display='none';
    if(nameWrap)nameWrap.querySelector('.greeting').innerHTML='欢迎回来，'+escapeHtml(v)+'！ <button onclick="openPwdModal(\'set\',\''+escapeHtml(v)+'\')" style="margin-left:8px;padding:2px 10px;border-radius:6px;border:1px solid rgba(143,224,255,.4);background:rgba(143,224,255,.1);color:#8fe0ff;font-size:11px;cursor:pointer"><i class="fa-solid fa-lock"></i> 设置密码</button>';
    toast('<i class="fa-solid fa-check"></i> 昵称已保存','p');
};
async function gameOver(){
    if(!gameActive)return;
    if(Duo.active&&Duo.room?.status==='running'&&!Duo._teamDefeated){
        try{if(await Duo.down())return}catch(error){toast('救援状态同步失败，按普通结算处理','m')}
    }
    return finishGameOver();
}
async function finishGameOver(skipDuoFinish=false){
    if(!gameActive&&!skipDuoFinish)return;
    gameActive=false;
    FestivalFx.stop();
    playSFX('die');
    const pt=Math.floor((Date.now()-playStartTime)/1000);
    pendingScore=score;pendingPlayTime=pt;if(Duo.active&&!skipDuoFinish)Duo.finish(pendingScore,pendingPlayTime);
    // 成就追踪：单局最高分 / 单局最长存活时间
    Achievements.setStat('highScore',score);
    Achievements.setStat('playTime',pt);
    // 检查"小黄鸭大师"成就：是否已解锁所有其他成就
    const otherUnlocked=Achievements.defs.filter(d=>d.id!=='duck_master').every(d=>Achievements.unlocked[d.id]);
    if(otherUnlocked)Achievements.updateStat('achievements',1);
    Achievements.save();
    try{await Leaderboard.load()}catch(e){console.warn('等待排行榜加载失败',e)}
    let cachedName=Leaderboard.getCachedName();
    if(cachedName){
        // 老用户：直接提交分数
        try{
            const r=await Leaderboard.submit(pendingScore,pendingPlayTime,cachedName);
            lastEntry=r.entry;
            showGameOver(r.data, r.nameConflict, r.conflictedName, r.pwdWrong, false, cachedName);
        }catch(e){
            showGameOver(Leaderboard.get(), false, null, false, false, cachedName);
        }
    }else{
        // 首次用户：不提交，等确认昵称
        showGameOver(Leaderboard.get(), false, null, false, true, genDefaultName());
    }
}

// ---- 分享卡片（已迁移到 js/ui/share-card.js） ----
// 挂载到 window（script type=module 中函数不在全局作用域，需要显式挂载以支持 onclick）
window.showShareModal=showShareModal;
window.downloadShareCard=downloadShareCard;
window.closeShareModal=closeShareModal;
window.showDetailModal=showDetailModal;
// 注入分享卡依赖（Leaderboard/Duo/toast 均为 const 或函数声明，引用稳定）
setShareCardCtx({Leaderboard,Duo,toast});

// ---- 加心道具：红色爱心血瓶 ----
function mkHeart(x,z){
    const g=new THREE.Group();
    const shape=new THREE.Shape();
    shape.moveTo(0,0.3);
    shape.bezierCurveTo(0,0.45,-0.2,0.65,-0.45,0.65);
    shape.bezierCurveTo(-0.8,0.65,-0.8,0.2,-0.8,0.2);
    shape.bezierCurveTo(-0.8,-0.1,-0.4,-0.35,0,-0.7);
    shape.bezierCurveTo(0.4,-0.35,0.8,-0.1,0.8,0.2);
    shape.bezierCurveTo(0.8,0.2,0.8,0.65,0.45,0.65);
    shape.bezierCurveTo(0.2,0.65,0,0.45,0,0.3);
    const geo=new THREE.ExtrudeGeometry(shape,{depth:0.14,bevelEnabled:true,bevelThickness:0.4,bevelSize:0.34,bevelSegments:14,steps:1,curveSegments:40});
    geo.center();
    const glass=new THREE.MeshPhysicalMaterial({color:0xff2d55,roughness:.12,metalness:0,transmission:.35,transparent:true,opacity:.95,thickness:.6,clearcoat:1,clearcoatRoughness:.08,emissive:0xd11133,emissiveIntensity:.55,side:THREE.DoubleSide});
    const heart=new THREE.Mesh(geo,glass);heart.castShadow=true;g.add(heart);
    // 白色回血十字（血瓶标识，正反面）
    const crossMat=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xff9aac,emissiveIntensity:.5,roughness:.4});
    for(const zz of[0.42,-0.42]){
        const cv=new THREE.Mesh(new THREE.BoxGeometry(.13,.4,.05),crossMat);cv.position.set(0,.02,zz);g.add(cv);
        const ch=new THREE.Mesh(new THREE.BoxGeometry(.4,.13,.05),crossMat);ch.position.set(0,.02,zz);g.add(ch);
    }
    // 瓶塞（软木色，插在爱心顶部凹口，营造"血瓶"感）
    const cork=new THREE.Mesh(new THREE.CylinderGeometry(.15,.19,.28,16),new THREE.MeshStandardMaterial({color:0xc79a5b,roughness:.85}));cork.position.set(0,.72,0);cork.castShadow=true;g.add(cork);
    // 微光
    const glow=new THREE.PointLight(0xff3355,.9,4);glow.position.set(0,0,0);g.add(glow);
    g.scale.setScalar(.42);
    g.position.set(x,0,z);
    return g;
}
let heartTimer=8;
function spawnHeart(){
    if(!duckModel)return;
    const ang=Math.random()*Math.PI*2,dist=8+Math.random()*16;
    const x=duckModel.position.x+Math.cos(ang)*dist,z=duckModel.position.z+Math.sin(ang)*dist;
    const mesh=mkHeart(x,z);scene.add(mesh);
    items.push({mesh,type:'heart',r:.6,coll:false});
}
function trySpawnHeart(dt){
    if(!gameActive||!duckModel)return;
    // duo guest：爱心刷新由房主场景同步负责
    if(duoIsGuest())return;
    heartTimer-=dt;
    if(heartTimer>0)return;
    heartTimer=8+Math.random()*7;
    if(hearts>=MAX_HEARTS)return;
    const present=items.filter(i=>i.type==='heart'&&!i.coll).length;
    const cap=hearts<=1?3:2;
    if(present>=cap)return;
    // 基础45%，生命≤1时仁慈提升到75%（刷新更密集）
    if(Math.random()<(hearts<=1?0.75:0.45))spawnHeart();
}

// ---- 漩涡系统 ----
const whirlpools=[];
// 漩涡水流贴图（对角流纹 → 包在漏斗上呈螺旋状）
const whirlWaterTex=mkTex(512,256,(x)=>{
    x.fillStyle='#0c4a72';x.fillRect(0,0,512,256);
    for(let i=0;i<16;i++){const x0=i*32;
        x.strokeStyle='rgba(90,170,215,'+(.12+(i%3)*.05)+')';x.lineWidth=6+(i%4)*3;
        for(const ox of[-512,0,512]){x.beginPath();x.moveTo(x0+ox,0);x.bezierCurveTo(x0+ox+30,80,x0+ox-20,160,x0+ox+24,256);x.stroke()}}
});
whirlWaterTex.wrapS=whirlWaterTex.wrapT=THREE.RepeatWrapping;
// 漩涡泡沫螺旋贴图（斜向泡沫弧 → 螺旋手臂）
const whirlFoamTex=mkTex(512,256,(x)=>{
    x.clearRect(0,0,512,256);
    x.lineCap='round';
    for(let k=0;k<10;k++){const x0=k*56;
        for(const oy of[-256,0,256]){
            const g=x.createLinearGradient(x0,256+oy,x0+120,oy);
            g.addColorStop(0,'rgba(240,252,255,0)');g.addColorStop(.4,'rgba(240,252,255,.95)');g.addColorStop(1,'rgba(240,252,255,0)');
            x.strokeStyle=g;x.lineWidth=8+(k%3)*4;
            x.beginPath();x.moveTo(x0,256+oy);x.quadraticCurveTo(x0+80,128+oy,x0+120,oy);x.stroke();
        }
    }
    // 同心泡沫环碎片
    x.strokeStyle='rgba(230,248,255,.5)';x.lineWidth=5;
    for(let r=0;r<5;r++){const y=20+r*52;for(let s=0;s<6;s++){const x0=s*90+(r%2)*40;
        x.beginPath();x.moveTo(x0,y);x.lineTo(x0+34,y);x.stroke()}}
});
whirlFoamTex.wrapS=whirlFoamTex.wrapT=THREE.RepeatWrapping;
// 中心暗洞贴图
const whirlCoreTex=mkTex(128,128,(x)=>{const g=x.createRadialGradient(64,64,4,64,64,64);
    g.addColorStop(0,'rgba(1,8,16,1)');g.addColorStop(.7,'rgba(3,18,30,.95)');g.addColorStop(1,'rgba(4,24,38,0)');
    x.fillStyle=g;x.fillRect(0,0,128,128)});
function mkWhirlpool(x,z,fixedScale){
    const g=new THREE.Group();
    const rTop=3.0,depth=2.4;
    // 元宵：不再是漏斗漩涡，改为"祈福灯笼群"（温和暖光，无吸入感）。
    // 视觉重构：移除暗洞/水流漏斗/浪花环这些"危险"元素，换成 3 盏漂浮上升的纸灯笼 + 底部一圈暖光涟漪。
    // 引力判定保留（whirlZones）→ 玩家进入会被"送回岸边"（updateDuckSink 已有灯笼特判：无扣心，仅传送）。
    const isLantern=isFestival('festival_lantern');
    let disk=null,foam=null,core=null,rim=null,field=null,lantern=null;
    // 随机大小：1/1.5/2/2.5/3 倍（0.5 档位）；双人模式客机使用房主同步的固定缩放
    const wm=fixedScale||(1+Math.floor(Math.random()*5)*.5);
    if(isLantern){
        // 底部暖光涟漪（引力提示圈，贴浪面），暖金色，比蓝色更温和
        field=mkWaveRing(1,72,new THREE.MeshBasicMaterial({color:0xffaa55,transparent:true,opacity:.3,depthWrite:false,fog:false,side:THREE.DoubleSide}),1);
        field.renderOrder=4;scene.add(field);
        // 3 盏祈福灯笼漂浮在区域内（环状分布，缓慢升降旋转）
        const cluster=new THREE.Group();
        for(let i=0;i<3;i++){
            const L=mkWhirlLantern();
            const a=i*(Math.PI*2/3);
            L.userData={ph:a,r:1.1*wm*.6,baseY:.9+i*.35};
            L.position.set(Math.cos(a)*1.1*wm*.6,0,Math.sin(a)*1.1*wm*.6);
            cluster.add(L);
        }
        cluster.position.set(x,0,z);
        scene.add(cluster);
        lantern=cluster; // 复用 w.lantern 字段，整组灯笼交给 updateWhirlpools 驱动
        g.scale.setScalar(wm);g.position.set(x,0,z); // g 仅作逻辑载体（不可见，无子网格）
        const zone={x,z,r:rTop*wm,depth};whirlZones.push(zone);
        field.userData.update(x,z,4.6*wm,5*wm,.20);
        return{group:g,disk:null,foam:null,core:null,rim:null,field,zone,life:9+Math.random()*4,x,z,scale:wm,depth,lantern,isLanternFx:true};
    }
    // ---- 常规漩涡（漏斗 + 浪花 + 暗洞） ----
    // 各层贴图在世界空间有序抬高（见 updateWhirlpools），高于浪面漏斗处最大插值偏差，
    // 保证漩涡任何情况下都不被浪面/浪花遮挡
    disk=mkWaveDisk(rTop,16,72,new THREE.MeshBasicMaterial({map:whirlWaterTex,transparent:true,opacity:.95,side:THREE.DoubleSide,depthWrite:false,fog:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),1,1);
    disk.renderOrder=5;g.add(disk);
    foam=mkWaveDisk(rTop*.98,14,64,new THREE.MeshBasicMaterial({map:whirlFoamTex,transparent:true,opacity:.82,side:THREE.DoubleSide,depthWrite:false,fog:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),1,1);
    foam.renderOrder=6;g.add(foam);
    core=mkWaveDisk(.8,5,24,new THREE.MeshBasicMaterial({map:whirlCoreTex,transparent:true,opacity:1,side:THREE.DoubleSide,depthWrite:false,fog:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}),1,1);
    core.renderOrder=7;g.add(core);
    g.scale.setScalar(wm);
    g.position.set(x,0,z);scene.add(g);
    // 边缘浪花环 + 引力提示圈（贴浪面网格，不会被海浪盖住）
    rim=mkWaveRing(2,72,new THREE.MeshBasicMaterial({map:wakeTex,transparent:true,opacity:.85,depthWrite:false,fog:false,side:THREE.DoubleSide}),3);
    rim.renderOrder=8; // 浪花环盖在漩涡边缘之上（depthWrite=false 时按 renderOrder 分层）
    field=mkWaveRing(1,72,new THREE.MeshBasicMaterial({color:0x66ccff,transparent:true,opacity:.25,depthWrite:false,fog:false,side:THREE.DoubleSide}),1);
    field.renderOrder=4;
    scene.add(rim,field);
    const zone={x,z,r:rTop*wm,depth};whirlZones.push(zone);
    // 创建即同步一次顶点（其余帧由 updateWhirlpools 每帧刷新），
    // 否则生成后到下个更新帧之间贴图会平躺在 y=0 高度闪一下
    disk.userData.update(x,z,wm,.42);foam.userData.update(x,z,wm,.47);core.userData.update(x,z,wm,.52);
    rim.userData.update(x,z,2.3*wm,3.9*wm,.40);field.userData.update(x,z,4.6*wm,5*wm,.20);
    return{group:g,disk,foam,core,rim,field,zone,life:9+Math.random()*4,x,z,scale:wm,depth,lantern:null};
}
function spawnWhirlpool(){
    if(!duckModel)return;
    const ang=Math.random()*Math.PI*2,dist=12+Math.random()*16;
    whirlpools.push(mkWhirlpool(duckModel.position.x+Math.cos(ang)*dist,duckModel.position.z+Math.sin(ang)*dist));
}
window.__whirlTest={
    spawn:near=>{if(!duckModel)return;const d=near||6;whirlpools.push(mkWhirlpool(duckModel.position.x+d,duckModel.position.z));return whirlpools.length},
    info:()=>whirlpools.map(w=>({lantern:!!w.isLanternFx,hasDisk:!!w.disk,diskLift:w.disk&&w.disk.userData.update?'sync':'no',diskDepthWrite:w.disk?w.disk.material.depthWrite:null,diskPolygonOffset:w.disk?w.disk.material.polygonOffset:null,diskRenderOrder:w.disk?w.disk.renderOrder:null})),
    // 检查漩涡 disk 顶点与 waveHeight 的差值（应等于抬升 .42/ws，完全贴合）
    checkSync:()=>{const w=whirlpools[0];if(!w)return'no whirl';if(!w.disk)return'lantern whirlpool (no disk)';const ws=w.scale||1;const pos=w.disk.geometry.attributes.position;let maxDiff=0,samples=0;const cx=w.x,cz=w.z;for(let i=0;i<pos.count;i+=20){const lx=pos.getX(i),lz=pos.getZ(i);const wx=cx+lx*ws,wz=cz+lz*ws;const wh=waveHeight(wx,wz,waveClock);const expected=(wh+.42)/ws;const actual=pos.getY(i);const diff=Math.abs(actual-expected);if(diff>maxDiff)maxDiff=diff;samples++}return{maxDiff:samples?maxDiff.toFixed(4):0,samples}}
};
window.__auraTest={
    info:()=>({depthWrite:auraMesh.material.depthWrite,renderOrder:auraMesh.renderOrder,visible:auraMesh.visible,opacity:auraMesh.material.opacity})
};
// 临时测试钩子：暴露游戏内部状态用于双人模式同步验证
window.__gameState=()=>({
    itemsCount:items.length,
    itemsActive:items.filter(i=>!i.coll).length,
    itemsTypes:items.filter(i=>!i.coll).map(i=>i.type),
    itemsPositions:items.filter(i=>!i.coll).map(i=>[i.type,Math.round(i.mesh.position.x*10)/10,Math.round(i.mesh.position.z*10)/10]),
    whirlpoolsCount:whirlpools.length,
    whirlpoolsPos:whirlpools.map(w=>[Math.round(w.x*10)/10,Math.round(w.z*10)/10,Math.round(w.scale*100)/100]),
    activeEvent:activeEvent,
    globalEventTimer:Math.round(globalEventTimer*10)/10,
    activeEventTime:Math.round(activeEventTime*10)/10,
    waveSpeed:Math.round(waveSpeed*100)/100,
    gameClock:Math.round(gameClock*10)/10,
    duoActive:typeof Duo!=='undefined'?Duo.active:null,
    duoRole:typeof Duo!=='undefined'?Duo.role:null,
    duoItemsHash:typeof duoItemsHash!=='undefined'?duoItemsHash:null,
    duoOtherState:typeof Duo!=='undefined'&&Duo.other?{hasState:!!Duo.other.state,hasScene:!!Duo.other.state?.scene,sceneKeys:Duo.other.state?.scene?Object.keys(Duo.other.state.scene):null,sceneWhirls:Duo.other.state?.scene?.whirls?Duo.other.state.scene.whirls.length:null,sceneItemsCount:Duo.other.state?.scene?.items?Duo.other.state.scene.items.length:null}:null,
    duoApplyCallsCount:(window.__duoApplyCalls||[]).length,
    duoApplyCalls:(window.__duoApplyCalls||[]).slice(-3),
    score:score,
    hearts:hearts,
    gameActive:gameActive,
    isPaused:typeof isPaused!=='undefined'?isPaused:null,
    frameCount:typeof frameCount!=='undefined'?frameCount:null,
    // 双人同步调试：本地/远程鸭子位置 + 远程特效状态
    localDuckPos:duckModel?{x:Math.round(duckModel.position.x*100)/100,y:Math.round(duckModel.position.y*100)/100,z:Math.round(duckModel.position.z*100)/100}:null,
    remoteDuckPos:duoRemoteDuck?{x:Math.round(duoRemoteDuck.position.x*100)/100,y:Math.round(duoRemoteDuck.position.y*100)/100,z:Math.round(duoRemoteDuck.position.z*100)/100}:null,
    remoteDuckVisible:duoRemoteDuck?duoRemoteDuck.visible:null,
    remoteTarget:duoRemoteTarget?{x:Math.round(duoRemoteTarget.x*100)/100,z:Math.round(duoRemoteTarget.z*100)/100,sh:duoRemoteTarget.sh,mt:duoRemoteTarget.mt,bt:duoRemoteTarget.bt,iv:duoRemoteTarget.iv}:null,
    remoteShieldVisible:duoRemoteShield?duoRemoteShield.visible:null,
    remoteMagnetRingVisible:duoRemoteMagnetRing?duoRemoteMagnetRing.visible:null,
    remoteMagnetParticlesVisible:duoRemoteMagParticles?duoRemoteMagParticles.visible:null,
    remoteCrownVisible:duoRemoteCrown?duoRemoteCrown.visible:null,
    remoteAuraVisible:duoRemoteAura?duoRemoteAura.visible:null,
    remoteDuckScale:duoRemoteDuck?Math.round(duoRemoteDuck.scale.x*100)/100:null,
    sharkExists:typeof shark!=='undefined'&&shark?{x:Math.round(shark.g.position.x*100)/100,z:Math.round(shark.g.position.z*100)/100}:null,
    waveEventActive:typeof waveEventActive!=='undefined'?waveEventActive:null,
    waveEventDir:typeof waveEventDir!=='undefined'?{x:Math.round(waveEventDir.x*100)/100,z:Math.round(waveEventDir.z*100)/100}:null,
    waveEventDuration:typeof waveEventDuration!=='undefined'?Math.round(waveEventDuration*100)/100:null,
    localShield:typeof hasShield!=='undefined'?{active:hasShield,timer:typeof shieldTimer!=='undefined'?Math.round(shieldTimer*100)/100:null}:null,
    localMagnet:typeof magnetActive!=='undefined'?{active:magnetActive,timer:typeof magnetTimer!=='undefined'?Math.round(magnetTimer*100)/100:null}:null,
    localBigTimer:typeof bigTimer!=='undefined'?Math.round(bigTimer*100)/100:null,
    localInvincible:typeof invincible!=='undefined'?Math.round(invincible*100)/100:null
});
function updateWhirlpools(dt){
    // 漩涡贴图旋转动画：沿圆周方向（UV-U）滚动 = 螺旋水流旋转，泡沫反向转更有层次
    whirlWaterTex.offset.x=(whirlWaterTex.offset.x+dt*.09)%1;
    whirlFoamTex.offset.x=(whirlFoamTex.offset.x-dt*.13+1)%1;
    if(typeof whirlLanternTex!=='undefined')whirlLanternTex.offset.x=(whirlLanternTex.offset.x+dt*.09)%1;
    for(let i=whirlpools.length-1;i>=0;i--){
        const w=whirlpools[i];
        // duo guest：life 和物品销毁由房主场景同步负责，客机跳过避免不同步
        if(!duoIsGuest())w.life-=dt;
        const ws=w.scale||1;       // 漩涡缩放倍数
        const R=12*ws;              // 影响半径（大幅扩大，让鸭子更易进入吸力范围）
        const SINK_R=1.0*ws;       // 进入中心阈值：到达此处触发沉没动画
        if(w.isLanternFx){
            // ---- 元宵灯笼群：暖光涟漪 + 3 盏灯笼漂浮升降 ----
            w.field.userData.update(w.x,w.z,4.6*ws,5*ws,.20);
            w.field.material.color.setHex(0xffaa55);
            w.field.material.opacity=.2+Math.sin(gameClock*2.2+i)*.08;
            if(w.lantern){
                w.lantern.position.set(w.x,waveHeight(w.x,w.z,waveClock),w.z);
                w.lantern.rotation.y+=dt*.3; // 整群缓慢旋转
                for(let li=0;li<w.lantern.children.length;li++){
                    const L=w.lantern.children[li],ud=L.userData;
                    const baseY=waveHeight(w.x+Math.cos(ud.ph)*ud.r,w.z+Math.sin(ud.ph)*ud.r,waveClock);
                    L.position.y=ud.baseY+Math.sin(gameClock*1.6+ud.ph*2+li)*.22; // 各自轻缓升降
                    L.rotation.z=Math.sin(gameClock*1.2+li)*.1; // 微风摇摆
                    L.rotation.y+=dt*.4;
                }
            }
        }else{
            // ---- 常规漩涡：漏斗贴图 + 浪花环 ----
            // 圆盘贴图每帧贴合浪面 + 有序抬高（.42/.47/.52），高于 waveMesh 漏斗+巨浪事件下的
            // 最大插值偏差（~0.38）：贴图任何情况下都不被浪面顶出不规则破洞（恢复 f51f421 版本）
            w.disk.userData.update(w.x,w.z,ws,.42);
            w.foam.userData.update(w.x,w.z,ws,.47);
            w.core.userData.update(w.x,w.z,ws,.52);
            // 浪花环/引力圈逐帧贴合浪面
            w.rim.userData.update(w.x,w.z,2.3*ws,3.9*ws,.40);
            w.field.userData.update(w.x,w.z,4.6*ws,5*ws,.20);
            // 漩涡贴图随昼夜变暗（MeshBasicMaterial 自发光，否则夜晚亮得突兀）
            w.disk.material.color.setScalar(envBright);w.foam.material.color.setScalar(envBright);
            w.core.material.color.setScalar(envBright);w.rim.material.color.setScalar(envBright);
            w.field.material.color.setHex(0x66ccff);w.field.material.color.multiplyScalar(envBright);
            w.rim.material.opacity=.55+Math.sin(gameClock*5+i)*.25;
            w.field.material.opacity=.16+Math.sin(gameClock*3+i)*.1;
        }
        if(gameActive&&duckModel&&duckSink.state==='none'){
            const dx=w.x-duckModel.position.x,dz=w.z-duckModel.position.z;const d=Math.sqrt(dx*dx+dz*dz);
            if(d<R&&d>0.001){
                const nx=dx/d,nz=dz/d;
                // 动态引力：越靠近中心越强（指数曲线 ratio^5），远处温和可感知，近处暴增
                const ratio=1-d/R;          // 0=远，1=中心
                const wr=Blessings.isWhirlImmune()?0:1-(activeRewards.whirlResist||0); // 祝福免伤优先，其次是成就永久抗性
                const pull=(Math.pow(ratio,5)*60+ratio*3)*wr;  // 边缘~3，中段~5，近处~63（暴增）
                duckVel.x+=nx*pull*dt;duckVel.z+=nz*pull*dt;
                // 切向旋涡（随距离指数增强）
                const tan=(Math.pow(ratio,4)*15+ratio*2)*wr;
                duckVel.x+=-nz*tan*dt;duckVel.z+=nx*tan*dt;
                // 到达中心 → 触发沉没动画：护盾(hasShield)不能挡，只有无敌(invincible>0)可挡
                if(d<SINK_R&&invincible<=0&&!Blessings.isWhirlImmune()){
                    duckSink.state='sinking';duckSink.t=0;duckSink.whirl=w;
                    duckSink.startY=duckModel.position.y;duckSink.startX=duckModel.position.x;duckSink.startZ=duckModel.position.z;
                    duckVel.set(0,0,0);
                    playSFX('suck'); // 被吸入瞬间的卷水声
                }
            }
        }
        // 对周围道具产生动态吸引力（越近越强），到达中心则销毁（客机跳过：物品由房主场景同步负责）
        if(!duoIsGuest())for(const it of items){if(it.coll)continue;const ax=w.x-it.mesh.position.x,az=w.z-it.mesh.position.z;const ad=Math.sqrt(ax*ax+az*az);
            if(ad<R&&ad>0.001){
                const r2=1-ad/R;
                // 指数曲线：近处吸力骤增（ratio^6），远处温和
                const f=(Math.pow(r2,6)*18+r2*2.5)*dt;
                it.mesh.position.x+=ax/ad*f;it.mesh.position.z+=az/ad*f;
                if(ad<SINK_R){it.coll=true;scene.remove(it.mesh)} // 进入中心 → 销毁
            }
        }
        if(!duoIsGuest()&&w.life<=0){scene.remove(w.group);if(w.rim)scene.remove(w.rim);if(w.field)scene.remove(w.field);if(w.lantern)scene.remove(w.lantern);const zi=whirlZones.indexOf(w.zone);if(zi>=0)whirlZones.splice(zi,1);whirlpools.splice(i,1)}
    }
}
// 鸭子被漩涡吸入沉没动画：下沉→旋转→消失→扣心→重生
const duckSink={state:'none',t:0,whirl:null,startY:0,startX:0,startZ:0};
let sinkFx=0; // 吸入画面扭曲强度（0-1，updateSkyFx 暗角螺旋 + canvas 扭转用）
function updateDuckSink(dt){
    if(duckSink.state==='none')return;
    duckSink.t+=dt;
    const D=duckSink,DUR=1.2;
    if(D.state==='sinking'){
        const k=Math.min(1,D.t/DUR);
        sinkFx=k*k*(3-2*k); // 后处理涡旋滤镜强度（smoothstep 缓入缓出，淡入褪去都优雅）
        // 跟随漩涡中心轻微旋转 + 沉入水下
        const ang=k*Math.PI*2.5;
        const sinkR=.5*(1-k);
        duckModel.position.x=D.whirl.x+Math.cos(ang)*sinkR;
        duckModel.position.z=D.whirl.z+Math.sin(ang)*sinkR;
        duckModel.position.y=D.startY-k*2.4;       // 沉到水面下
        duckModel.rotation.y+=dt*8;               // 高速旋转
        duckModel.scale.setScalar(.72*(1-k*.4));   // 微缩
        if(k>=1){
            // 元宵灯笼漩涡：吸入不扣分，只传送回岸边
            if(Blessings.festival?.id==='festival_lantern'){
                duckModel.position.set(0,.05,0);duckVel.set(0,0,0);
                duckModel.scale.setScalar(.72);duckModel.rotation.y=0;
                if(D.whirl)D.whirl.life=0;
                invincible=2;sinkFx=0;screenFlash();playSFX('collect');
                toast('<i class="fa-solid fa-lightbulb"></i> 灯笼把你送回了岸边','s');
                D.state='none';D.whirl=null;
                return;
            }
            // 完成沉没：直接扣心（绕过 takeDamage，护盾无法挡，只有 invincible 能在触发前挡）
            hearts=Math.max(0,hearts-1);updateHeartsUI();screenFlash();playSFX('whirl');
            // 成就追踪：累计被漩涡吸入次数
            Achievements.updateStat('whirlDeaths',1);
            if(hearts<=0){D.state='none';gameOver();return}
            // 重生到安全位置（原点附近）；吃掉鸭子的漩涡随之消散（防止重生后被同一漩涡反复吞没）
            duckModel.position.set(0,.05,0);duckVel.set(0,0,0);
            duckModel.scale.setScalar(.72);duckModel.rotation.y=0;
            if(D.whirl)D.whirl.life=0;
            invincible=2;
            toast('<i class="fa-solid fa-water"></i> 被漩涡吸入 -1 <i class="fa-solid fa-heart"></i>','m');
            D.state='none';D.whirl=null;
        }
    }
}

// ---- 水下暗影（鲨鱼） ----
let shark=null,sharkHitCd=0,sharkSpawnCount=0,sharkAttackCount=0,eventSharkSpawnCount=0;
const EVENT_SHARK_MAX=2; // 当前事件生效时间内最多出现2次（非总计）
const SHARK_ATTACK_MAX=2; // 每只鲨鱼最多攻击2次
// 鲨鱼水下剪影贴图（俯视：尖吻、双胸鳍、分叉尾，柔边模拟水下模糊感）
const sharkShadowTex=mkTex(256,256,(x)=>{
    x.translate(128,128);
    x.filter='blur(6px)';
    x.fillStyle='rgba(8,32,52,.98)';
    x.beginPath();
    x.moveTo(0,-96);
    x.bezierCurveTo(18,-84,28,-52,28,-20);   // 右侧头/躯干
    x.bezierCurveTo(28,-8,46,2,62,10);       // 右胸鳍
    x.bezierCurveTo(44,12,32,8,26,6);
    x.bezierCurveTo(22,36,16,60,10,74);      // 收窄向尾
    x.lineTo(28,100);                        // 右尾叉
    x.lineTo(6,82);
    x.lineTo(0,90);
    x.lineTo(-6,82);
    x.lineTo(-28,100);                       // 左尾叉
    x.lineTo(-10,74);
    x.bezierCurveTo(-16,60,-22,36,-26,6);
    x.bezierCurveTo(-32,8,-44,12,-62,10);    // 左胸鳍
    x.bezierCurveTo(-46,2,-28,-8,-28,-20);
    x.bezierCurveTo(-28,-52,-18,-84,0,-96);
    x.fill();
});
// 攻击水花特效
function spawnSplash(pos){
    for(let i=0;i<12;i++){
        const m=new THREE.Mesh(new THREE.SphereGeometry(.06,6,6),new THREE.MeshBasicMaterial({color:0xdff2ff,transparent:true,opacity:.95,fog:false}));
        m.position.copy(pos);m.position.y+=.2;scene.add(m);
        const a=Math.random()*Math.PI*2,sp=1.5+Math.random()*2;
        transientFx.push({m,vx:Math.cos(a)*sp,vy:2+Math.random()*1.5,vz:Math.sin(a)*sp,life:.7,max:.7,gravity:6});
    }
}
function spawnShark(){
    if(shark||!duckModel||eventSharkSpawnCount>=EVENT_SHARK_MAX)return;
    eventSharkSpawnCount++;
    sharkSpawnCount++;
    sharkAttackCount=0; // 重置攻击计数
    const g=new THREE.Group();
    // 水下暗影（细分平面逐帧贴合浪面，永远不会被海浪盖住）
    const shadowGeo=new THREE.PlaneGeometry(6.5,6.5,10,10);
    shadowGeo.rotateX(Math.PI/2); // 贴图鼻尖(+y) 朝向本地 +z
    const shadow=new THREE.Mesh(shadowGeo,new THREE.MeshBasicMaterial({map:sharkShadowTex,transparent:true,opacity:.6,depthWrite:false,fog:false,side:THREE.DoubleSide}));
    g.add(shadow);
    // 背鳍（经典鲨鱼鳍：用三次贝塞尔曲线 + 极大 bevel，让整体饱满圆润无尖角）
    const fs=new THREE.Shape();
    fs.moveTo(-.55,.02);
    fs.bezierCurveTo(-.35,.15,-.15,.45,0,.7);       // 前缘：缓弧上升
    fs.bezierCurveTo(.12,.82,.28,.78,.4,.55);       // 鳍尖：圆润过渡（去尖刺）
    fs.bezierCurveTo(.5,.35,.58,.18,.55,.02);       // 后缘：圆滑收回
    fs.bezierCurveTo(.3,-.04,-.3,-.04,-.55,.02);    // 底部：弧形收口
    // 适度 bevel：仅边缘微圆，保留鳍的整体造型
    const finGeo=new THREE.ExtrudeGeometry(fs,{
        depth:.1,
        bevelEnabled:true,
        bevelThickness:.05,    // 厚度方向微圆
        bevelSize:.05,          // 轮廓方向微圆
        bevelSegments:8,        // 圆滑细分
        curveSegments:48        // 曲线细分
    });
    finGeo.translate(0,0,-.05);
    finGeo.computeVertexNormals();
    const fin=new THREE.Mesh(finGeo,new THREE.MeshStandardMaterial({color:0x24506e,roughness:.38,metalness:.08,emissive:0x0a2033,emissiveIntensity:.4}));
    fin.rotation.y=Math.PI/2;fin.position.set(0,-.3,.1);
    g.add(fin);
    // 鳍根浪花环（贴合浪面，增强"鳍划开水面"感）
    const wake=mkWaveRing(1,40,new THREE.MeshBasicMaterial({map:wakeTex,transparent:true,opacity:.55,depthWrite:false,fog:false,side:THREE.DoubleSide}),2);
    scene.add(wake);
    g.scale.setScalar(1.25);
    const a=Math.random()*Math.PI*2;
    g.position.set(duckModel.position.x+Math.cos(a)*14,0,duckModel.position.z+Math.sin(a)*14);
    scene.add(g);shark={g,fin,shadow,wake};
}
function updateShark(dt){
    if(!shark)return;
    const p=shark.g.position;
    // 鲨鱼整体贴着浪面：无论浪多大，暗影浮在水面、鱼鳍保持在水面之上
    const gy=waveHeight(p.x,p.z,renderedWaveClock);
    p.y=gy;
    // duo guest：鲨鱼位置由房主 scene 同步负责，本地不做追踪/碰撞/生成下一只
    if(duoIsGuest()){
        shark.g.rotation.z=Math.sin(gameClock*3.2)*.05;
        shark.fin.rotation.x=Math.sin(gameClock*4.1)*.12;
        shark.fin.position.y=-.3+Math.sin(gameClock*2.3)*.05;
        shark.shadow.material.opacity=.55;
        const sp=shark.shadow.geometry.attributes.position;
        const ry=shark.g.rotation.y,c=Math.cos(ry),s=Math.sin(ry);
        for(let i=0;i<sp.count;i++){
            const lx=sp.getX(i),lz=sp.getZ(i);
            sp.setY(i,waveHeight(p.x+lx*c+lz*s,p.z-lx*s+lz*c,renderedWaveClock)-gy+.06);
        }
        sp.needsUpdate=true;
        shark.wake.userData.update(p.x,p.z,.5,.95,.05);
        shark.wake.material.opacity=.35+Math.sin(gameClock*6)*.2;
        return;
    }
    if(gameActive&&duckModel){
        const dx=duckModel.position.x-p.x,dz=duckModel.position.z-p.z;const d=Math.sqrt(dx*dx+dz*dz)||1;
        // 逼近冲刺：4 单位内加速（压迫感）
        const lunge=Math.max(0,Math.min(1,(4-d)/2));
        const spd=sharkAttackCount<SHARK_ATTACK_MAX?2.6+lunge*2:2.6;
        p.x+=dx/d*spd*dt;p.z+=dz/d*spd*dt;
        shark.g.rotation.y=Math.atan2(dx,dz);
        // 游动动画：身体扭动 + 背鳍摇摆/逼近时抬高
        shark.g.rotation.z=Math.sin(gameClock*3.2)*.05;
        shark.fin.rotation.x=Math.sin(gameClock*4.1)*.12;
        shark.fin.position.y=-.3+Math.sin(gameClock*2.3)*.05+lunge*.15;
        shark.shadow.material.opacity=.55+lunge*.2;
        // 水下暗影顶点贴合浪面（含身体朝向旋转）
        const sp=shark.shadow.geometry.attributes.position;
        const ry=shark.g.rotation.y,c=Math.cos(ry),s=Math.sin(ry);
        for(let i=0;i<sp.count;i++){
            const lx=sp.getX(i),lz=sp.getZ(i);
            sp.setY(i,waveHeight(p.x+lx*c+lz*s,p.z-lx*s+lz*c,renderedWaveClock)-gy+.06);
        }
        sp.needsUpdate=true;
        // 鳍根浪花环
        shark.wake.userData.update(p.x,p.z,.5,.95,.05);
        shark.wake.material.opacity=.35+Math.sin(gameClock*6)*.2+lunge*.25;
        sharkHitCd-=dt;
        if(d<2.2&&sharkHitCd<=0&&invincible<=0){
            takeDamage(1);
            sharkHitCd=3;
            p.x-=dx/d*3;p.z-=dz/d*3;
            spawnSplash(duckModel.position.clone());
            // 碰撞后鲨鱼销毁（不再多次攻击）
            removeShark();
            // 若事件仍激活且未达上限，3秒后生成下一只
            if(activeEvent==='shadow'&&eventSharkSpawnCount<EVENT_SHARK_MAX){
                setTimeout(()=>{if(activeEvent==='shadow'&&eventSharkSpawnCount<EVENT_SHARK_MAX)spawnShark()},3000);
            }
            return;
        }
        // 长时间未撞击：超过 12 秒后强制离开并尝试生成下一只（防止卡住）
        if(!shark)return;
        shark.leaveTimer=(shark.leaveTimer||0)+dt;
        if(shark.leaveTimer>=12){
            removeShark();
            if(activeEvent==='shadow'&&eventSharkSpawnCount<EVENT_SHARK_MAX)spawnShark();
        }
    }
}
function removeShark(){if(shark){scene.remove(shark.g);scene.remove(shark.wake);shark=null}}

// ---- 随机事件系统（每30秒全局触发） ----
// 难度递进：基于游戏时长返回 0..1 的难度因子（0=开局，1=5分钟后满级）
function difficultyFactor(){
    if(!playStartTime)return 0;
    const mins=(Date.now()-playStartTime)/60000;
    return Math.min(1,mins/5);
}
// 按难度动态加权：坏事件权重随难度上升（开局保持原配置，满级坏事件 ×2.5）
function pickEvent(){
    const diff=difficultyFactor();
    const base=hearts<=1?EV_W_MERCY:EV_W_NORMAL;
    const w=base.map(([k,v])=>{
        const t=EVENTS[k].t;
        const m=t==='bad'?(1+1.5*diff):1; // 坏事件随时间加重
        return [k,v*m];
    });
    let tot=0;for(const p of w)tot+=p[1];
    let r=Math.random()*tot;
    for(const p of w){r-=p[1];if(r<=0)return p[0]}
    return w[0][0];
}
let globalEventTimer=30,activeEvent=null,activeEventTime=0,pendingEvent=null,warnedFor=null;
let whirlSpawnTimer=0;
let windActive=false;let windSpeedMul=1;
let stormActive=false,rainbowActive=false;
// showEventHud/hideEventHud/showWarn/hideWarn 已迁移到 ui/hud.js
function startEvent(key){
    activeEvent=key;
    // 事件持续时间随难度延长：满级时 +60%（开局保持原配置）
    activeEventTime=EVENTS[key].d*(1+0.6*difficultyFactor());
    showEventHud(EVENTS[key]);toast('<i class="fa-solid '+EVENTS[key].ic+'"></i> '+EVENTS[key].n,'s');playSFX('event');
    windActive=false;windSpeedMul=1;stormActive=false;rainbowActive=false;eventRockBoost=0;eventWaveTarget=1;waveSpeedTarget=1;
    document.getElementById('rain-overlay').classList.remove('show');
    document.getElementById('rainbow-overlay').classList.remove('show');
    if(key==='tailwind'){windActive=true;windSpeedMul=1.7;const wa=Math.random()*Math.PI*2;evWindDir={x:Math.cos(wa),z:Math.sin(wa)}}       // 顺风：加速
    else if(key==='headwind'){windActive=true;windSpeedMul=0.5;const wa=Math.random()*Math.PI*2;evWindDir={x:Math.cos(wa),z:Math.sin(wa)}}  // 逆风：减速
    else if(key==='storm'){stormActive=true;eventRockBoost=6;eventWaveTarget=2.2;waveSpeedTarget=1.7}
    else if(key==='rainbow'){rainbowActive=true;document.getElementById('rainbow-overlay').classList.add('show')}
    else if(key==='shadow'){if(!duoIsGuest())spawnShark()}
    else if(key==='bigwave'){eventWaveTarget=2.0;waveSpeedTarget=1.4}
    else if(key==='itemrain'){
        // 道具雨：从天上掉落，生成在空中并带 falling 标记，由主循环处理掉落动画
        // duo guest：道具由房主 scene 同步负责，跳过本地生成避免重复
        if(!duoIsGuest()){
            for(let i=0;i<3;i++){
                const an=Math.random()*Math.PI*2,ds=6+Math.random()*12;
                const x=duckModel.position.x+Math.cos(an)*ds,z=duckModel.position.z+Math.sin(an)*ds;
                const mesh=mkHeart(x,z);mesh.position.y=10;scene.add(mesh);
                items.push({mesh,type:'heart',r:.6,coll:false,falling:10,fallVy:0});
            }
            for(let i=0;i<4;i++){
                const an=Math.random()*Math.PI*2,ds=6+Math.random()*12,ls=.3+Math.random()*.25;
                const x=duckModel.position.x+Math.cos(an)*ds,z=duckModel.position.z+Math.sin(an)*ds;
                const m=mkLily(x,z,ls);m.position.y=10;scene.add(m);
                items.push({mesh:m,type:'lily',r:ls,coll:false,falling:10,fallVy:0});
            }
        }
    }
    else if(key==='calm'){eventWaveTarget=.7;waveSpeedTarget=.8}
}
function endEvent(){
    activeEvent=null;hideEventHud();
    windActive=false;windSpeedMul=1;stormActive=false;rainbowActive=false;eventRockBoost=0;eventWaveTarget=1;waveSpeedTarget=1;
    document.getElementById('rain-overlay').classList.remove('show');
    document.getElementById('rainbow-overlay').classList.remove('show');
    removeShark();
    eventSharkSpawnCount=0; // 重置当前事件内鲨鱼计数（每次事件最多2只）
}
function updateGlobalEvent(dt){
    if(!gameActive)return;
    // duo guest：漩涡、事件、时钟一律以房主为准，跳过本地生成
    if(duoIsGuest())return;
    // 难度递进：漩涡生成周期 5s → 3s（满级），生成概率 30% → 50%（暴风雨 60% → 80%）
    const diff=difficultyFactor();
    const whirlPeriod=5-2*diff;
    whirlSpawnTimer=(whirlSpawnTimer||0)+dt;
    if(whirlSpawnTimer>=whirlPeriod){
        whirlSpawnTimer=0;
        const baseProb=stormActive?0.6:0.3;
        const prob=baseProb+0.2*diff;
        if(Math.random()<prob){const n=1+Math.floor(Math.random()*2);for(let i=0;i<n;i++)spawnWhirlpool()}
    }
    if(!activeEvent){
        globalEventTimer-=dt;
        if(globalEventTimer<=3&&globalEventTimer>0){if(!pendingEvent)pendingEvent=pickEvent();if(warnedFor!==pendingEvent){warnedFor=pendingEvent;showWarn(EVENTS[pendingEvent])}}
        if(globalEventTimer<=0){
            const key=pendingEvent||pickEvent();pendingEvent=null;warnedFor=null;hideWarn();
            startEvent(key);
            globalEventTimer=30;
        }
    }else{
        activeEventTime-=dt;
        document.getElementById('event-hud').querySelector('.ev-time').textContent=Math.ceil(Math.max(0,activeEventTime))+'s';
        if(activeEventTime<=0)endEvent();
    }
}

// 注入 HUD 依赖（必须在 updateHeartsUI/updateStreakUI 初始化调用之前）
// hearts/MAX_HEARTS/streakItems/activeEventTime 都是 let 变量，传 getter 函数避免值快照过时
setHudCtx({
    hearts:()=>hearts,
    MAX_HEARTS:()=>MAX_HEARTS,
    streakItems:()=>streakItems,
    activeEventTime:()=>activeEventTime,
    // TDZ 安全：isFestival 内部 try/catch（模块顶层 updateHeartsUI 早于 Blessings 声明执行）
    isMoonHearts:()=>isFestival('festival_mid_autumn')
});
updateHeartsUI();
updateStreakUI();// 收集栏常驻显示
// 启动时从后端加载 leaderboard.json（若失败则回退 localStorage）
Leaderboard.load().then(d=>{console.log('排行榜已加载：',d.entries.length,'条记录')}).catch(e=>console.warn('排行榜加载失败：',e));

// 注入 Overlays 依赖：暂停/设置/教程/结算/重开 等覆盖层函数通过 ctx 读取 main.js 中的 let 状态
// isPaused/gameActive 是 let 变量，必须传 getter+setter 才能让模块内函数修改 main.js 的同一变量
setOverlaysCtx({
    isPaused:()=>isPaused,
    setIsPaused:v=>{isPaused=v},
    gameActive:()=>gameActive,
    setGameActive:v=>{gameActive=v},
    playStartTime:()=>playStartTime,
    score:()=>score,
    runStats:()=>runStats,
    hearts:()=>hearts,
    MAX_HEARTS:()=>MAX_HEARTS,
    lastEntry:()=>lastEntry,
    Leaderboard,
    Duo,
    toast,
    genDefaultName,
    resetRunState,
    startGameSession,
    updateSettingsPanel
});

// ===== 暂停 / 退出 / 设置 / 教程（已迁移到 js/ui/overlays.js） =====
// 挂载到 window（script type=module 中函数不在全局作用域，需要显式挂载以支持 onclick）
window.togglePause=togglePause;
window.quitGame=quitGame;
window.openSettings=openSettings;
window.closeSettings=closeSettings;
window.restartGame=restartGame;
window.nextTutorialStep=nextTutorialStep;
window.skipTutorial=skipTutorial;
// 键盘暂停快捷键
addEventListener('keydown',e=>{
    if(e.code==='Escape'||e.code==='KeyP'){
        if(document.getElementById('settings-modal').classList.contains('show')){
            if(e.code==='Escape')window.closeSettings();
            return;
        }
        if(document.getElementById('help').classList.contains('show')){
            if(e.code==='Escape')document.getElementById('help').classList.remove('show');
            return;
        }
        // 成就面板打开时，Esc/关闭面板而不是暂停
        if(document.getElementById('ach-modal').classList.contains('show')){
            if(e.code==='Escape')closeAchievements();
            return;
        }
        if(document.getElementById('tutorial').classList.contains('show'))return;
        if(gameActive)togglePause();
    }
    // F3 切换 FPS 监控
    if(e.code==='F3'){
        e.preventDefault();
        const fpsHud=document.getElementById('fps-hud');
        fpsHud.classList.toggle('show');
        localStorage.setItem('duck_fps',fpsHud.classList.contains('show')?'1':'0');
    }
});

// ===== 今日祝福加成系统 =====
const Blessings={
    // 每日随机 buff 池
    daily:[
        {id:'grass_double',name:'水草丰收',desc:'今日水草得分 ×2',icon:'fa-seedling',target:'grass',mult:2},
        {id:'flower_triple',name:'花季绽放',desc:'今日花朵得分 ×3',icon:'fa-sun',target:'flower',mult:3},
        {id:'shield_start',name:'护盾加持',desc:'开局自带 1 层护盾',icon:'fa-shield-halved',target:'shield',value:1},
        {id:'magnet_extend',name:'磁场强化',desc:'磁铁持续时间 +50%',icon:'fa-magnet',target:'magnet',mult:1.5},
        {id:'speed_boost',name:'疾风步',desc:'移动速度 +20%',icon:'fa-wind',target:'speed',mult:1.2},
        {id:'heart_cap',name:'生命扩容',desc:'最大生命 +1',icon:'fa-heart',target:'maxHearts',value:1},
        {id:'score_bonus',name:'幸运星',desc:'所有得分 +10%',icon:'fa-star',target:'score',mult:1.1},
        {id:'whirl_shield',name:'漩涡护盾',desc:'漩涡吸入不扣心',icon:'fa-tornado',target:'whirl',value:1}
    ],
    // 节日专属 buff：独立于今日祝福，两个效果会一起参与结算。greeting 为节日祝福语，fx 为特效粒子色
    // 按一年中时间顺序排列（元旦 → 小年），与 readme.md 节日表及调试面板顺序保持一致
    holidays:{
        '0101':{id:'festival_new_year',name:'元旦',greeting:'新年快乐，鸭鸭陪你开启全新一年！',desc:'雪花飘落 · 磁铁范围 ×2',icon:'fa-snowflake',target:'magnetRange',value:2,fx:'#9fd8ff'},
        'new_years_eve':{id:'festival_eve',name:'除夕',greeting:'爆竹声中一岁除，春风送暖入屠苏。',desc:'烟花绽放 · 开局自带 1 层护盾',icon:'fa-champagne-glasses',target:'shield',value:1,fx:'#ffd166'},
        'spring':{id:'festival_spring',name:'春节',greeting:'新春大吉，鸭鸭给你拜年啦！',desc:'烟花绽放 · 初始 5 颗心',icon:'fa-burst',target:'startHearts',value:5,fx:'#ffd166'},
        'lantern':{id:'festival_lantern',name:'元宵',greeting:'花好月圆人团圆，元宵快乐！',desc:'祈福灯笼漩涡 · 吸入只传送不扣分',icon:'fa-lightbulb',target:'lanternWhirl',value:1,fx:'#ffb3c6'},
        'dragon_heads':{id:'festival_dragon_heads',name:'龙抬头',greeting:'二月二龙抬头，鸿运当头好兆头！',desc:'磁铁持续时间 +50%',icon:'fa-dragon',target:'magnet',mult:1.5,fx:'#a8e6cf'},
        'qingming':{id:'festival_qingming',name:'清明',greeting:'清明时节雨纷纷，路上行人欲断魂。',desc:'青叶飘落 · 生命上限 +1',icon:'fa-cloud-rain',target:'maxHearts',value:1,fx:'#a8d8ea'},
        '0501':{id:'festival_labor',name:'劳动节',greeting:'劳动最光荣，今天也要加油鸭！',desc:'移动速度 +30%',icon:'fa-sun',target:'speed',mult:1.3,fx:'#ffd166'},
        'dragon_boat':{id:'festival_dragon_boat',name:'端午',greeting:'粽叶飘香，端午安康！',desc:'水草变粽子 · 绿叶飘落 · 得分 ×3',icon:'fa-water',target:'grass',mult:3,fx:'#9fe6b8'},
        'qixi':{id:'festival_qixi',name:'七夕',greeting:'金风玉露一相逢，便胜却人间无数。',desc:'粉紫爱心 · 花朵得分 ×3',icon:'fa-heart',target:'flower',mult:3,fx:'#ffafcc'},
        'zhongyuan':{id:'festival_zhongyuan',name:'中元节',greeting:'河灯盏盏，思念绵绵。',desc:'漩涡免伤',icon:'fa-fire',target:'whirl',value:1,fx:'#cdb4db'},
        'mid_autumn':{id:'festival_mid_autumn',name:'中秋',greeting:'海上生明月，天涯共此时。',desc:'夜空明月 · 月亮血条 · 所有得分 ×1.5',icon:'fa-moon',target:'score',mult:1.5,fx:'#ffe3a3'},
        'double_ninth':{id:'festival_double_ninth',name:'重阳节',greeting:'遥知兄弟登高处，遍插茱萸少一人。',desc:'金叶飘落 · 开局自带 1 层护盾',icon:'fa-mountain-sun',target:'shield',value:1,fx:'#ffc8a2'},
        '1001':{id:'festival_national_day',name:'国庆',greeting:'山河锦绣，国泰民安，假期快乐！',desc:'红旗飘扬 · 撞碎蛋糕得分',icon:'fa-flag',target:'cakeRocks',value:1,fx:'#ff9d6b'},
        'winter_solstice':{id:'festival_winter_solstice',name:'冬至',greeting:'冬至大如年，人间小团圆。',desc:'所有得分 ×1.5',icon:'fa-snowflake',target:'score',mult:1.5,fx:'#bde0fe'},
        'laba':{id:'festival_laba',name:'腊八节',greeting:'过了腊八就是年，粥到福到！',desc:'水草得分 ×2',icon:'fa-bowl-food',target:'grass',mult:2,fx:'#e6c79c'},
        'xiaonian':{id:'festival_xiaonian',name:'小年',greeting:'小年祭灶忙，欢喜迎新春！',desc:'金粒升起 · 所有得分 ×1.5',icon:'fa-broom',target:'score',mult:1.5,fx:'#ffd166'}
    },
    // 农历节日公历对照表（2024–2032，日期 → holidays 键），已逐一与 MoonCal/日历网核对。
    // 此前春节/元宵/端午/中秋按公历 MMDD 匹配，基本永远不会命中（"节日祝福没做"的根源）
    lunarDates:{
        '2024-02-10':'spring','2025-01-29':'spring','2026-02-17':'spring','2027-02-06':'spring','2028-01-26':'spring','2029-02-13':'spring','2030-02-03':'spring','2031-01-23':'spring','2032-02-11':'spring',
        '2024-02-24':'lantern','2025-02-12':'lantern','2026-03-03':'lantern','2027-02-20':'lantern','2028-02-09':'lantern','2029-02-27':'lantern','2030-02-17':'lantern','2031-02-06':'lantern','2032-02-25':'lantern',
        '2024-06-10':'dragon_boat','2025-05-31':'dragon_boat','2026-06-19':'dragon_boat','2027-06-09':'dragon_boat','2028-05-28':'dragon_boat','2029-06-16':'dragon_boat','2030-06-05':'dragon_boat','2031-06-24':'dragon_boat','2032-06-12':'dragon_boat',
        '2024-09-17':'mid_autumn','2025-10-06':'mid_autumn','2026-09-25':'mid_autumn','2027-09-15':'mid_autumn','2028-10-03':'mid_autumn','2029-09-22':'mid_autumn','2030-09-12':'mid_autumn','2031-10-01':'mid_autumn','2032-09-19':'mid_autumn',
        '2024-02-09':'new_years_eve','2025-01-28':'new_years_eve','2026-02-16':'new_years_eve','2027-02-05':'new_years_eve','2028-01-25':'new_years_eve','2029-02-12':'new_years_eve','2030-02-02':'new_years_eve','2031-01-22':'new_years_eve','2032-02-10':'new_years_eve',
        '2024-03-11':'dragon_heads','2025-03-01':'dragon_heads','2026-03-20':'dragon_heads','2027-03-09':'dragon_heads','2028-02-26':'dragon_heads','2029-03-16':'dragon_heads','2030-03-05':'dragon_heads','2031-02-22':'dragon_heads','2032-03-13':'dragon_heads',
        '2024-04-04':'qingming','2025-04-04':'qingming','2026-04-05':'qingming','2027-04-05':'qingming','2028-04-05':'qingming','2029-04-05':'qingming','2030-04-05':'qingming','2031-04-05':'qingming','2032-04-05':'qingming',
        '2024-08-10':'qixi','2025-08-29':'qixi','2026-08-19':'qixi','2027-08-08':'qixi','2028-08-26':'qixi','2029-08-16':'qixi','2030-08-05':'qixi','2031-08-24':'qixi','2032-08-12':'qixi',
        '2024-08-18':'zhongyuan','2025-09-06':'zhongyuan','2026-08-27':'zhongyuan','2027-08-16':'zhongyuan','2028-09-03':'zhongyuan','2029-08-24':'zhongyuan','2030-08-13':'zhongyuan','2031-09-01':'zhongyuan','2032-08-20':'zhongyuan',
        '2024-10-11':'double_ninth','2025-10-29':'double_ninth','2026-10-18':'double_ninth','2027-10-08':'double_ninth','2028-10-26':'double_ninth','2029-10-16':'double_ninth','2030-10-05':'double_ninth','2031-10-24':'double_ninth','2032-10-12':'double_ninth',
        '2024-12-21':'winter_solstice','2025-12-21':'winter_solstice','2026-12-22':'winter_solstice','2027-12-22':'winter_solstice','2028-12-22':'winter_solstice','2029-12-22':'winter_solstice','2030-12-22':'winter_solstice','2031-12-22':'winter_solstice','2032-12-22':'winter_solstice',
        '2024-01-18':'laba','2025-01-07':'laba','2026-01-26':'laba','2027-01-15':'laba','2028-01-04':'laba','2029-01-22':'laba','2030-01-11':'laba','2031-01-01':'laba','2032-01-20':'laba',
        '2024-02-02':'xiaonian','2025-01-22':'xiaonian','2026-02-10':'xiaonian','2027-01-30':'xiaonian','2028-01-19':'xiaonian','2029-02-06':'xiaonian','2030-01-26':'xiaonian','2031-01-16':'xiaonian','2032-02-04':'xiaonian'
    },
    // 今日祝福与节日加成分层保存，调试时可分别替换并叠加
    current:null,
    festival:null,
    // 获取今天的日期 key
    getDateKey(){
        const now=new Date();
        return `${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    },
    // 检查是否是节日（先查农历对照表，再查公历 MMDD）
    getHoliday(){
        const now=new Date();
        const full=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const lunarKey=this.lunarDates[full];
        if(lunarKey&&this.holidays[lunarKey])return this.holidays[lunarKey];
        return this.holidays[this.getDateKey()]||null;
    },
    // 生成今日祝福
    generate(){
        const savedDate=localStorage.getItem('blessing_date');
        const savedBlessing=localStorage.getItem('blessing_data');
        const today=this.getDateKey();
        // 今天已经生成过，直接返回缓存
        if(savedDate===today&&savedBlessing){
            try{
                const saved=JSON.parse(savedBlessing);
                const base=this.daily.find(item=>item.id===saved?.id);
                if(base)this.current={...base,mult:Number.isFinite(Number(saved.mult))?Number(saved.mult):base.mult};
                this.festival=this.getHoliday()?{...this.getHoliday(),isFestival:true}:null;
                return this.current;
            }catch(e){}
        }
        // 每天始终生成一项今日祝福；遇到节日时额外叠加一项节日效果
        const blessing={...this.daily[Math.floor(Math.random()*this.daily.length)]};
        this.current=blessing;
        this.festival=this.getHoliday()?{...this.getHoliday(),isFestival:true}:null;
        localStorage.setItem('blessing_date',today);
        localStorage.setItem('blessing_data',JSON.stringify(blessing));
        return blessing;
    },
    getEffects(){return [this.current,this.festival].filter(Boolean)},
    applyDebugSelection(blessingId,festivalKey){
        const daily=this.daily.find(item=>item.id===blessingId);
        if(daily)this.current={...daily};
        this.festival=festivalKey&&this.holidays[festivalKey]?{...this.holidays[festivalKey],isFestival:true}:null;
        if(gameActive){this.apply();if(typeof FestivalFx!=='undefined')FestivalFx.start()}
        return this.getEffects();
    },
    // 应用祝福效果
    apply(){
        const previousHearts=hearts;
        // 每次从基础上限重算，调试反复切换不会叠加出额外生命。
        let nextMax=Math.min(8,5+(activeRewards.maxHearts||0));
        let startHearts=0;
        this.getEffects().forEach(b=>{
            if(b.target==='shield'&&b.value>0){
                hasShield=true;shieldTimer=999;
                document.getElementById('shield-hud').style.display='flex';
                shieldMesh.visible=true;
            }
            if(b.target==='maxHearts'&&b.value>0)nextMax+=b.value;
            if(b.target==='startHearts'&&b.value>0)startHearts=Math.max(startHearts,b.value);
        });
        MAX_HEARTS=Math.min(8,Math.max(nextMax,startHearts));
        hearts=startHearts?Math.min(MAX_HEARTS,startHearts):Math.min(MAX_HEARTS,Math.max(0,previousHearts));
        updateHeartsUI();
    },
    // 获取得分倍率
    getScoreMult(type){
        return this.getEffects().reduce((mult,b)=>(b.target==='score'||b.target===type)?mult*(Number(b.mult)||1):mult,1);
    },
    // 获取磁铁持续时间倍率
    getMagnetMult(){
        return this.getEffects().reduce((mult,b)=>b.target==='magnet'?mult*(Number(b.mult)||1):mult,1);
    },
    // 获取速度倍率
    getSpeedMult(){
        return this.getEffects().reduce((mult,b)=>b.target==='speed'?mult*(Number(b.mult)||1):mult,1);
    },
    // 检查漩涡是否免伤
    isWhirlImmune(){
        return this.getEffects().some(b=>b.target==='whirl');
    }
};

// ===== 节日场景特效：除夕春节烟花 / 元旦雪花 / 国庆红旗 / 中秋月亮（灯笼漩涡/粽子/蛋糕在生成处特判） =====
// 节日判定（TDZ 安全）：模块级初始化早于 Blessings 声明，typeof 无法挡 TDZ，需 try/catch 兜底
function isFestival(id){try{return typeof Blessings!=='undefined'&&Blessings.festival?.id===id}catch(e){return false}}
// 元旦磁铁范围 ×2
function getMagnetRange(){return MAGNET_RANGE*(isFestival('festival_new_year')?2:1)}
const FestivalFx={
    fwCv:null,fwCx:null,fwParts:[],fwNext:0,fwUntil:0,
    snowCv:null,snowCx:null,snowFlakes:null,
    flagsGroup:null,
    moonSprite:null, // 中秋：夜空中的一轮满月（夜晚时段常驻显示）
    ovCv:null,ovCx:null,ovKind:null,ovParts:[],
    start(){
        this.stop();
        const id=Blessings.festival?.id;
        if(!id)return;
        // 除夕与春节共用烟花特效
        if(id==='festival_spring'||id==='festival_eve')this.startFireworks();
        if(id==='festival_new_year')this.startSnow();
        if(id==='festival_national_day')this.startFlags();
        if(id==='festival_mid_autumn')this.startMoon();
        // 其余节日：统一画布覆盖层特效（各节日主题粒子；无特效节日在 startOverlay 内跳过）
        this.startOverlay(id);
    },
    stop(){
        if(this.fwCv){this.fwCv.remove();this.fwCv=null;this.fwCx=null;this.fwParts=[]}
        if(this.snowCv){this.snowCv.remove();this.snowCv=null;this.snowCx=null;this.snowFlakes=null}
        if(this.flagsGroup){scene.remove(this.flagsGroup);this.flagsGroup=null}
        if(this.moonSprite){scene.remove(this.moonSprite);this.moonSprite=null}
        if(this.ovCv){this.ovCv.remove();this.ovCv=null;this.ovCx=null;this.ovKind=null;this.ovParts=[]}
    },
    mkOverlayCanvas(){
        const cv=document.createElement('canvas');
        cv.className='festival-fx-cv';
        cv.width=innerWidth;cv.height=innerHeight;
        document.body.appendChild(cv);
        return cv;
    },
    update(dt){
        if(this.fwCv)this.updateFireworks(dt);
        if(this.snowCv)this.updateSnow(dt);
        if(this.flagsGroup)this.updateFlags(dt);
        if(this.moonSprite)this.updateMoon();
        if(this.ovCv)this.updateOverlay(dt);
    },
    // --- 春节：开局金鸭烟花（金红配色，持续约 9 秒） ---
    // 双人模式：烟花使用基于 gameClock 的确定性 PRNG，确保两端烟花轨迹一致
    startFireworks(){
        this.fwCv=this.mkOverlayCanvas();this.fwCx=this.fwCv.getContext('2d');
        this.fwParts=[];this.fwNext=gameClock;this.fwUntil=gameClock+9;this.fwSeq=0;
    },
    burst(x,y,golden,seed){
        const colors=golden?['#ffd166','#ffb84d','#fff3d6','#ff9f43']:['#ff5a4e','#ffd166','#ff8b69','#fff'];
        const n=golden?56:42;
        for(let i=0;i<n;i++){
            const a=duoRand(seed+i*3.1)*Math.PI*2,sp=60+duoRand(seed+i*7.3)*(golden?230:190);
            this.fwParts.push({type:'spark',x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1.1+duoRand(seed+i*11.7)*.8,t:0,c:colors[i%colors.length],r:golden?2.4:2});
        }
    },
    updateFireworks(dt){
        const cx=this.fwCx,W=this.fwCv.width,H=this.fwCv.height;
        cx.clearRect(0,0,W,H);
        if(gameClock<this.fwUntil&&gameClock>=this.fwNext){
            this.fwSeq=(this.fwSeq||0)+1;
            const seed=this.fwSeq*100+Math.floor(gameClock*10);
            this.fwNext=gameClock+.42+duoRand(seed+1)*.4;
            const golden=this.fwParts.filter(p=>p.type==='rocket').length%2===0;
            this.fwParts.push({type:'rocket',x:W*(.12+duoRand(seed+2)*.76),y:H+8,vx:(duoRand(seed+3)-.5)*36,vy:-(H*.62+duoRand(seed+4)*H*.2),t:0,golden,seed});
        }
        cx.globalCompositeOperation='lighter';
        for(let i=this.fwParts.length-1;i>=0;i--){
            const p=this.fwParts[i];p.t+=dt;
            if(p.type==='rocket'){
                p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=260*dt;
                cx.strokeStyle='rgba(255,220,140,.85)';cx.lineWidth=2;
                cx.beginPath();cx.moveTo(p.x-p.vx*.03,p.y-p.vy*.03);cx.lineTo(p.x,p.y);cx.stroke();
                if(p.vy>-40){this.burst(p.x,p.y,p.golden,p.seed||0);if(p.golden)playSFX('firework');this.fwParts.splice(i,1)}
            }else{
                p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=200*dt;p.vx*=(1-dt*.6);
                const a=Math.max(0,1-p.t/p.life);
                if(a<=0){this.fwParts.splice(i,1);continue}
                cx.globalAlpha=a;
                cx.fillStyle=p.c;
                cx.beginPath();cx.arc(p.x,p.y,p.r*a+0.6,0,6.283);cx.fill();
                cx.globalAlpha=1;
            }
        }
        if(gameClock>=this.fwUntil&&this.fwParts.length===0){this.fwCv.remove();this.fwCv=null;this.fwCx=null}
    },
    // --- 元旦：雪花飘落 ---
    // 双人模式：雪花使用基于 gameClock 的确定性 PRNG，确保两端雪花轨迹一致
    startSnow(){
        this.snowCv=this.mkOverlayCanvas();this.snowCx=this.snowCv.getContext('2d');
        this.snowFlakes=[];
        for(let i=0;i<110;i++)this.snowFlakes.push({x:duoRand(i*3+1)*innerWidth,y:duoRand(i*7+3)*innerHeight,r:1+duoRand(i*11+5)*2.4,sp:26+duoRand(i*13+7)*42,ph:duoRand(i*17+9)*6.28,sw:.4+duoRand(i*19+11)*.9,a:.45+duoRand(i*23+13)*.45});
    },
    updateSnow(dt){
        const cx=this.snowCx,W=this.snowCv.width,H=this.snowCv.height;
        cx.clearRect(0,0,W,H);
        cx.fillStyle='#fff';
        for(let i=0;i<this.snowFlakes.length;i++){
            const f=this.snowFlakes[i];
            f.y+=f.sp*dt;f.x+=Math.sin(gameClock*f.sw+f.ph)*20*dt;
            if(f.y>H+5){f.y=-5;f.x=duoRand(gameClock*10+i*5.3+1)*W}
            if(f.x<-5)f.x=W+5;else if(f.x>W+5)f.x=-5;
            cx.globalAlpha=f.a;
            cx.beginPath();cx.arc(f.x,f.y,f.r,0,6.283);cx.fill();
        }
        cx.globalAlpha=1;
    },
    // --- 国庆：全场景红旗飘扬 ---
    startFlags(){
        const flagTex=mkTex(128,96,x=>{
            x.fillStyle='#de2910';x.fillRect(0,0,128,96);
            x.fillStyle='#ffde00';
            const star=(sx,sy,r,rot)=>{x.save();x.translate(sx,sy);x.rotate(rot);x.beginPath();
                for(let i=0;i<5;i++){const a=-Math.PI/2+i*2*Math.PI/5,a2=a+Math.PI/5;
                    x.lineTo(Math.cos(a)*r,Math.sin(a)*r);x.lineTo(Math.cos(a2)*r*.42,Math.sin(a2)*r*.42)}
                x.closePath();x.fill();x.restore()};
            star(24,24,14,0);star(48,9,4.5,.5);star(57,19,4.5,.9);star(57,32,4.5,.4);star(48,42,4.5,.8);
        });
        const g=new THREE.Group();
        const poleGeo=new THREE.CylinderGeometry(.022,.022,2.4,6);
        const poleMat=new THREE.MeshStandardMaterial({color:0xcccccc,roughness:.45,metalness:.5});
        // 顶点着色器飘动：波从旗杆侧(x=0)向外(x=.8)传播，远端振幅更大——旗面物理上与旗杆刚性连接
        const flagMat=new THREE.MeshBasicMaterial({map:flagTex,side:THREE.DoubleSide});
        flagMat.onBeforeCompile=sh=>{
            sh.uniforms.uTime={value:0};
            flagMat.userData.shader=sh;
            sh.vertexShader='uniform float uTime;\n'+sh.vertexShader.replace('#include <begin_vertex>',
                `#include <begin_vertex>
                float fx=position.x/.8; // 0=旗杆侧 1=远端
                transformed.z+=sin(fx*5.2-uTime*5.6)*.085*fx;
                transformed.y+=sin(fx*3.1-uTime*4.2)*.03*fx;`);
        };
        const flagGeo=new THREE.PlaneGeometry(.8,.5,14,5);
        flagGeo.translate(.4,0,0); // 左边缘对齐原点=旗杆轴线，让 fx 相位从旗杆起算
        for(let i=0;i<10;i++){
            const fg=new THREE.Group();
            const pole=new THREE.Mesh(poleGeo,poleMat);pole.position.y=1.15;fg.add(pole);
            const finial=new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),poleMat);finial.position.y=2.42;fg.add(finial);
            const flag=new THREE.Mesh(flagGeo,flagMat);
            flag.position.set(.022,2.08,0);fg.add(flag); // 左边缘贴旗杆
            const ang=i/10*Math.PI*2+Math.random()*.5,dist=9+Math.random()*24;
            fg.position.set(Math.cos(ang)*dist,0,Math.sin(ang)*dist);
            fg.userData={ph:Math.random()*10};
            g.add(fg);
        }
        scene.add(g);this.flagsGroup=g;
    },
    updateFlags(dt){
        const sh=this.flagsGroup.children[0]?.children.find(c=>c.material?.userData?.shader)?.material.userData.shader;
        if(sh)sh.uniforms.uTime.value=gameClock;
        for(const fg of this.flagsGroup.children){
            fg.position.y=waveHeight(fg.position.x,fg.position.z,renderedWaveClock)-.05;
            // 整组只随浪面升降 + 极缓自转；旗面波纹全由顶点着色器驱动（根部固定，远端摆动）
            fg.rotation.y=Math.sin(gameClock*.18+fg.userData.ph)*.22;
        }
    },
    // --- 中秋：夜空中一轮满月（Sprite 圆盘 + 暖光辉光，仅夜晚时段可见） ---
    startMoon(){
        const tex=mkTex(256,256,x=>{
            // 月盘：暖白色圆 + 轻微径向渐变
            const g=x.createRadialGradient(128,128,30,128,128,110);
            g.addColorStop(0,'rgba(255,246,214,1)');
            g.addColorStop(.75,'rgba(255,236,180,.98)');
            g.addColorStop(.95,'rgba(255,225,150,.9)');
            g.addColorStop(1,'rgba(255,220,140,0)');
            x.fillStyle=g;x.beginPath();x.arc(128,128,110,0,6.283);x.fill();
            // 辉光外圈
            const h=x.createRadialGradient(128,128,90,128,128,128);
            h.addColorStop(0,'rgba(255,235,170,.5)');h.addColorStop(1,'rgba(255,225,150,0)');
            x.fillStyle=h;x.fillRect(0,0,256,256);
        });
        const mat=new THREE.SpriteMaterial({map:tex,transparent:true,opacity:0,fog:false,depthWrite:false});
        const s=new THREE.Sprite(mat);
        s.scale.set(46,46,1);
        scene.add(s);this.moonSprite=s;
    },
    updateMoon(){
        if(!this.moonSprite)return;
        // 夜晚时段常显：19:00–次日5:00 全亮（内置天空 moonDisc 距离远且方向固定不可见，此月亮跟随鸭子）
        const h=((timeOfDay%24)+24)%24;
        const nightF=h>=19?Math.min(1,(h-19)/.8):h<5?1:0;
        // 锚定鸭子前方高空：保证玩家视野里总能看到月亮
        const base=duckModel?duckModel.position:{x:0,y:0,z:0};
        this.moonSprite.position.set(base.x+18,26+Math.sin(gameClock*.2)*1.5,base.z-34);
        this.moonSprite.material.opacity=nightF*.95;
        this.moonSprite.visible=nightF>.02&&gameActive;
    },
    // ============ 全节日画布覆盖层特效（统一引擎，各节日主题粒子） ============
    // 精简策略（性能优先）：仅保留少量主题鲜明的节日粒子
    //   元旦雪花/除夕+春节烟花/国庆红旗+金星 为独立系统；此处仅覆盖：
    //   清明+端午=落叶（端午青绿 / 清明青绿偏蓝）、重阳=落叶（金黄）、七夕=粉紫小爱心、小年=金粒升起
    // 设计原则：
    //  1) 双人确定性：粒子生成用 duoRand(seed)（基于 gameClock 派生种子），两端画面一致；
    //  2) 轻量：单 canvas 2D 绘制，粒子数量精简，满帧开销 <0.5ms。
    startOverlay(id){
        const W=innerWidth,H=innerHeight;
        const rand=duoRand;
        this.ovParts=[];
        // 每个节日一个专属生成器：产生持续飘落的主题粒子
        const mk=(kind,count,initFn)=>{
            this.ovKind=kind;
            for(let i=0;i<count;i++){
                const p=initFn(i);
                p.ph=rand(i*7.3+1)*6.28;p.sw=.3+rand(i*11.7+2)*.9;
                this.ovParts.push(p);
            }
        };
        switch(id){
            case 'festival_dragon_boat': // 端午：青绿粽叶飘落
                mk('leaf',16,i=>({x:rand(i*3.1+1)*W,y:rand(i*5.7+2)*H-H*.1,s:9+rand(i*9.3+3)*8,vy:30+rand(i*13.1+4)*34,vx:(rand(i*19.3+5)-.5)*26,rot:rand(i*29.1+7)*6.28,vr:(rand(i*31.7+8)-.5)*3,hue:95+rand(i*23.7+6)*30}));
                break;
            case 'festival_qingming': // 清明：与端午共用落叶（色调偏冷青）
                mk('leaf',16,i=>({x:rand(i*3.1+1)*W,y:rand(i*5.7+2)*H-H*.1,s:8+rand(i*9.3+3)*7,vy:26+rand(i*13.1+4)*28,vx:(rand(i*19.3+5)-.5)*22,rot:rand(i*29.1+7)*6.28,vr:(rand(i*31.7+8)-.5)*2.4,hue:150+rand(i*23.7+6)*25}));
                break;
            case 'festival_double_ninth': // 重阳：与清明类似，叶子改金黄
                mk('leaf',16,i=>({x:rand(i*3.1+1)*W,y:rand(i*5.7+2)*H-H*.1,s:9+rand(i*9.3+3)*7,vy:26+rand(i*13.1+4)*26,vx:(rand(i*19.3+5)-.5)*24,rot:rand(i*29.1+7)*6.28,vr:(rand(i*31.7+8)-.5)*3,hue:38+rand(i*23.7+6)*16}));
                break;
            case 'festival_qixi': // 七夕：粉紫小爱心
                mk('heart',16,i=>({x:rand(i*3.1+1)*W,y:rand(i*5.7+2)*H-H*.1,s:5+rand(i*9.3+3)*6,vy:22+rand(i*13.1+4)*26,vx:(rand(i*19.3+5)-.5)*18,purple:rand(i*23.7+6)<.45}));
                break;
            case 'festival_xiaonian': // 小年：金色粒子自屏幕下方升起
                mk('gold',24,i=>({x:rand(i*3.1+1)*W,y:H+10+rand(i*5.7+2)*H*.5,r:1.6+rand(i*9.3+3)*2.6,vy:-(36+rand(i*13.1+4)*44),vx:(rand(i*19.3+5)-.5)*12,tw:rand(i*23.7+6)*6.28}));
                break;
            default:return; // 其余节日无覆盖层特效（元宵灯笼在 3D 场景；龙抬头/劳动节/中元/腊八/冬至无屏幕特效）
        }
        this.ovCv=this.mkOverlayCanvas();this.ovCx=this.ovCv.getContext('2d');
    },
    updateOverlay(dt){
        const cx=this.ovCx,W=this.ovCv.width,H=this.ovCv.height;
        if(!cx)return;
        cx.clearRect(0,0,W,H);
        const kind=this.ovKind;
        for(let i=0;i<this.ovParts.length;i++){
            const p=this.ovParts[i];
            // ---- 运动 ----
            if(kind==='gold'){ // 小年：金粒自下方升起，到顶后回到屏幕底部重新开始
                p.y+=p.vy*dt;p.x+=p.vx*dt+Math.sin(gameClock*p.sw+p.ph)*8*dt;
                if(p.y<-16){p.y=H+12;p.x=duoRand(gameClock*10+i*3.7+1)*W}
            }else{ // 飘落类（leaf/heart）
                p.y+=p.vy*dt;p.x+=p.vx*dt+Math.sin(gameClock*p.sw+p.ph)*16*dt;
                if(p.rot!==undefined&&p.vr)p.rot+=p.vr*dt;
                if(p.y>H+20){p.y=-15;p.x=duoRand(gameClock*10+i*3.7+1)*W}
                if(p.x<-20)p.x=W+15;else if(p.x>W+20)p.x=-15;
            }
            // ---- 绘制 ----
            cx.save();cx.translate(p.x,p.y);
            switch(kind){
                case 'leaf':{ // 落叶：细长叶片 + 主叶脉 + 两条侧脉（端午青绿/清明冷青/重阳金黄，由 hue 区分）
                    cx.rotate(p.rot||0);
                    cx.fillStyle=`hsla(${p.hue},48%,40%,.85)`;
                    cx.beginPath();cx.moveTo(-p.s,0);
                    cx.quadraticCurveTo(-p.s*.4,-p.s*.5,p.s*.92,-p.s*.1);
                    cx.quadraticCurveTo(p.s,p.s*.06,p.s*.92,p.s*.16);
                    cx.quadraticCurveTo(-p.s*.4,p.s*.42,-p.s,0);
                    cx.closePath();cx.fill();
                    cx.strokeStyle=`hsla(${p.hue},42%,24%,.55)`;cx.lineWidth=1;
                    cx.beginPath();cx.moveTo(-p.s*.92,0);cx.lineTo(p.s*.88,.02);cx.stroke();
                    cx.beginPath();cx.moveTo(-p.s*.3,-p.s*.02);cx.lineTo(-p.s*.05,-p.s*.22);cx.moveTo(-p.s*.3,p.s*.04);cx.lineTo(-p.s*.05,p.s*.2);cx.stroke();
                    break;
                }
                case 'heart':{ // 七夕小爱心（粉/紫双色）
                    const s=p.s;
                    cx.fillStyle=p.purple?'rgba(186,142,255,.85)':'rgba(255,158,199,.85)';
                    cx.beginPath();cx.moveTo(0,s*.5);
                    cx.bezierCurveTo(-s,-s*.1,-s*.5,-s*.9,0,-s*.25);
                    cx.bezierCurveTo(s*.5,-s*.9,s,-s*.1,0,s*.5);cx.fill();
                    break;
                }
                case 'gold':{ // 小年：金色光点 + 闪烁 + 微光晕
                    const tw=.55+Math.abs(Math.sin(gameClock*3.2+p.tw))*.45;
                    cx.fillStyle=`rgba(255,205,96,${tw*.28})`;
                    cx.beginPath();cx.arc(0,0,p.r*2.4,0,6.283);cx.fill();
                    cx.fillStyle=`rgba(255,214,110,${tw})`;
                    cx.beginPath();cx.arc(0,0,p.r,0,6.283);cx.fill();
                    break;
                }
            }
            cx.restore();
        }
    }
};
// --- 元宵：灯笼漩涡贴图（红金水流 + 暖光核心） ---
const whirlLanternTex=mkTex(512,256,(x)=>{
    x.fillStyle='#4a0d0d';x.fillRect(0,0,512,256);
    for(let i=0;i<16;i++){const x0=i*32;
        x.strokeStyle='rgba(255,120,60,'+(.14+(i%3)*.06)+')';x.lineWidth=6+(i%4)*3;
        for(const ox of[-512,0,512]){x.beginPath();x.moveTo(x0+ox,0);x.bezierCurveTo(x0+ox+30,80,x0+ox-20,160,x0+ox+24,256);x.stroke()}}
});
whirlLanternTex.wrapS=whirlLanternTex.wrapT=THREE.RepeatWrapping;
const whirlLanternCoreTex=mkTex(128,128,(x)=>{const g=x.createRadialGradient(64,64,4,64,64,64);
    g.addColorStop(0,'rgba(255,190,90,1)');g.addColorStop(.55,'rgba(255,90,40,.95)');g.addColorStop(1,'rgba(120,12,10,0)');
    x.fillStyle=g;x.fillRect(0,0,128,128)});
// 漩涡中心漂浮的纸灯笼
function mkWhirlLantern(){
    // 莲花祈福灯：层叠花瓣 + 中央暖光烛芯（替代原红灯笼造型）
    const g=new THREE.Group();
    const petalMat=new THREE.MeshStandardMaterial({color:0xffb3c1,roughness:.42,emissive:0xff7a90,emissiveIntensity:.28,side:THREE.DoubleSide});
    const petalMatDeep=new THREE.MeshStandardMaterial({color:0xff8fa8,roughness:.45,emissive:0xe8546e,emissiveIntensity:.3,side:THREE.DoubleSide});
    const petalGeo=new THREE.SphereGeometry(.13,8,6,0,Math.PI*.62,0,Math.PI*.52); // 勺形花瓣
    // 两层花瓣：外层 8 片大敞，内层 6 片半合
    for(let layer=0;layer<2;layer++){
        const n=layer?6:8,rr=layer?.15:.22,tilt=layer?.5:1.02;
        for(let i=0;i<n;i++){
            const p=new THREE.Mesh(petalGeo,layer?petalMatDeep:petalMat);
            const a=i/n*Math.PI*2+layer*.4;
            p.scale.set(.62,1,1.15);
            p.rotation.set(tilt,a,0,'YXZ');
            p.position.set(Math.cos(a)*rr*.4,.02+layer*.05,Math.sin(a)*rr*.4);
            p.castShadow=true;g.add(p);
        }
    }
    // 花芯：金黄小莲蓬 + 中央暖光烛火
    const core=new THREE.Mesh(new THREE.SphereGeometry(.07,10,8),
        new THREE.MeshStandardMaterial({color:0xffd98a,roughness:.5,emissive:0xffb84d,emissiveIntensity:.5}));
    core.scale.set(1,.7,1);core.position.y=.1;g.add(core);
    const flame=new THREE.Mesh(new THREE.ConeGeometry(.035,.11,8),
        new THREE.MeshStandardMaterial({color:0xfff3c4,emissive:0xffca5f,emissiveIntensity:1.4}));
    flame.position.y=.2;g.add(flame);
    // 底部莲叶托（浅绿小圆盘，浮于水面）
    const pad=new THREE.Mesh(new THREE.CircleGeometry(.24,18),
        new THREE.MeshStandardMaterial({color:0x3f9d4e,roughness:.6,side:THREE.DoubleSide}));
    pad.rotation.x=-Math.PI/2;pad.position.y=-.06;g.add(pad);
    // 整体放大 4 倍（用户要求花灯比现在大 4 倍）
    g.scale.setScalar(4);
    return g;
}
// --- 端午：粽子（替代水草） ---
// 粽叶贴图：深绿叶底 + 平行叶脉 + 纵向色斑（手绘感）
let _zongziTex=null;
function getZongziTex(){
    if(_zongziTex)return _zongziTex;
    _zongziTex=mkTex(256,256,x=>{
        x.fillStyle='#2e7d32';x.fillRect(0,0,256,256);
        // 叶脉：从底边发散的浅色弧线
        for(let i=0;i<14;i++){
            x.strokeStyle=`rgba(120,190,110,${.22+(i%3)*.09})`;x.lineWidth=2+(i%2);
            x.beginPath();x.moveTo(i*19-10,262);
            x.bezierCurveTo(i*19+16,180,i*19-14,90,i*19+10,-6);x.stroke();
        }
        // 深浅色斑模拟粽叶叠压
        for(let i=0;i<9;i++){
            x.fillStyle=i%2?'rgba(24,88,28,.24)':'rgba(80,160,84,.16)';
            x.beginPath();x.ellipse((i*53)%256,(i*97)%256,26+(i%3)*10,60+(i%4)*16,(i*.7)%3.14,0,6.283);x.fill();
        }
    });
    _zongziTex.wrapS=_zongziTex.wrapT=THREE.RepeatWrapping;
    return _zongziTex;
}
function mkZongzi(x,z){
    const g=new THREE.Group();
    // 主体：四面体粽子（金字塔形，四个三角面，经典粽形）
    const bodyMat=new THREE.MeshStandardMaterial({map:getZongziTex(),roughness:.55,flatShading:false});
    // 用四面体几何体：底部是三角形，顶部收尖
    const bodyGeo=new THREE.ConeGeometry(.22,.38,3,1,true); // 3 边形 = 四面体
    const body=new THREE.Mesh(bodyGeo,bodyMat);
    body.rotation.y=Math.PI/6; // 让一个面正对前方
    body.position.y=.19;
    body.castShadow=true;g.add(body);
    // 叶子包裹感：在外层加一层半透明绿叶薄片（模拟粽叶外层）
    const leafWrap=new THREE.Mesh(new THREE.ConeGeometry(.23,.4,3,1,true),
        new THREE.MeshStandardMaterial({color:0x4a9c52,roughness:.6,transparent:true,opacity:.35,side:THREE.DoubleSide}));
    leafWrap.rotation.y=Math.PI/6+.1;leafWrap.position.y=.19;leafWrap.scale.set(1.02,1,1.02);g.add(leafWrap);
    // 顶部叶尖收束（粽子顶部通常有多余的叶子折下来）
    const topFold=new THREE.Mesh(new THREE.ConeGeometry(.06,.16,3),
        new THREE.MeshStandardMaterial({color:0x3d8b42,roughness:.5}));
    topFold.rotation.set(.35,Math.PI/3,.2);topFold.position.set(0,.4,.03);g.add(topFold);
    // 麻绳：三道环绕（贴合三角锥身），用 Torus 模拟绳子缠绕
    const ropeMat=new THREE.MeshStandardMaterial({color:0xcbb27a,roughness:.75});
    const mkRope=(ry,yy,r)=>{
        const rope=new THREE.Mesh(new THREE.TorusGeometry(r,.016,8,24),ropeMat);
        rope.rotateX(Math.PI/2);rope.rotateY(ry);rope.position.y=yy;g.add(rope);
    };
    // 三道绳：底部、中部、上部（贴合三角锥）
    mkRope(0,.1,.155);
    mkRope(Math.PI/3,.19,.138);
    mkRope(Math.PI*.66,.28,.11);
    // 侧面绳结（粽子侧面通常有个小结）
    const knot=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),ropeMat);
    knot.position.set(.15,.19,.02);g.add(knot);
    // 绳尾两小段垂下（更自然）
    const tailGeo=new THREE.CylinderGeometry(.008,.005,.11,5);
    const t1=new THREE.Mesh(tailGeo,ropeMat);t1.rotation.z=.6;t1.position.set(.16,.09,.03);g.add(t1);
    const t2=new THREE.Mesh(tailGeo,ropeMat);t2.rotation.set(.4,0,.8);t2.position.set(.15,.08,.045);g.add(t2);
    g.position.set(x,0,z);return g;
}
// --- 国庆：蛋糕（替代石头，撞碎得分） ---
function mkCake(p,s){
    const g=new THREE.Group();
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.5,.55,.34,14),
        new THREE.MeshStandardMaterial({color:0xfff1dd,roughness:.5}));
    base.position.y=.17;base.castShadow=true;g.add(base);
    const top=new THREE.Mesh(new THREE.CylinderGeometry(.4,.46,.2,14),
        new THREE.MeshStandardMaterial({color:0xff9db0,roughness:.45}));
    top.position.y=.44;top.castShadow=true;g.add(top);
    const cream=new THREE.Mesh(new THREE.SphereGeometry(.12,10,8),
        new THREE.MeshStandardMaterial({color:0xffffff,roughness:.4}));
    cream.position.y=.56;g.add(cream);
    const cherry=new THREE.Mesh(new THREE.SphereGeometry(.07,10,8),
        new THREE.MeshStandardMaterial({color:0xd91e36,roughness:.35}));
    cherry.position.y=.66;g.add(cherry);
    g.position.copy(p);g.scale.setScalar(s*1.4);
    return g;
}

// 生成今日祝福
Blessings.generate();
updateDebugBlessingStatus();

function getBlessingIconClass(blessing){
    return blessing?.icon||'fa-star';
}
function applyDuoBlessing(blessing){
    const base=Blessings.daily.find(item=>item.id===blessing?.id);
    if(!base)return;
    const mult=Number(blessing.mult);
    Blessings.current={
        ...base,
        mult:Number.isFinite(mult)?Math.max(1,Math.min(4,mult)):base.mult,
        isHoliday:!!blessing.isHoliday
    };
    if(typeof updateSettingsPanel==='function')updateSettingsPanel();
}

// 设置面板
let graphicsQuality=['low','mid','high'].includes(localStorage.getItem('duck_quality'))?localStorage.getItem('duck_quality'):(isMobile?'low':'mid');
function applyGraphicsQuality(level){
    graphicsQuality=['low','mid','high'].includes(level)?level:'high';
    const presets={
        low:{ratio:Math.min(devicePixelRatio,.85),wave:5,normals:24,environment:4,segments:36,shadows:false,shadowEvery:0},
        mid:{ratio:Math.min(devicePixelRatio,1),wave:4,normals:18,environment:3,segments:48,shadows:true,shadowEvery:4},
        high:{ratio:Math.min(devicePixelRatio*1.15,1.5),wave:3,normals:12,environment:2,segments:56,shadows:true,shadowEvery:3}
    };
    const preset=presets[graphicsQuality];
    quality.basePixelRatio=preset.ratio;quality.drsScale=1; // 切档时重置动态分辨率
    quality.renderPixelRatio=preset.ratio;
    quality.waveUpdateInterval=preset.wave;
    quality.waveNormalInterval=preset.normals;
    quality.environmentUpdateInterval=preset.environment;
    quality.shadowUpdateInterval=preset.shadowEvery;
    setWaveDetail(preset.segments);
    renderer.setPixelRatio(quality.renderPixelRatio);
    renderer.setSize(innerWidth,innerHeight);
    renderer.shadowMap.enabled=preset.shadows;
    renderer.shadowMap.autoUpdate=false;
    renderer.shadowMap.needsUpdate=true;
    if(typeof resizeEnvironment==='function')resizeEnvironment();
    localStorage.setItem('duck_quality',graphicsQuality);
}
function setSwitchState(id,on){
    const el=document.getElementById(id);
    el.classList.toggle('on',on);
    el.setAttribute('aria-checked',on?'true':'false');
}
function getDuckCustomPalette(){
    try{const p=JSON.parse(localStorage.getItem('duck_custom_palette')||'null');if(p&&p.body&&p.beak)return p}catch(e){}
    return{body:'#ffde76',beak:'#ff9a3d'};
}
function saveDuckCustomPalette(p){localStorage.setItem('duck_custom_palette',JSON.stringify(p))}
// 返回 {color,beak,wing} 十六进制字符串调色板（翅膀始终等于身体色）
// override 可选：用于双人模式同步对端自定义调色板 {body,beak}
function getDuckPalette(skin,override){
    if(skin==='custom'){const p=override||getDuckCustomPalette();return{color:p.body,beak:p.beak,wing:p.body}}
    const s=DUCK_SKINS[skin]||DUCK_SKINS.classic,hex=c=>'#'+c.toString(16).padStart(6,'0');
    return{color:hex(s.color),beak:hex(s.beak),wing:hex(s.color)};
}
let activeDuckSkin=isValidDuckSkin(localStorage.getItem('duck_skin'))?localStorage.getItem('duck_skin'):DEFAULT_DUCK_SKIN;
const duckSkinTextureCache=new Map();
function getDuckSkinTexture(source,skin,override){
    if(!source||skin==='classic')return source;
    const pal=getDuckPalette(skin,override);
    const key=source.uuid+'-'+skin+'-'+pal.color+pal.beak+pal.wing;
    if(duckSkinTextureCache.has(key))return duckSkinTextureCache.get(key);
    const image=source.image,w=image?.naturalWidth||image?.videoWidth||image?.width,h=image?.naturalHeight||image?.videoHeight||image?.height;
    if(!w||!h)return source;
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    try{ctx.drawImage(image,0,0,w,h)}catch(error){return source}
    let pixels;
    try{pixels=ctx.getImageData(0,0,w,h)}catch(error){return source}
    // 三区独立重着色：身体(hue~51°)/翅膀(hue~45°，贴图固定三块橙斑，用区域掩码区分)/
    // 嘴巴(hue~32°)。眼睛黑白、描线、高光不动；全部羽化混合，保留明暗体积感。
    const cBody=new THREE.Color(pal.color);cBody.offsetHSL(0,.06,.005);
    const cBeak=new THREE.Color(pal.beak),cWing=new THREE.Color(pal.wing);
    const br=Math.round(cBody.r*255),bg=Math.round(cBody.g*255),bb=Math.round(cBody.b*255);
    const kr=Math.round(cBeak.r*255),kg=Math.round(cBeak.g*255),kb=Math.round(cBeak.b*255);
    const wr=Math.round(cWing.r*255),wg=Math.round(cWing.g*255),wb=Math.round(cWing.b*255);
    const data=pixels.data,sx=w/512,sy=h/512;
    for(let i=0;i<data.length;i+=4){
        const r=data[i],g=data[i+1],b=data[i+2];
        const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
        if(mx<36||d<14)continue; // 黑眼睛/描线/近灰像素不动
        const l=(mx+mn)/510;
        if(l<.12||l>.93)continue; // 极暗部与纯白高光保持原样
        let h;
        if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;
        h*=60;if(h<0)h+=360;
        const s=(d/255)/(1-Math.abs(2*l-1));
        if(s<.16)continue; // 低饱和（白/灰/黑）不动
        // 嘴巴：强橙色 hue 20~42°，两侧 4° 羽化
        const wBeak=h<20?0:h<24?(h-20)/4:h<=38?1:h<42?1-(h-38)/4:0;
        // 黄色区域成员度（身体+翅膀共同的色相范围）
        const hw=h<40?0:h<44?(h-40)/4:h>82?h>92?0:1-(h-82)/10:1;
        // 翅膀区域掩码（贴图上三块固定橙斑的椭圆区域，软边）
        let wMask=0;
        if(hw>0){
            const nx=((i>>2)%w)/sx,ny=(Math.floor((i>>2)/w))/sy;
            for(let e=0;e<WING_BLOBS.length;e++){
                const bl=WING_BLOBS[e],ddx=(nx-bl[0])/bl[2],ddy=(ny-bl[1])/bl[3];
                const dd=Math.sqrt(ddx*ddx+ddy*ddy);
                const mm=dd<.72?1:dd>1.05?0:1-(dd-.72)/.33;
                if(mm>wMask)wMask=mm;
            }
        }
        const wWing=hw*wMask,wBody=hw*(1-wMask);
        const wSum=wBeak+wWing+wBody;
        if(wSum<=0)continue;
        // 饱和度羽化，避免边界色斑
        const sw=s<.3?(s-.16)/.14:1;
        const mixW=Math.min(1,wSum)*Math.min(1,sw);
        const light=(r*.2126+g*.7152+b*.0722)/255;
        // 保留原明暗体积感并拉开对比：暗部更深、高光更亮，搪胶质感更通透
        const shade=.42+Math.pow(light,.85)*.85;
        const inv=wSum>1?1/wSum:1;
        const tr=(kr*wBeak+wr*wWing+br*wBody)*inv,tg=(kg*wBeak+wg*wWing+bg*wBody)*inv,tb=(kb*wBeak+wb*wWing+bb*wBody)*inv;
        const nr=Math.min(255,Math.round(tr*shade)),ng=Math.min(255,Math.round(tg*shade)),nb=Math.min(255,Math.round(tb*shade));
        data[i]=Math.round(r+(nr-r)*mixW);
        data[i+1]=Math.round(g+(ng-g)*mixW);
        data[i+2]=Math.round(b+(nb-b)*mixW);
    }
    ctx.putImageData(pixels,0,0);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=source.colorSpace||THREE.SRGBColorSpace;texture.flipY=source.flipY;texture.wrapS=source.wrapS;texture.wrapT=source.wrapT;
    texture.magFilter=source.magFilter;texture.minFilter=source.minFilter;texture.anisotropy=source.anisotropy;texture.needsUpdate=true;
    duckSkinTextureCache.set(key,texture);return texture;
}
function applyDuckSkinToMaterial(material,skin,override){
    if(!material)return;
    const original=material.userData.duckOriginalMap||material.map||null;
    if(!original)return;
    material.userData.duckOriginalMap=original;
    material.map=getDuckSkinTexture(original,skin,override);
    if(material.color)material.color.set(0xffffff);
    if('roughness' in material)material.roughness=.5;
    if('metalness' in material)material.metalness=0;
    if('clearcoat' in material)material.clearcoat=.42;
    if('clearcoatRoughness' in material)material.clearcoatRoughness=.46;
    if('shininess' in material)material.shininess=24;
    material.needsUpdate=true;
}
function applyDuckSkinToRoot(root,skin,override){
    if(!root)return;
    const selected=isValidDuckSkin(skin)?skin:'classic';
    root.traverse(node=>{if(!node.isMesh||!node.material)return;
        const materials=Array.isArray(node.material)?node.material:[node.material];
        materials.forEach(material=>applyDuckSkinToMaterial(material,selected,override));
    });
}
function applyDuckSkin(skin){
    activeDuckSkin=isValidDuckSkin(skin)?skin:'classic';
    localStorage.setItem('duck_skin',activeDuckSkin);
    applyDuckSkinToRoot(duckModel,activeDuckSkin);
    if(typeof Duo!=='undefined'&&Duo.active){if(gameActive)Duo.sync();else Duo.syncProfile()}
}
function updateSettingsPanel(){
    const b=Blessings.current;
    if(b){
        document.getElementById('set-sb-icon').innerHTML=`<i class="fa-solid ${getBlessingIconClass(b)}"></i>`;
        document.getElementById('set-sb-name').textContent=b.name;
        const festival=Blessings.festival;
        document.getElementById('set-sb-desc').textContent=festival?`${b.desc} · ${festival.name}：${festival.desc}`:b.desc;
    }
    setSwitchState('set-music',musicOn);
    setSwitchState('set-sfx',sfxOn);
    setSwitchState('set-fps',document.getElementById('fps-hud').classList.contains('show'));
    document.querySelectorAll('#set-quality .seg-opt').forEach(el=>el.classList.toggle('sel',el.dataset.q===graphicsQuality));
    document.querySelectorAll('#set-skin .skin-opt').forEach(el=>el.classList.toggle('sel',el.dataset.skin===activeDuckSkin));
    // 自定义配色编辑器：选中"自定义"时展开，取色器回显当前调色板
    const customRow=document.getElementById('set-custom-skin-row');
    if(customRow){
        customRow.style.display=activeDuckSkin==='custom'?'flex':'none';
        const pal=getDuckCustomPalette();
        document.getElementById('csk-body').value=pal.body;
        document.getElementById('csk-beak').value=pal.beak;
    }
    document.getElementById('set-joy-row').style.display=isMobile?'flex':'none';
    document.getElementById('set-joy').value=Math.round(joySensitivity*100);
    document.getElementById('set-joy-val').textContent=joySensitivity.toFixed(1);
}
// openSettings / closeSettings 已迁移到 js/ui/overlays.js（通过 setOverlaysCtx 注入 updateSettingsPanel）
document.getElementById('settings-btn').onclick=window.openSettings;
document.getElementById('set-music').onclick=()=>{document.getElementById('music-btn').click();updateSettingsPanel()};
document.getElementById('set-sfx').onclick=()=>{sfxOn=!sfxOn;localStorage.setItem('duck_sfx',sfxOn?'1':'0');updateSettingsPanel()};
document.getElementById('set-fps').onclick=()=>{const hud=document.getElementById('fps-hud');hud.classList.toggle('show');localStorage.setItem('duck_fps',hud.classList.contains('show')?'1':'0');updateSettingsPanel()};
document.querySelectorAll('#set-quality .seg-opt').forEach(el=>el.onclick=()=>{applyGraphicsQuality(el.dataset.q);updateSettingsPanel()});
document.querySelectorAll('#set-skin .skin-opt').forEach(el=>el.onclick=()=>{applyDuckSkin(el.dataset.skin);updateSettingsPanel()});
// 自定义配色：拖动取色即实时上身并持久化
['body','beak'].forEach(part=>{
    const input=document.getElementById('csk-'+part);
    if(!input)return;
    input.oninput=()=>{
        const pal=getDuckCustomPalette();pal[part]=input.value;
        saveDuckCustomPalette(pal);
        applyDuckSkin('custom');
    };
});
document.getElementById('set-joy').oninput=e=>{joySensitivity=Number(e.target.value)/100;localStorage.setItem('duck_joy_sensitivity',String(joySensitivity));document.getElementById('set-joy-val').textContent=joySensitivity.toFixed(1)};
document.getElementById('set-retut').onclick=()=>{window.closeSettings();showTutorial()};
document.getElementById('set-help').onclick=()=>{window.closeSettings();document.getElementById('help').classList.add('show')};
applyGraphicsQuality(graphicsQuality);
if(localStorage.getItem('duck_fps')==='1')document.getElementById('fps-hud').classList.add('show');

// 今日祝福卡片（游戏开始时展示）
function showBlessingSplash(){
    const b=Blessings.current;
    if(!b)return;
    const splash=document.getElementById('blessing-splash');
    const holidayEl=document.getElementById('bs-holiday');
    document.getElementById('bs-icon').innerHTML=`<i class="fa-solid ${getBlessingIconClass(b)}"></i>`;
    document.getElementById('bs-name').textContent=b.name;
    document.getElementById('bs-desc').textContent=b.desc;
    // 节日加成独立成卡展示（图标+名称+祝福语+加成），和今日祝福同时生效。
    const festival=Blessings.festival;
    if(festival){
        document.getElementById('bh-icon').innerHTML=`<i class="fa-solid ${festival.icon||'fa-gift'}"></i>`;
        document.getElementById('bh-name').textContent=festival.name;
        document.getElementById('bh-greet').textContent=festival.greeting||'';
        document.getElementById('bh-buff').textContent='节日加成 · '+festival.desc;
        holidayEl.style.display='block';
    }else{
        holidayEl.style.display='none';
    }
    splash.classList.add('show');
    spawnBlessingFx(splash,festival);
    // 全屏展示由玩家点击任意位置关闭，避免短暂自动消失时来不及查看。
}
// 节日特效：全屏上升光点（颜色随节日主题，无节日时不生成）
function spawnBlessingFx(splash,festival){
    stopBlessingFx(splash);
    if(!festival)return;
    const layer=document.createElement('div');
    layer.className='bs-fx-layer';
    for(let i=0;i<28;i++){
        const p=document.createElement('i');
        p.className='fx-p';
        const size=(3+Math.random()*6).toFixed(1);
        p.style.setProperty('--fxc',festival.fx||'#ffd166');
        p.style.width=size+'px';p.style.height=size+'px';
        p.style.left=(4+Math.random()*92).toFixed(1)+'%';
        p.style.bottom=(-3+Math.random()*30).toFixed(1)+'%';
        // 前 1/3 粒子无延迟，弹窗一打开就能看到光点升起
        p.style.animationDelay=(i%3===0?Math.random()*.4:Math.random()*3.2).toFixed(2)+'s';
        p.style.animationDuration=(4.5+Math.random()*4).toFixed(2)+'s';
        layer.appendChild(p);
    }
    splash.appendChild(layer);
    splash._fxLayer=layer;
}
function stopBlessingFx(splash){
    splash=splash||document.getElementById('blessing-splash');
    if(splash&&splash._fxLayer){splash._fxLayer.remove();splash._fxLayer=null}
}
document.getElementById('blessing-splash').addEventListener('click',()=>{
    const splash=document.getElementById('blessing-splash');
    splash.classList.remove('show');
    stopBlessingFx(splash);
});

// ===== 成就 UI（已迁移到 js/ui/achievements.js） =====
window.showAchievements=showAchievements;
window.closeAchievements=closeAchievements;

// 新手教程（已迁移到 js/ui/overlays.js，此处仅保留 showTutorial 引用以便初始化调用）
// showTutorial 已通过 import 引入

// ===== 成就系统 =====
const Achievements={
    // 成就定义
    defs:[
        {id:'whirl_survivor',name:'漩涡幸存者',desc:'累计被漩涡吸入 10 次',icon:'fa-tornado',target:10,stat:'whirlDeaths',reward:{whirlResist:0.15}},
        {id:'score_master',name:'万分解锁者',desc:'单局得分超过 10000',icon:'fa-sack-dollar',target:10000,stat:'highScore',reward:{scoreBonus:0.10}},
        {id:'streak_king',name:'连胜大师',desc:'累计触发 20 次连胜',icon:'fa-fire',target:20,stat:'streaks',reward:{streakBonus:3}},
        {id:'iron_wall',name:'铁壁鸭',desc:'累计挡住 50 次伤害',icon:'fa-shield-halved',target:50,stat:'shieldBlocks',reward:{shieldBonus:0.20}},
        {id:'rich_duck',name:'富翁鸭',desc:'累计收集 1000 个道具',icon:'fa-gem',target:1000,stat:'totalItems',reward:{scoreBonus:0.10}},
        {id:'surfer',name:'冲浪鸭',desc:'累计移动 10km',icon:'fa-water',target:10000,stat:'totalDistance',reward:{speedBonus:0.05}},
        {id:'collector',name:'收集家',desc:'累计收集 500 个道具',icon:'fa-box-open',target:500,stat:'totalItems',reward:{scoreBonus:0.05}},
        {id:'survivor',name:'生存专家',desc:'单局存活超过 5 分钟',icon:'fa-stopwatch',target:300,stat:'playTime',reward:{maxHearts:1}},
        {id:'duck_master',name:'小黄鸭大师',desc:'解锁所有其他成就',icon:'fa-crown',target:7,stat:'achievements',reward:{scoreBonus:0.20}}
    ],
    // 玩家进度
    progress:{},
    // 已解锁的成就
    unlocked:{},
    // 加载进度
    load(){
        const saved=localStorage.getItem('achievements_data');
        if(saved){
            try{
                const data=JSON.parse(saved);
                this.progress=data.progress||{};
                this.unlocked=data.unlocked||{};
            }catch(e){}
        }
    },
    // 保存进度
    save(){
        localStorage.setItem('achievements_data',JSON.stringify({
            progress:this.progress,
            unlocked:this.unlocked
        }));
    },
    // 更新进度
    updateStat(stat,value){
        this.progress[stat]=(this.progress[stat]||0)+value;
        this.checkUnlocks();
    },
    // 设置进度（取最大值）
    setStat(stat,value){
        if(value>(this.progress[stat]||0)){
            this.progress[stat]=value;
            this.checkUnlocks();
        }
    },
    // 检查解锁
    checkUnlocks(){
        let newUnlock=false;
        for(const def of this.defs){
            if(this.unlocked[def.id])continue;
            const current=this.progress[def.stat]||0;
            if(current>=def.target){
                this.unlocked[def.id]=true;
                this.showUnlockToast(def);
                newUnlock=true;
            }
        }
        if(newUnlock)this.save();
    },
    // 显示解锁提示（全屏特效 + Toast）
    showUnlockToast(def){
        // 全屏解锁特效
        const fx=document.getElementById('ach-unlock-fx');
        if(fx){
            document.getElementById('ach-fx-icon').innerHTML=`<i class="fa-solid ${def.icon}"></i>`;
            document.getElementById('ach-fx-name').textContent=def.name;
            const r=def.reward||{};
            const parts=[];
            if(r.scoreBonus)parts.push('得分+'+Math.round(r.scoreBonus*100)+'%');
            if(r.speedBonus)parts.push('速度+'+Math.round(r.speedBonus*100)+'%');
            if(r.shieldBonus)parts.push('护盾+'+Math.round(r.shieldBonus*100)+'%');
            if(r.whirlResist)parts.push('漩涡抗性+'+Math.round(r.whirlResist*100)+'%');
            if(r.streakBonus)parts.push('连胜+'+r.streakBonus+'s');
            if(r.maxHearts)parts.push('生命+'+r.maxHearts);
            document.getElementById('ach-fx-reward').innerHTML=parts.length?'<i class="fa-solid fa-gift"></i> '+parts.join(' · '):'';
            fx.classList.add('show');
            setTimeout(()=>fx.classList.remove('show'),2600);
        }
        // Toast 提示
        toast(`<i class="fa-solid fa-trophy"></i> 成就解锁：${def.name}`,'s');
        // 成就按钮高亮（提示有新成就可查看）
        const btn=document.getElementById('ach-btn');
        if(btn)btn.classList.add('has-new');
    },
    // 获取成就奖励总和
    getRewards(){
        const rewards={scoreBonus:0,speedBonus:0,shieldBonus:0,whirlResist:0,streakBonus:0,maxHearts:0};
        for(const id in this.unlocked){
            const def=this.defs.find(d=>d.id===id);
            if(def&&def.reward){
                for(const k in def.reward){
                    rewards[k]=(rewards[k]||0)+def.reward[k];
                }
            }
        }
        return rewards;
    },
    // 获取成就列表（用于 UI）
    getList(){
        return this.defs.map(def=>({
            ...def,
            unlocked:!!this.unlocked[def.id],
            current:this.progress[def.stat]||0,
            progress:Math.min(1,((this.progress[def.stat]||0)/def.target))
        }));
    }
};

// 加载成就进度
Achievements.load();
// 注入成就 UI 依赖
// isPaused/gameActive 是 let 变量，传 getter 函数；togglePause 是 window 后赋值，传 lazy wrapper
setAchievementsCtx({
    Achievements,
    isPaused:()=>isPaused,
    gameActive:()=>gameActive,
    togglePause:(...args)=>window.togglePause(...args)
});

let gameClock=0,frameCount=0;const clock=new THREE.Clock();setCartoonSky(12);
let fpsAccum=0,fpsFrames=0,fpsValue=60;
(function loop(){requestAnimationFrame(loop);
    const dt=Math.min(clock.getDelta(),.05);
    // FPS 统计（即使暂停也统计，因为仍在渲染）
    fpsAccum+=dt;fpsFrames++;
    if(fpsAccum>=0.5){
        fpsValue=Math.round(fpsFrames/fpsAccum);
        fpsAccum=0;fpsFrames=0;
        const fpsEl=document.getElementById('fps-hud');
        if(fpsEl.classList.contains('show')){
            fpsEl.querySelector('.fps-val').textContent=fpsValue;
            fpsEl.className='fps-hud show'+(fpsValue<30?' bad':fpsValue<50?' warn':'');
        }
    }
    // 动态分辨率（DRS）：帧率低时自动降低渲染像素比，充裕时回升，4060/核显都稳住帧率
    quality.drsTimer+=dt;
    if(quality.drsTimer>1.5){
        quality.drsTimer=0;
        if(fpsValue<46&&quality.drsScale>.62){quality.drsScale=Math.max(.6,quality.drsScale-.15);applyDRS({sizeStormCv:resizeEnvironment})}
        else if(fpsValue>57&&quality.drsScale<1){quality.drsScale=Math.min(1,quality.drsScale+.1);applyDRS({sizeStormCv:resizeEnvironment})}
    }
    // 暂停时不更新游戏逻辑
    if(isPaused){
        renderer.render(scene,camera);
        return;
    }
    frameCount++;
    gameClock+=dt;timeOfDay=(timeOfDay+dt*TIME_SPEED/60)%24;
// 波浪相位独立推进：暴风雨/海浪事件加速，平静时刻减速（平滑过渡）
waterUpdatePhase(dt,waveSpeedTarget);
// 暴风雨强度 / 闪电余晖 平滑过渡
stormFactor+=((stormActive?1:0)-stormFactor)*Math.min(1,dt*.9);
lightningFlash=Math.max(0,lightningFlash-dt*2.6);
if(duckSink.state==='none')updateDuck(dt);updateDuoRemoteDuck(dt);updateDuckSink(dt);updateCam(dt);updateGlobalEvent(dt);updateShark(dt);trySpawnHeart(dt);updateTransientFx(dt);FestivalFx.update(dt);
if(frameCount%quality.environmentUpdateInterval===0){const envDt=dt*quality.environmentUpdateInterval;setCartoonSky(timeOfDay);updateClouds(envDt);updateStormFx(envDt);updateSkyAmbience(envDt);updateSkyFx(envDt)}
// 调试面板实时状态更新（每 6 帧刷新一次降低开销）
if(frameCount%6===0){
    const dbgCur=document.getElementById('dbg-cur');
    if(dbgCur)dbgCur.textContent=activeEvent?EVENTS[activeEvent].n:'无';
    const dbgT=document.getElementById('dbg-timer');
    if(dbgT)dbgT.textContent=activeEvent?Math.ceil(activeEventTime)+'s':Math.ceil(Math.max(0,globalEventTimer))+'s';
    // 注：hearts/score 输入显示在面板打开时初始化一次，避免每帧覆盖用户输入导致应用修改无效
}
if(duckModel){waterFollowTarget(duckModel.position.x,duckModel.position.z);arrowPlane.position.x=duckModel.position.x;arrowPlane.position.z=duckModel.position.z}
// 波浪动画（顶点按世界坐标采样 waveHeight，与鸭子/道具完全同步）
// 更新后定格 renderedWaveClock：鸭子/道具/涟漪/鲨鱼都以它采样，与渲染浪面严格一致
waterUpdateVertices(gameClock);
// 漩涡更新放在水面网格之后：贴图重采样总能读到最新顶点（同节奏闸口在函数内部）
updateWhirlpools(dt);
// 方向箭头贴合浪面起伏（以渲染时钟采样，与水面网格严格一致）
if(arrowPlane.material.opacity>.01){const ap=arrowPlane.geometry.attributes.position;for(let i=0;i<ap.count;i++){const lx=ap.getX(i),ly=ap.getY(i);ap.setZ(i,waveHeight(lx+arrowPlane.position.x,-ly+arrowPlane.position.z,renderedWaveClock)+.14)}ap.needsUpdate=true}
// 花朵/海草/荷叶随海浪漂浮
for(const it of items){if(it.coll)continue;const ix=it.mesh.position.x,iz=it.mesh.position.z;const floatY=waveHeight(ix,iz,renderedWaveClock);
// 掉落动画（道具雨）：重力加速下落 + 旋转，到达水面后恢复正常漂浮
if(it.falling!==undefined&&it.falling>0){
    it.fallVy=(it.fallVy||0)-12*dt; // 重力加速度
    it.mesh.position.y+=it.fallVy*dt;
    it.mesh.rotation.x+=dt*3;it.mesh.rotation.z+=dt*2.5; // 翻滚旋转
    const targetY=it.type==='lily'?floatY+.04:it.type==='heart'?floatY+.4:floatY;
    if(it.mesh.position.y<=targetY){it.mesh.position.y=targetY;it.mesh.rotation.x=0;it.mesh.rotation.z=0;it.falling=0}
    continue;
}
// 磁吸牵引：道具轻微浮起 + 自旋（magT 在磁铁吸引时充能，平时衰减）
it.magT=Math.max(0,(it.magT||0)-dt*1.5);const mLift=it.magT*it.magT*.55,itSpin=it.magT*dt*5;
if(it.type==='lily'){it.mesh.position.y=floatY+.04+mLift;it.mesh.rotation.z=Math.sin(gameClock*1.2+ix)*.06;it.mesh.rotation.x=Math.cos(gameClock*1.0+iz)*.06;it.mesh.rotation.y+=itSpin}else if(it.type==='flower'){it.mesh.position.y=floatY-.02+mLift;it.mesh.rotation.z=Math.sin(gameClock*1.5+ix*2)*.08;it.mesh.rotation.x=Math.cos(gameClock*1.3+iz*2)*.05;it.mesh.rotation.y+=itSpin}else if(it.type==='grass'){it.mesh.position.y=floatY-.06+mLift;it.mesh.rotation.z=Math.sin(gameClock*2+ix*3)*.1;it.mesh.rotation.x=Math.cos(gameClock*1.8+iz*3)*.06;it.mesh.rotation.y+=itSpin}else if(it.type==='rock'){it.mesh.position.y=floatY-.12}else if(it.type==='heart'){it.mesh.position.y=floatY+.4+mLift+Math.sin(gameClock*2+ix)*.12;it.mesh.rotation.y=gameClock*1.6}else if(it.type==='magnet'){it.mesh.position.y=floatY+.65+mLift;it.mesh.rotation.y=gameClock*1.2+it.magT*2}}
// 连胜边框柔和呼吸
if(streakActive){const s=.5+Math.sin(gameClock*2)*.5;document.getElementById('combo-border').style.opacity=s}
controls.update();
// 画面抖动：无护盾受伤时相机随机偏移，幅度随时长衰减（每帧在 controls 之后应用，不累积）
if(screenShakeT>0){screenShakeT-=dt;const sk=Math.max(0,screenShakeT)/.35;camera.position.x+=(Math.random()-.5)*.3*sk;camera.position.y+=(Math.random()-.5)*.22*sk}
// 吸入结束后滤镜继续旋转着褪去（sinkFx 衰减到 0）
if(duckSink.state==='none'&&sinkFx>0)sinkFx=Math.max(0,sinkFx-dt*.9);
// 阴影比主画面更昂贵：按画质每 2–3 帧更新一次，动态物体仍有稳定阴影。
if(renderer.shadowMap.enabled&&quality.shadowUpdateInterval>0&&frameCount%quality.shadowUpdateInterval===0)renderer.shadowMap.needsUpdate=true;
// 漩涡吸入时走后处理滤镜（涡旋+模糊+暗角），平时直渲
if(sinkFx>0.004){
    swirlPostfx.render(sinkFx);
}else{
    renderer.render(scene,camera);
}
})();
addEventListener('resize',()=>resizeRuntime(innerWidth,innerHeight,swirlPostfx));
// 节日覆盖层画布跟随窗口尺寸（全屏粒子特效不因窗口变化而只覆盖一角）
addEventListener('resize',()=>{for(const cv of[FestivalFx.fwCv,FestivalFx.snowCv,FestivalFx.ovCv]){if(cv){cv.width=innerWidth;cv.height=innerHeight}}});