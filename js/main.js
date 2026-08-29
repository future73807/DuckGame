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
import {createFestivalScreenFx,FESTIVAL_SCREEN_FX_IDS,FESTIVAL_SCREEN_FX_THEMES} from './render/festival-screen-fx.js';
import {createRunStats,recordCollection,resetCollectionChain,recordComboMultiplier,beginLowHealth,finishLowHealth,selectRunHighlight,createNearMissState,updateNearMissState,criticalHeartPolicy,shouldSpawnHeart,isDownHostSceneCaretaker,circleClearance,selectSafeHeartCandidate,isOutsideAllPlayerRanges} from './core/run-feedback.js';
import {initDuoSceneSync,duoItemsHash,duoSceneStats,duoIsGuest,duoIsDownHostCaretaker,duoQueueCollectedItem,duoPendingCollectionIds,duoApplyGuestCollections,resetDuoSceneSync,resetDuoHostSceneBase,setDuoNextItemId,updateDuoClock,duoSerializeScene,duoBuildHostSceneUpload,duoAcceptHostSceneAck,duoReconcileWhirls,duoApplyScene} from './duo/scene-sync.js';
import {initDuoRemoteDuck,duoRemoteDuck,duoRemoteTarget,duoLocalNameLabel,duoRemoteSkin,duoRemotePalette,setDuoRemoteIdentity,resetDuoRemoteMotion,acceptDuoRemoteSnapshot,removeDuoLocalNameLabel,setDuoRemoteNameLabel,setDuoLocalNameLabel,removeDuoRemoteDuck,createDuoRemoteDuck,updateDuoRemoteDuck,duoRemoteDebugFxSnapshot} from './duo/remote-duck.js';
import {initDebugPanel,dbgSpawnItem,updateDebugBlessingStatus} from './debug/panel.js';
import {joySensitivity,setJoySensitivity,initControls} from './input/controls.js';

// ===== 检测 =====
const isMobile=/Mobi|Android|iPhone/i.test(navigator.userAgent)||('ontouchstart' in window&&innerWidth<1024);
const storedFestivalMotion=localStorage.getItem('duck_reduce_festival_motion');
let reduceFestivalMotion=storedFestivalMotion===null?!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches:storedFestivalMotion==='1';
let rotateHintActive=false;
function checkO(){rotateHintActive=isMobile&&innerHeight>innerWidth;document.getElementById('rotate-hint').style.display=rotateHintActive?'flex':'none';return!rotateHintActive}
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
// ===== 调试面板（已迁移至 js/debug/panel.js） =====

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
const{waveHeight,renderedWaveHeight,mkWaveRing,mkWaveDisk,setWaveDetail,updatePhase:waterUpdatePhase,followTarget:waterFollowTarget,updateVertices:waterUpdateVertices,getUpdateStats:waterGetUpdateStats,waterMesh,waveMesh,waterMat,waterColDeep,waterColLight,waterColFoam}=createWater({scene,quality,getFrameCount:()=>frameCount,getWaveEventDir:()=>waveEventDir,state:waterState});
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
const {setCartoonSky,updateClouds,updateStormFx,updateSkyFx,updateSkyAmbience,getStormSync,applyStormSync,getStormDebug,cycleTime,setTime,resize:resizeEnvironment,sunLight:envSunLight}=createEnvironment({
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
const RESPAWNING_ITEM_TYPES=new Set(['flower','grass','lily']);
const itemResourceStats={disposeCalls:0,sharedSkips:0,geometriesDisposed:0,materialsDisposed:0};
// playStartTime 提前声明（用于难度递进计算），后续在 gameActive 段重新赋值
let playStartTime=Date.now();
function disposeItemVisual(item){
    if(!item)return;
    if(item.respawnTimer){clearTimeout(item.respawnTimer);item.respawnTimer=null}
    item.respawning=false;
    const root=item.mesh||item;
    // 节日道具实例共享模板的 Geometry / Material；单个实例移除时不能释放共享资源。
    if(!root)return;
    if(root.userData?.sharedItemResources){itemResourceStats.sharedSkips++;return}
    const geometries=new Set(),materials=new Set();
    root.traverse?.(node=>{
        if(node.geometry)geometries.add(node.geometry);
        if(node.material){const mats=Array.isArray(node.material)?node.material:[node.material];for(const mat of mats)if(mat)materials.add(mat)}
    });
    for(const geometry of geometries)geometry.dispose();
    // 贴图由全局/节日缓存持有；这里只释放实例材质，避免误伤仍在场景中的其他物件。
    for(const material of materials)material.dispose();
    itemResourceStats.disposeCalls++;itemResourceStats.geometriesDisposed+=geometries.size;itemResourceStats.materialsDisposed+=materials.size;
}
function removeItemAt(index){
    const item=items[index];if(!item)return;
    scene.remove(item.mesh);disposeItemVisual(item);items.splice(index,1);
}
function mkRock(p,s){const g=new THREE.DodecahedronGeometry(1,1);const a=g.attributes.position;for(let i=0;i<a.count;i++){let x=a.getX(i),y=a.getY(i),z=a.getZ(i);const n=Math.sin(x*3.7)*Math.cos(y*2.3)*Math.sin(z*4.1)*.15;x+=n;y+=n*.5;z+=n;y*=.55;a.setXYZ(i,x,y,z)}g.computeVertexNormals();const tint=.92+Math.random()*.16;const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:new THREE.Color(0x8d8177).multiplyScalar(tint),roughness:.85,flatShading:true}));m.position.copy(p);m.scale.setScalar(s);m.rotation.set(Math.random(),Math.random(),0);m.castShadow=true;m.receiveShadow=true;return m}
function bakeItemPart(geometry,configure){
    const transform=new THREE.Object3D();
    configure(transform);transform.updateMatrix();geometry.applyMatrix4(transform.matrix);
    return geometry;
}
function colorItemPart(geometry,color){
    const c=new THREE.Color(color),count=geometry.attributes.position.count,colors=new Float32Array(count*3);
    for(let i=0;i<count;i++){colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b}
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));return geometry;
}

// 水草原先每片叶子都是一个 Mesh，最坏俯视角会把约 600 个叶片分别提交给 GPU。
// 每丛把 5–8 片同材质叶子烘焙成一个网格，并缓存两种形态；实例只共享资源和随机旋转。
const grassTemplates=new Map();
const grassMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,side:THREE.DoubleSide});
function buildGrassTemplate(n){
    const parts=[],cRoot=new THREE.Color(0x1d5c22),cTip=new THREE.Color(0x8fdd55),cc=new THREE.Color();
    for(let i=0;i<n;i++){
        const h=.4+Math.random()*.35,w=.05+Math.random()*.035;
        const geo=new THREE.PlaneGeometry(w,h,1,6),a=geo.attributes.position;
        const cols=new Float32Array(a.count*3),bend=(Math.random()-.5)*.4;
        for(let j=0;j<a.count;j++){
            let px=a.getX(j);const py=a.getY(j),t=py/h+.5;
            px*=1-t*.85;px+=t*t*bend;a.setX(j,px);
            cc.copy(cRoot).lerp(cTip,t);cols[j*3]=cc.r;cols[j*3+1]=cc.g;cols[j*3+2]=cc.b;
        }
        geo.setAttribute('color',new THREE.BufferAttribute(cols,3));geo.computeVertexNormals();
        bakeItemPart(geo,o=>{o.position.set((Math.random()-.5)*.6,h*.5,(Math.random()-.5)*.6);o.rotation.y=Math.random()*Math.PI});
        parts.push(geo);
    }
    const merged=mergeGeometries(parts,false);parts.forEach(geometry=>geometry.dispose());
    if(!merged)throw new Error('水草几何合并失败');
    merged.computeBoundingSphere();
    const mesh=new THREE.Mesh(merged,grassMat);
    // 水草叶片很小，投影会令中画质的阴影 pass 再次提交数百次，视觉收益却几乎不可见。
    mesh.castShadow=false;
    const group=new THREE.Group();group.add(mesh);group.userData.sharedItemResources=true;
    return group;
}
function mkGrass(x,z,n){
    const count=THREE.MathUtils.clamp(Math.round(n)||7,5,8),variant=Math.random()<.5?0:1,key=count+'|'+variant;
    if(!grassTemplates.has(key))grassTemplates.set(key,buildGrassTemplate(count));
    const instance=grassTemplates.get(key).clone(true);
    instance.userData.sharedItemResources=true;instance.position.set(x,0,z);instance.rotation.y=Math.random()*Math.PI*2;
    return instance;
}

// 荷叶/荷花烘焙为一个顶点色 Mesh：轮廓和颜色不变，最坏俯视角每片荷叶只提交一次。
const LILY_TEMPLATE_SIZE=.4;
let lilyTemplate=null;
function buildLilyTemplate(){
    const s=LILY_TEMPLATE_SIZE,g=new THREE.Group();
    const pg=new THREE.CircleGeometry(s,24,0,Math.PI*1.85),pa=pg.attributes.position,pcols=new Float32Array(pa.count*3);
    const cIn=new THREE.Color(0x46a857),cOut=new THREE.Color(0x1e6b31),cc=new THREE.Color();
    for(let i=0;i<pa.count;i++){
        const px=pa.getX(i),py=pa.getY(i),r=Math.min(Math.hypot(px,py)/s,1);
        pa.setZ(i,r*r*.14*s);cc.copy(cIn).lerp(cOut,r);pcols[i*3]=cc.r;pcols[i*3+1]=cc.g;pcols[i*3+2]=cc.b;
    }
    pg.setAttribute('color',new THREE.BufferAttribute(pcols,3));pg.computeVertexNormals();
    bakeItemPart(pg,o=>{o.rotation.x=-Math.PI/2});
    const parts=[pg];
    for(let i=0;i<6;i++){
        const a=i/6*Math.PI*2,geo=new THREE.SphereGeometry(s*.22,10,8);
        bakeItemPart(geo,o=>{o.scale.set(1,.42,1.6);o.position.set(Math.cos(a)*s*.2,s*.13,Math.sin(a)*s*.2);o.rotation.y=Math.PI/2-a;o.rotateX(-.35)});
        parts.push(colorItemPart(geo,0xff9ec7));
    }
    const heartGeo=new THREE.SphereGeometry(s*.13,10,8);
    bakeItemPart(heartGeo,o=>{o.position.y=s*.16;o.scale.y=.75});parts.push(colorItemPart(heartGeo,0xffd94d));
    const merged=mergeGeometries(parts,false);parts.forEach(geometry=>geometry.dispose());
    if(!merged)throw new Error('荷叶几何合并失败');
    merged.computeBoundingSphere();
    const mesh=new THREE.Mesh(merged,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.5,side:THREE.DoubleSide}));
    mesh.receiveShadow=true;g.add(mesh);
    g.userData.sharedItemResources=true;return g;
}
function mkLily(x,z,s){
    if(!lilyTemplate)lilyTemplate=buildLilyTemplate();
    const instance=lilyTemplate.clone(true);
    instance.userData.sharedItemResources=true;instance.position.set(x,.01,z);instance.scale.setScalar(s/LILY_TEMPLATE_SIZE);
    return instance;
}

// 花朵的茎/叶/花瓣/花心统一烘焙成一个顶点色 Mesh；小尺寸下保留颜色和轮廓最重要。
let flowerTemplate=null;
function buildFlowerTemplate(){
    const g=new THREE.Group(),parts=[];
    const stemGeo=new THREE.CylinderGeometry(.015,.02,.5,8);
    bakeItemPart(stemGeo,o=>{o.position.y=.25});parts.push(colorItemPart(stemGeo,0x2a6a2a));
    for(const side of[-1,1]){
        const geo=new THREE.SphereGeometry(.07,8,6);
        bakeItemPart(geo,o=>{o.scale.set(1.7,.25,.7);o.position.set(side*.09,.16,0);o.rotation.z=side*.5});parts.push(colorItemPart(geo,0x3f8f3f));
    }
    for(let i=0;i<8;i++){
        const a=i/8*Math.PI*2,geo=new THREE.SphereGeometry(.07,10,8);
        bakeItemPart(geo,o=>{o.scale.set(1,.4,1.7);o.position.set(Math.cos(a)*.1,.5,Math.sin(a)*.1);o.rotation.y=Math.PI/2-a;o.rotateX(-.3)});parts.push(colorItemPart(geo,0xffd93c));
    }
    const coreGeo=new THREE.SphereGeometry(.055,12,10);
    bakeItemPart(coreGeo,o=>{o.position.y=.52;o.scale.y=.7});parts.push(colorItemPart(coreGeo,0xff8c1a));
    const merged=mergeGeometries(parts,false);parts.forEach(geometry=>geometry.dispose());
    if(!merged)throw new Error('花朵几何合并失败');
    merged.computeBoundingSphere();g.add(new THREE.Mesh(merged,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.5})));
    g.userData.sharedItemResources=true;return g;
}
function mkFlower(x,z){
    if(!flowerTemplate)flowerTemplate=buildFlowerTemplate();
    const instance=flowerTemplate.clone(true);
    instance.userData.sharedItemResources=true;instance.position.set(x,-.02,z);instance.rotation.y=Math.random()*Math.PI*2;
    return instance;
}
// 磁铁只构建一次共享模板：避免每次刷新都重新创建高细分 TubeGeometry、贴图和材质。
// 轮廓仍保持一眼可辨的马蹄形，但用磁极套筒、N/S 铭牌、能量徽记和双层磁场弧补足近景细节。
let magnetTemplate=null;
function buildMagnetTemplate(){
    const g=new THREE.Group(),poleLen=.52,poleR=.14,gap=.23,tubularSeg=64,radialSeg=14;
    const pts=[
        new THREE.Vector3(-poleLen,0,-gap),new THREE.Vector3(-.28,0,-gap),new THREE.Vector3(-.06,0,-gap)
    ];
    for(let i=1;i<18;i++){const a=Math.PI*i/18;pts.push(new THREE.Vector3(gap*Math.sin(a),0,-gap*Math.cos(a)))}
    pts.push(new THREE.Vector3(-.06,0,gap),new THREE.Vector3(-.28,0,gap),new THREE.Vector3(-poleLen,0,gap));
    const curve=new THREE.CatmullRomCurve3(pts,false,'catmullrom',.42);
    const tubeGeo=new THREE.TubeGeometry(curve,tubularSeg,poleR,radialSeg,false);
    // 主体用顶点色在红极—深钢弧—蓝极间柔和过渡，只需一次 draw call。
    const bodyColors=new Float32Array(tubeGeo.attributes.position.count*3),red=new THREE.Color(0xf0445e),steel=new THREE.Color(0x52647d),blue=new THREE.Color(0x3f83ef),mixed=new THREE.Color();
    for(let i=0;i<tubeGeo.attributes.position.count;i++){
        const t=Math.floor(i/(radialSeg+1))/tubularSeg;
        if(t<.43)mixed.copy(red);else if(t<.5)mixed.copy(red).lerp(steel,(t-.43)/.07);else if(t<.57)mixed.copy(steel).lerp(blue,(t-.5)/.07);else mixed.copy(blue);
        bodyColors[i*3]=mixed.r;bodyColors[i*3+1]=mixed.g;bodyColors[i*3+2]=mixed.b;
    }
    tubeGeo.setAttribute('color',new THREE.BufferAttribute(bodyColors,3));
    const bodyMat=new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.25,metalness:.2,clearcoat:.78,clearcoatRoughness:.2,emissive:0x15192a,emissiveIntensity:.18});
    const chromeMat=new THREE.MeshPhysicalMaterial({color:0xeaf4ff,roughness:.14,metalness:.94,clearcoat:.9,clearcoatRoughness:.12});
    const goldMat=new THREE.MeshPhysicalMaterial({color:0xffd55b,roughness:.22,metalness:.72,clearcoat:.65,emissive:0x7d4b00,emissiveIntensity:.3});
    const body=new THREE.Mesh(tubeGeo,bodyMat);body.castShadow=true;body.receiveShadow=true;g.add(body);

    // 两端抛光磁极套筒，比原来的球形封帽更像精制玩具，也遮住 TubeGeometry 的开口。
    const collarParts=[];
    for(const side of[-1,1]){
        const geo=new THREE.CylinderGeometry(poleR*1.13,poleR*1.13,.21,18,1,false);
        bakeItemPart(geo,o=>{o.rotation.z=Math.PI/2;o.position.set(-poleLen+.015,0,side*gap)});collarParts.push(geo);
    }
    const mergedCollars=mergeGeometries(collarParts,false);collarParts.forEach(geo=>geo.dispose());
    if(!mergedCollars)throw new Error('磁铁磁极几何合并失败');
    const collars=new THREE.Mesh(mergedCollars,chromeMat);collars.castShadow=true;g.add(collars);

    // N/S 共用一张 atlas、一个合并网格；真正的字母在俯视镜头中也清晰可辨。
    const poleTex=mkTex(192,96,(ctx)=>{
        const labels=[['N','#e52f4c',48],['S','#2879e6',144]];
        for(const[letter,color,cx]of labels){
            const grd=ctx.createRadialGradient(cx,42,5,cx,48,43);grd.addColorStop(0,'#ffffff');grd.addColorStop(.72,'#eaf4ff');grd.addColorStop(1,'#9fb2c8');
            ctx.fillStyle=grd;ctx.beginPath();ctx.arc(cx,48,42,0,Math.PI*2);ctx.fill();ctx.lineWidth=5;ctx.strokeStyle=color;ctx.stroke();
            ctx.fillStyle=color;ctx.font='900 52px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(letter,cx,51);
        }
    });
    poleTex.colorSpace=THREE.SRGBColorSpace;
    const labelParts=[];
    for(let i=0;i<2;i++){
        const geo=new THREE.PlaneGeometry(.174,.174),uv=geo.attributes.uv;
        for(let v=0;v<uv.count;v++)uv.setX(v,(uv.getX(v)+i)*.5);
        bakeItemPart(geo,o=>{o.rotation.y=-Math.PI/2;o.position.set(-poleLen-.107,0,i===0?-gap:gap)});labelParts.push(geo);
    }
    const mergedLabels=mergeGeometries(labelParts,false);labelParts.forEach(geo=>geo.dispose());
    if(!mergedLabels)throw new Error('磁铁铭牌几何合并失败');
    const poleLabels=new THREE.Mesh(mergedLabels,new THREE.MeshBasicMaterial({map:poleTex,transparent:true,depthWrite:false,side:THREE.DoubleSide}));poleLabels.renderOrder=6;g.add(poleLabels);

    // 弧背上的金边闪电徽记合为一个网格，保留细节而不增加 draw call。
    const badgeParts=[],rimGeo=new THREE.TorusGeometry(.112,.018,7,24);
    bakeItemPart(rimGeo,o=>{o.rotation.x=Math.PI/2;o.position.set(.205,.153,0)});badgeParts.push(rimGeo);
    const boltShape=new THREE.Shape();boltShape.moveTo(-.025,.11);boltShape.lineTo(.065,.11);boltShape.lineTo(.012,.025);boltShape.lineTo(.078,.025);boltShape.lineTo(-.055,-.12);boltShape.lineTo(-.012,-.025);boltShape.lineTo(-.075,-.025);boltShape.closePath();
    const boltGeo=new THREE.ShapeGeometry(boltShape);bakeItemPart(boltGeo,o=>{o.rotation.x=-Math.PI/2;o.position.set(.205,.156,0);o.scale.setScalar(.78)});badgeParts.push(boltGeo);
    const mergedBadge=mergeGeometries(badgeParts,false);badgeParts.forEach(geo=>geo.dispose());
    if(!mergedBadge)throw new Error('磁铁徽记几何合并失败');g.add(new THREE.Mesh(mergedBadge,goldMat));

    // 道具自身的轻量磁力弧，使用共享几何/材质，不产生逐帧对象和额外 GC。
    const arcParts=[],arcColors=[0x73dcff,0xb58aff];
    for(let i=0;i<2;i++){
        const geo=colorItemPart(new THREE.TorusGeometry(.57,.012,4,40,Math.PI*1.55),arcColors[i]);
        bakeItemPart(geo,o=>{o.rotation.x=Math.PI/2;o.rotation.y=i*Math.PI;o.position.y=-.025+i*.035});arcParts.push(geo);
    }
    const mergedArcs=mergeGeometries(arcParts,false);arcParts.forEach(geo=>geo.dispose());
    if(!mergedArcs)throw new Error('磁铁磁力弧几何合并失败');
    const arcs=new THREE.Mesh(mergedArcs,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));arcs.renderOrder=5;g.add(arcs);
    g.userData.sharedItemResources=true;return g;
}
function mkMagnet(x,z){
    if(!magnetTemplate)magnetTemplate=buildMagnetTemplate();
    const instance=magnetTemplate.clone(true);
    instance.userData.sharedItemResources=true;instance.userData.idlePhase=Math.random()*Math.PI*2;instance.position.set(x,0,z);
    return instance;
}

// 动态刷新
// SPAWN_R 由 32 扩大到 64，覆盖区域为原来的 4 倍（π·r²）
// 同时大幅提高目标数量，让刷新更密集（鸭子周围一圈始终有充足道具）
const SPAWN_R=64,DESPAWN_R=100,MAX_I=1200;
const MAGNET_RANGE=16,MAGNET_DURATION=12;// 磁铁吸引范围16单位（减半），持续12秒
const COMBO_MAGNET_RANGE=8,COMBO_MAGNET_DURATION=2;
const COMBO_MAGNET_TYPES=new Set(['flower','grass','lily']);
const OPENING_GRACE_DURATION=20;
let magnetTimer=0,magnetActive=false,comboMagnetTimer=0;
let openingMagnetGuaranteed=false,spawnRefreshTimer=0,runActiveSeconds=0;
function openingGraceProgress(){
    if(!gameActive)return 1;
    return THREE.MathUtils.clamp(runActiveSeconds/OPENING_GRACE_DURATION,0,1);
}
function createSpawnItem(type,x,z){
    let mesh=null,radius=0;
    switch(type){
        case'rock':{const rs=.3+Math.random()*.5,rm=1+Math.floor(Math.random()*5)*.5;mesh=isFestival('festival_national_day')?mkCake(new THREE.Vector3(x,-.1,z),rs):mkRock(new THREE.Vector3(x,-.1,z),rs);mesh.scale.multiplyScalar(rm);radius=rs*1.2*rm;break}
        case'flower':{const fm=1+Math.floor(Math.random()*3)*.5;mesh=mkFlower(x,z);mesh.scale.multiplyScalar(fm);radius=.4*fm;break}
        case'grass':{const gm=1+Math.floor(Math.random()*3)*.5;mesh=isFestival('festival_dragon_boat')?mkZongzi(x,z):mkGrass(x,z,5+Math.floor(Math.random()*4));mesh.scale.multiplyScalar(gm);radius=.4*gm;break}
        case'lily':{const ls=.3+Math.random()*.25,lm=1+Math.floor(Math.random()*3)*.5;mesh=mkLily(x,z,ls);mesh.scale.multiplyScalar(lm);radius=ls*lm;break}
        case'magnet':{const mm=1+Math.floor(Math.random()*3)*.5;mesh=mkMagnet(x,z);mesh.scale.multiplyScalar(mm);radius=.35*mm;break}
    }
    return mesh?{mesh,radius}:null;
}
function findOpeningMagnetSpot(cx,cz){
    // 单人放在镜头前方；双人以两只鸭子的中点为原点，让房主和客机都能公平到达。
    let vx=controls.target.x-camera.position.x,vz=controls.target.z-camera.position.z;
    const vl=Math.hypot(vx,vz)||1;vx/=vl;vz/=vl;
    const originX=typeof Duo!=='undefined'&&Duo.active?0:cx,originZ=typeof Duo!=='undefined'&&Duo.active?0:cz;
    let best={x:originX+vx*9,z:originZ+vz*9},bestMargin=-Infinity;
    for(let i=0;i<12;i++){
        const offset=(Math.random()-.5)*.7,cos=Math.cos(offset),sin=Math.sin(offset),dist=7.5+Math.random()*3;
        const dx=vx*cos-vz*sin,dz=vx*sin+vz*cos,x=originX+dx*dist,z=originZ+dz*dist;
        let margin=Infinity;
        for(const item of items){const ix=item.mesh.position.x-x,iz=item.mesh.position.z-z,clearance=(Number.isFinite(item.r)?item.r:.4)+.75;margin=Math.min(margin,Math.hypot(ix,iz)-clearance)}
        if(margin>bestMargin){bestMargin=margin;best={x,z}}
        if(margin>=0)return best;
    }
    // 极端拥挤时选 12 个候选中净空最大的点，避免随机 fallback 直接落进大型石头。
    return best;
}
function spawnAround(cx,cz){
    const cnt={rock:0,flower:0,grass:0,lily:0,magnet:0};items.forEach(i=>{if(!i.coll||i.respawning)cnt[i.type]++});
    // 前 20 秒把一部分石头名额换成花/荷叶；smoothstep 逐步恢复，不在第 20 秒突然跳变。
    // 石头仍继续叠加原有 5 分钟难度曲线，20 秒后完全回到此前分布。
    const _diff=difficultyFactor();
    const opening=openingGraceProgress(),ease=opening*opening*(3-2*opening),normalRocks=30+Math.round(20*_diff)+eventRockBoost;
    // 国庆的“石头”实际是无伤奖励蛋糕，不能按危险物削减，否则友好期反而减少奖励。
    const openingRockFloor=isFestival('festival_national_day')?normalRocks:12;
    const tgt={
        rock:Math.round(openingRockFloor+(normalRocks-openingRockFloor)*ease),
        flower:Math.round(102+(90-102)*ease),
        grass:80,
        lily:Math.round(48+(42-48)*ease),
        magnet:2
    };
    for(const[type,target]of Object.entries(tgt)){while(cnt[type]<target&&items.length<MAX_I){
    const guaranteeOpeningMagnet=type==='magnet'&&opening<1&&!openingMagnetGuaranteed&&cnt.magnet===0;
    // 常规磁铁仍保持稀有；每局第一枚开局磁铁绕过概率并固定在可见近场。
    if(type==='magnet'&&!guaranteeOpeningMagnet&&Math.random()>.5)break;
    // 用 sqrt 分布让物品在圆盘上均匀分布（不偏向外圈），鸭子周围一圈也有
    let x,z;
    if(guaranteeOpeningMagnet){const spot=findOpeningMagnetSpot(cx,cz);x=spot.x;z=spot.z}
    else{const ang=Math.random()*Math.PI*2,dist=3+Math.sqrt(Math.random())*(SPAWN_R-3);x=cx+Math.cos(ang)*dist;z=cz+Math.sin(ang)*dist}
    const spawned=createSpawnItem(type,x,z);
    if(spawned){scene.add(spawned.mesh);items.push({mesh:spawned.mesh,type,r:spawned.radius,coll:false});cnt[type]++;if(guaranteeOpeningMagnet)openingMagnetGuaranteed=true}}}
    // 双人房主同时维护客机附近的权威道具；否则两人相距较远时，围绕残血客机生成的
    // 救场血瓶会被下一次以房主为中心的刷新立即回收。
    const guest=Duo.active&&Duo.role==='host'?Duo.other:null,guestState=guest?.state;
    const hasLivingGuest=!!guest&&!guest.down&&Number(guestState?.hearts)>0&&Number.isFinite(guestState?.x)&&Number.isFinite(guestState?.z);
    const activePlayerPositions=[{x:cx,z:cz}];
    if(hasLivingGuest)activePlayerPositions.push({x:guestState.x,z:guestState.z});
    for(let i=items.length-1;i>=0;i--){
        const it=items[i];
        if(isOutsideAllPlayerRanges(it.mesh.position.x,it.mesh.position.z,activePlayerPositions,DESPAWN_R)||(it.coll&&!it.respawning))removeItemAt(i);
    }
}

// ===== 双人模式场景同步（已迁移至 js/duo/scene-sync.js） =====

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
magParticleGeo.setAttribute('position',new THREE.BufferAttribute(magParticlePos,3).setUsage(THREE.DynamicDrawUsage));
magParticleGeo.setAttribute('color',new THREE.BufferAttribute(magParticleCol,3).setUsage(THREE.DynamicDrawUsage));
const magParticleMat=new THREE.PointsMaterial({
    size:.32,transparent:true,opacity:0,vertexColors:true,
    blending:THREE.AdditiveBlending,depthWrite:false,fog:false,map:sparkTex
});
const magParticles=new THREE.Points(magParticleGeo,magParticleMat);
magParticles.frustumCulled=false;magParticles.visible=false;scene.add(magParticles);
// 鸭子周身磁场辉光
const magGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,transparent:true,opacity:0,color:0x7fd4ff,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
magGlow.scale.set(2.6,2.6,1);magGlow.visible=false;scene.add(magGlow);
// 鸭子周围的三条立体磁力线：固定 3 个共享圆环，旋转和缩放即可表现磁场包络。
const magFieldGroup=new THREE.Group(),magFieldGeo=new THREE.TorusGeometry(1.05,.018,6,64);
const magFieldColors=[0x72ddff,0x8ca8ff,0xc18bff];
for(let i=0;i<3;i++){
    const orbit=new THREE.Mesh(magFieldGeo,new THREE.MeshBasicMaterial({color:magFieldColors[i],transparent:true,opacity:.42-i*.06,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
    orbit.rotation.set(i*.62,(i-1)*.78,i*.48);orbit.scale.set(1.28,1,.72+i*.12);orbit.renderOrder=36;magFieldGroup.add(orbit);
}
magFieldGroup.visible=false;scene.add(magFieldGroup);
// 被吸道具到鸭子之间的弯曲流光使用固定对象池；激活期间只改 BufferAttribute，不逐帧 new Line/Material。
const MAGNET_TRAIL_COUNT=10,magnetTrails=[];
const magnetTrailMat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.58,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
for(let i=0;i<MAGNET_TRAIL_COUNT;i++){
    const geo=new THREE.BufferGeometry(),positions=new Float32Array(12),colors=new Float32Array([.25,.7,1,.4,.82,1,.65,.92,1,1,1,1]);
    const attr=new THREE.BufferAttribute(positions,3);attr.setUsage(THREE.DynamicDrawUsage);geo.setAttribute('position',attr);geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const line=new THREE.Line(geo,magnetTrailMat);line.visible=false;line.frustumCulled=false;line.renderOrder=35;scene.add(line);magnetTrails.push(line);
}
let magnetTrailCursor=0,magnetVisualAccumulator=0;
// 两连目标标记池：最多提示 4 个近处可完成目标，几何/材质全局共享，扫描仅每 0.2 秒执行一次。
// 圆环保留在 3D 世界中，倍率卡片使用固定 DOM 池，彻底避开鸭子/水面/透明特效的深度与排序干扰。
const COMBO_TARGET_MARKER_COUNT=4,COMBO_TARGET_RANGE=30,COMBO_TARGET_RING_RENDER_ORDER=2100,COMBO_TARGET_CARD_MARGIN=8,COMBO_TARGET_CARD_GAP=13,COMBO_TARGET_CARD_FLIP_HYSTERESIS=8;
const comboTargetRingGeo=new THREE.TorusGeometry(.4,.033,7,36);
const comboTargetRingMats={
    // 恢复深度测试：鸭子游到目标前方时圆环被鸭子正常遮挡，提示不再盖在小鸭子上面。
    same:new THREE.MeshBasicMaterial({color:0xffcf55,transparent:true,opacity:.88,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false,toneMapped:false,fog:false}),
    diff:new THREE.MeshBasicMaterial({color:0x73ddff,transparent:true,opacity:.84,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false,toneMapped:false,fog:false})
};
const comboTargetLayer=document.createElement('div');comboTargetLayer.id='combo-target-layer';comboTargetLayer.setAttribute('aria-hidden','true');document.getElementById('ui').appendChild(comboTargetLayer);
const comboTargetMarkers=[],comboTargetCards=[],comboTargetCardStates=[],comboTargetItems=[],comboTargetDistances=[];
for(let i=0;i<COMBO_TARGET_MARKER_COUNT;i++){
    const group=new THREE.Group(),ring=new THREE.Mesh(comboTargetRingGeo,comboTargetRingMats.same);
    group.renderOrder=COMBO_TARGET_RING_RENDER_ORDER;ring.renderOrder=COMBO_TARGET_RING_RENDER_ORDER;group.add(ring);group.visible=false;group.userData={ring};scene.add(group);comboTargetMarkers.push(group);
    const card=document.createElement('div');card.className='combo-target-card';card.dataset.kind='same';card.innerHTML='<i class="fa-solid fa-star cc-ico"></i><span class="combo-target-card-value">×10</span>';comboTargetLayer.appendChild(card);comboTargetCards.push(card);
    comboTargetCardStates.push({visible:false,reason:'no-target',kind:'same',x:null,y:null,anchorX:null,anchorY:null,ndcZ:null,placement:null,clamped:false,width:Math.max(48,card.offsetWidth),height:Math.max(26,card.offsetHeight)});
}
const comboTargetProjectPos=new THREE.Vector3(),comboTargetViewPos=new THREE.Vector3();
const comboTargetDuckCenter=new THREE.Vector3(),comboTargetDuckNDC=new THREE.Vector3();
let comboTargetScanTimer=0,comboTargetModeKey='';
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
function getComboTargetMode(){
    if(streakItems.length!==2)return null;
    const[a,b]=streakItems;
    return a===b?{kind:'same',type:a,key:'same:'+a}:{kind:'diff',first:a,second:b,key:'diff:'+a+':'+b};
}
function comboTargetType(item){return item?.type==='rock'&&isFestival('festival_national_day')?'flower':item?.type}
function isComboTargetItem(item,mode){
    if(!item||item.coll||item.duoHidden||item.respawning||item.falling>0)return false;
    const type=comboTargetType(item);if(type==='rock')return false;
    return mode.kind==='same'?type===mode.type:type!==mode.first&&type!==mode.second;
}
function setComboGoalHud(mode){
    // 顶部 HUD 不再显示「××× ×5 / ×10」目标文字：移动端顶部挤不下，目标提示只保留场景内的标记圈与悬浮卡片。
    const hint=document.getElementById('combo-goal-hint');
    if(hint&&(hint.className||hint.innerHTML)){hint.className='';hint.innerHTML=''}
}
function hideComboTargetCard(index,reason){
    const card=comboTargetCards[index],state=comboTargetCardStates[index];if(!card||!state)return;
    if(state.visible){card.classList.remove('show');state.visible=false}
    state.reason=reason;state.x=null;state.y=null;state.anchorX=null;state.anchorY=null;state.ndcZ=null;state.placement=null;state.clamped=false;
}
function setComboTargetCardKind(index,kind){
    const card=comboTargetCards[index],state=comboTargetCardStates[index];if(!card||!state||state.kind===kind)return;
    state.kind=kind;card.dataset.kind=kind;card.querySelector('.combo-target-card-value').textContent=kind==='same'?'×10':'×5';
    const ico=card.querySelector('.cc-ico');if(ico)ico.className=kind==='same'?'fa-solid fa-star cc-ico':'fa-solid fa-bolt cc-ico';
}
function hideComboTargetMarkers(reason='no-target'){
    for(let i=0;i<comboTargetMarkers.length;i++){comboTargetMarkers[i].visible=false;hideComboTargetCard(i,reason)}
}
function resetComboTargetHints(){comboTargetItems.length=0;comboTargetDistances.length=0;comboTargetScanTimer=0;comboTargetModeKey='';setComboGoalHud(null);hideComboTargetMarkers()}
function scanComboTargets(mode){
    comboTargetItems.length=0;comboTargetDistances.length=0;if(!duckModel)return;
    const dp=duckModel.position,maxDistSq=COMBO_TARGET_RANGE*COMBO_TARGET_RANGE;
    for(const item of items){
        if(!isComboTargetItem(item,mode))continue;
        const dx=item.mesh.position.x-dp.x,dz=item.mesh.position.z-dp.z,distSq=dx*dx+dz*dz;if(distSq>maxDistSq)continue;
        let at=comboTargetDistances.length;while(at>0&&comboTargetDistances[at-1]>distSq)at--;
        comboTargetDistances.splice(at,0,distSq);comboTargetItems.splice(at,0,item);
        if(comboTargetItems.length>COMBO_TARGET_MARKER_COUNT){comboTargetItems.pop();comboTargetDistances.pop()}
    }
}
function updateComboTargetHints(dt){
    const mode=gameActive?getComboTargetMode():null,key=mode?.key||'';
    if(key!==comboTargetModeKey){comboTargetModeKey=key;comboTargetScanTimer=0;setComboGoalHud(mode)}
    if(!mode){comboTargetItems.length=0;comboTargetDistances.length=0;comboTargetScanTimer=0;hideComboTargetMarkers();return}
    if(!duckModel){hideComboTargetMarkers();return}
    comboTargetScanTimer-=dt;
    if(comboTargetScanTimer<=0||comboTargetItems.some(item=>!isComboTargetItem(item,mode))){scanComboTargets(mode);comboTargetScanTimer=.2}
    for(let i=0;i<comboTargetMarkers.length;i++){
        const marker=comboTargetMarkers[i],item=comboTargetItems[i];
        if(!item){marker.visible=false;hideComboTargetCard(i,'no-target');continue}
        marker.visible=true;marker.position.copy(item.mesh.position);marker.position.y+=.72+Math.min(.3,item.r*.22);marker.quaternion.copy(camera.quaternion);
        const pulse=1+Math.sin(gameClock*5+i*1.7)*.12;marker.userData.ring.scale.setScalar(pulse);marker.userData.ring.rotation.z=gameClock*(i%2?-.9:.9)+i;
        marker.userData.ring.material=comboTargetRingMats[mode.kind];setComboTargetCardKind(i,mode.kind);
    }
}
// 必须在最终相机矩阵（包含本帧震屏偏移）更新后投影，否则 DOM 卡片会和 3D 圆环错开。
function updateComboTargetCards(){
    const width=innerWidth,height=innerHeight;
    // 鸭子屏幕投影与遮挡邻域：鸭子身体轮廓 r，以及更大的遮挡邻域 neighborR。
    // 目标锚点或卡片矩形一旦落入邻域，卡片立即隐藏——弹窗不会盖在小鸭子身上。
    let duckOcclude=null;
    if(duckModel&&comboTargetMarkers.some(marker=>marker.visible)){
        comboTargetDuckCenter.copy(duckModel.position);comboTargetDuckCenter.y+=.55*duckModel.scale.x/.72;
        comboTargetDuckNDC.copy(comboTargetDuckCenter).project(camera);
        const dndcZ=comboTargetDuckNDC.z;
        if(Number.isFinite(dndcZ)&&dndcZ>-1&&dndcZ<1){
            const dScreenX=(comboTargetDuckNDC.x*.5+.5)*width,dScreenY=(-comboTargetDuckNDC.y*.5+.5)*height;
            const camDist=camera.position.distanceTo(duckModel.position);
            const pxPerUnit=(height*.5)/Math.max(.1,camDist*Math.tan(camera.fov*Math.PI/360));
            duckOcclude={x:dScreenX,y:dScreenY,r:Math.max(16,.68*pxPerUnit),neighborR:Math.max(48,1.9*pxPerUnit)};
        }
    }
    for(let i=0;i<comboTargetCards.length;i++){
        const marker=comboTargetMarkers[i],item=comboTargetItems[i],card=comboTargetCards[i],state=comboTargetCardStates[i];
        if(!marker?.visible||!item||item.coll||item.duoHidden){hideComboTargetCard(i,'no-target');continue}
        comboTargetViewPos.copy(marker.position).applyMatrix4(camera.matrixWorldInverse);
        if(comboTargetViewPos.z>=-camera.near){hideComboTargetCard(i,'behind-camera');continue}
        comboTargetProjectPos.copy(marker.position).project(camera);
        const{x,y,z}=comboTargetProjectPos;
        if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||x<=-1||x>=1||y<=-1||y>=1||z<=-1||z>=1){hideComboTargetCard(i,'offscreen');continue}
        const screenX=(x*.5+.5)*width,screenY=(-y*.5+.5)*height;
        const halfWidth=state.width*.5,minX=COMBO_TARGET_CARD_MARGIN+halfWidth,maxX=width-COMBO_TARGET_CARD_MARGIN-halfWidth;
        const cardX=minX<=maxX?Math.max(minX,Math.min(maxX,screenX)):width*.5;
        const aboveTop=screenY-COMBO_TARGET_CARD_GAP-state.height;
        // 保留上一帧方向并留出滞回带，避免浪高/震屏在顶部临界值附近造成约一张卡片高度的上下跳变。
        const placement=state.placement==='below'
            ?(aboveTop>=COMBO_TARGET_CARD_MARGIN+COMBO_TARGET_CARD_FLIP_HYSTERESIS?'above':'below')
            :(aboveTop<COMBO_TARGET_CARD_MARGIN?'below':'above');
        // 鸭子遮挡：物品锚点落入鸭子遮挡邻域，或卡片矩形与邻域相交时隐藏弹窗——
        // 邻域约为鸭子身体高度的 3 倍，鸭子挡在目标前面时提示即刻消失。
        if(duckOcclude){
            const nR=duckOcclude.neighborR;
            const dxA=screenX-duckOcclude.x,dyA=screenY-duckOcclude.y;
            if(dxA*dxA+dyA*dyA<=nR*nR){hideComboTargetCard(i,'duck-occluded');continue}
            const cardLeft=cardX-state.width*.5,cardRight=cardX+state.width*.5;
            const cardTop=placement==='below'?screenY+COMBO_TARGET_CARD_GAP:screenY-COMBO_TARGET_CARD_GAP-state.height;
            const cardBottom=cardTop+state.height;
            const cx=Math.max(cardLeft,Math.min(duckOcclude.x,cardRight)),cy=Math.max(cardTop,Math.min(duckOcclude.y,cardBottom));
            const dx=duckOcclude.x-cx,dy=duckOcclude.y-cy;
            if(dx*dx+dy*dy<=nR*nR){hideComboTargetCard(i,'duck-occluded');continue}
        }
        const offsetY=placement==='below'?`${COMBO_TARGET_CARD_GAP}px`:`calc(-100% - ${COMBO_TARGET_CARD_GAP}px)`;
        card.style.transform=`translate3d(${cardX.toFixed(1)}px,${screenY.toFixed(1)}px,0) translate(-50%,${offsetY}) rotate(${i%2?-3:3}deg)`;
        if(state.placement!==placement){card.dataset.placement=placement;state.placement=placement}
        if(!state.visible){card.classList.add('show');state.visible=true}
        state.reason='visible';state.anchorX=Math.round(screenX*10)/10;state.anchorY=Math.round(screenY*10)/10;state.x=Math.round(cardX*10)/10;state.y=state.anchorY;state.clamped=Math.abs(cardX-screenX)>.05;state.ndcZ=Math.round(z*1000)/1000;
    }
}
function comboTargetDebugState(){
    const firstRing=comboTargetMarkers[0]?.userData.ring,layerStyle=getComputedStyle(comboTargetLayer);
    return{
        mode:comboTargetModeKey,targets:comboTargetItems.filter(item=>item&&!item.coll).map(item=>item.type),distances:comboTargetDistances.map(distanceSq=>Math.round(Math.sqrt(distanceSq)*10)/10),
        layer:{kind:'dom',connected:comboTargetLayer.isConnected,zIndex:layerStyle.zIndex,pointerEvents:layerStyle.pointerEvents},
        ring:{renderOrder:firstRing?.renderOrder??null,groupRenderOrder:comboTargetMarkers[0]?.renderOrder??null,depthTest:firstRing?.material.depthTest??null,depthWrite:firstRing?.material.depthWrite??null,toneMapped:firstRing?.material.toneMapped??null,visible:comboTargetMarkers.filter(marker=>marker.visible).length},
        cards:comboTargetCardStates.map((state,index)=>({...state,target:comboTargetItems[index]?.type||null}))
    };
}
function addScore(n,type='score',showMultiplierToast=true){
    const blessingMult=Blessings.getScoreMult(n>0?type:null);
    const achBonus=1+(activeRewards.scoreBonus||0);
    const mult=(streakActive?scoreMultiplier:1)*blessingMult*achBonus;
    const actual=n*mult;
    score=Math.max(0,score+actual);
    document.getElementById('score').textContent=formatScore(score);
    if(showMultiplierToast&&mult>1&&n>0){
        let msg=`<i class="fa-solid fa-fire"></i> +${Math.floor(n*achBonus)}`;
        if(streakActive&&scoreMultiplier>1) msg+=`×${scoreMultiplier}`;
        if(blessingMult>1) msg+=` <i class="fa-solid fa-star"></i> ×${blessingMult}`;
        toast(msg,actual>=0?'p':'m');
    }
    return actual;
}
function trackStreak(type){
    if(type==='rock')return;// 岩石不计入连胜
    // 成就追踪：累计收集道具数（含血瓶/磁铁）
    Achievements.updateStat('totalItems',1);
    recordCollection(runStats);
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
recordComboMultiplier(runStats,scoreMultiplier);
activateComboMagnet();
document.getElementById('multi-text').classList.add('show');setTimeout(()=>document.getElementById('multi-text').classList.remove('show'),3000);
document.getElementById('combo-border').classList.add('active');
// 鸭子变大4倍+无敌3s+积分倍率 全部持续10秒
if(duckModel)duckModel.scale.setScalar(.72*4);bigTimer=10;invincible=Math.max(invincible,3);
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
if(duckModel)duckModel.scale.setScalar(.72);bigTimer=0;crownGroup.visible=false;auraMesh.visible=false;
updateStreakUI()}}
function activateShield(){hasShield=true;shieldTimer=15*(1+(activeRewards.shieldBonus||0));document.getElementById('shield-hud').style.display='flex';shieldMesh.visible=true;playSFX('shield');toast('<i class="fa-solid fa-shield-halved"></i> 护盾','s')}
function magnetFxActive(){return magnetActive||comboMagnetTimer>0}
function activeMagnetRange(){return magnetActive?getMagnetRange():COMBO_MAGNET_RANGE}
function magnetVisualConfig(remote=false,compact=false){
    const tier=quality.effectiveTier||graphicsQuality;
    if(compact){
        if(tier==='restricted')return{hz:20,particles:20,pulses:1};
        if(tier==='low')return{hz:24,particles:28,pulses:1};
        if(tier==='mid')return{hz:30,particles:40,pulses:1};
        return{hz:40,particles:56,pulses:1};
    }
    if(tier==='restricted')return{hz:20,particles:remote?20:32,pulses:1};
    if(tier==='low')return{hz:30,particles:remote?32:52,pulses:1};
    if(tier==='mid')return{hz:45,particles:remote?52:88,pulses:2};
    return{hz:60,particles:remote?88:MAG_PARTICLES,pulses:2};
}
function setMagnetFxVisible(visible){
    magnetRangeRing.visible=visible;magnetPulse.forEach(r=>r.visible=visible);magParticles.visible=visible;magGlow.visible=visible;magFieldGroup.visible=visible;
}
function hideMagnetTrails(){magnetTrailCursor=0;for(const line of magnetTrails)line.visible=false}
function hideMagnetFx(){
    setMagnetFxVisible(false);magnetRangeRing.material.opacity=0;magnetPulse.forEach(r=>r.material.opacity=0);magParticleMat.opacity=0;magGlow.material.opacity=0;magnetHud.style.display='none';magnetVisualAccumulator=0;hideMagnetTrails();
}
function resetMagnetParticles(range){
    for(const p of magParticleData){p.radius=1+Math.random()*Math.max(1,range-1);p.angle=Math.random()*Math.PI*2;p.yOff=(Math.random()-.5)*1.2}
}
function beginMagnetTrailFrame(){magnetTrailCursor=0}
function addMagnetTrail(item,dp){
    if(magnetTrailCursor>=magnetTrails.length)return;
    const line=magnetTrails[magnetTrailCursor],attr=line.geometry.attributes.position,p=item.mesh.position;
    const dx=dp.x-p.x,dz=dp.z-p.z,len=Math.hypot(dx,dz)||1,bend=Math.sin(gameClock*7+magnetTrailCursor*1.9)*Math.min(.7,len*.075),px=-dz/len*bend,pz=dx/len*bend;
    const y0=p.y+.24,y3=dp.y+.52;
    attr.setXYZ(0,p.x,y0,p.z);attr.setXYZ(1,p.x+dx*.34+px,y0+(y3-y0)*.38+.16,p.z+dz*.34+pz);attr.setXYZ(2,p.x+dx*.68-px*.55,y0+(y3-y0)*.72+.08,p.z+dz*.68-pz*.55);attr.setXYZ(3,dp.x,y3,dp.z);
    attr.needsUpdate=true;line.visible=true;magnetTrailCursor++;
}
function finishMagnetTrailFrame(){for(let i=magnetTrailCursor;i<magnetTrails.length;i++)magnetTrails[i].visible=false}
function activateComboMagnet(){
    const wasActive=magnetFxActive();comboMagnetTimer=Math.max(comboMagnetTimer,COMBO_MAGNET_DURATION);magnetVisualAccumulator=1;setMagnetFxVisible(true);
    if(!wasActive)resetMagnetParticles(COMBO_MAGNET_RANGE);
}
function activateMagnet(){
    magnetActive=true;magnetTimer=MAGNET_DURATION*Blessings.getMagnetMult();
    magnetVisualAccumulator=1;setMagnetFxVisible(true);resetMagnetParticles(getMagnetRange());
    magnetHud.style.display='flex';
    toast('<i class="fa-solid fa-magnet"></i> 磁吸激活','s');
}
function updateMagnet(dt){
    if(magnetActive){magnetTimer-=dt;if(magnetTimer<=0){magnetTimer=0;magnetActive=false;magnetHud.style.display='none'}}
    if(comboMagnetTimer>0)comboMagnetTimer=Math.max(0,comboMagnetTimer-dt);
    if(!magnetFxActive()){hideMagnetFx();return}
    setMagnetFxVisible(true);
    const fullPower=magnetActive,visual=magnetVisualConfig(false,!fullPower);magnetVisualAccumulator+=dt;
    if(magnetVisualAccumulator<1/visual.hz)return;
    const visualDt=Math.min(.1,magnetVisualAccumulator);magnetVisualAccumulator%=1/visual.hz;magParticleGeo.setDrawRange(0,visual.particles);
    const dp=duckModel.position;
    const breathe=.5+Math.sin(gameClock*4)*.25;
    const mRange=activeMagnetRange(); // 小磁吸固定 8 米；正常磁铁仍保留元旦范围加成
    // 范围圈：贴合浪面跟随鸭子，虚线流动 + 呼吸闪烁
    magnetRangeRing.userData.update(dp.x,dp.z,mRange-1.2,mRange,.15);
    magnetRangeRing.material.opacity=(fullPower?.55:.38)+Math.sin(gameClock*4)*(fullPower?.2:.12);
    // 内收脉冲环：两圈交替从外缘收缩到鸭子
    for(let i=0;i<2;i++){
        if(i>=visual.pulses){magnetPulse[i].visible=false;magnetPulse[i].material.opacity=0;continue}
        magnetPulse[i].visible=true;
        const ph=(gameClock*.45+i*.5)%1,r=1+ph*(mRange-1);
        magnetPulse[i].userData.update(dp.x,dp.z,Math.max(r-.5,.2),r,.12);
        magnetPulse[i].material.opacity=(1-ph)*(fullPower?.4:.26);
    }
    // 磁场粒子：螺旋向内 + 抬升汇聚到鸭子，颜色由青渐白
    const pos=magParticleGeo.attributes.position,col=magParticleGeo.attributes.color;
    for(let i=0;i<visual.particles;i++){
        const p=magParticleData[i];
        p.angle+=visualDt*p.speed*1.5;      // 角速度（环绕）
        p.radius-=visualDt*p.speed*2.2;     // 径向速度（向内吸入）
        if(p.radius<.6||p.radius>mRange){   // 到达中心或范围从普通磁铁切回小磁吸时重置
            p.radius=Math.max(1,mRange-Math.random()*Math.min(2,mRange*.25));
            p.angle=Math.random()*Math.PI*2;
            p.yOff=(Math.random()-.5)*1.2;
        }
        const t=1-p.radius/mRange;          // 0=外圈，1=近身
        const y=dp.y+.3+p.yOff*(1-t)+Math.sin(gameClock*3+p.angle*2)*.15+t*.6;
        pos.setXYZ(i,dp.x+Math.cos(p.angle)*p.radius,y,dp.z+Math.sin(p.angle)*p.radius);
        col.setXYZ(i,.35+t*.65,.75+t*.25,1);
    }
    pos.needsUpdate=true;col.needsUpdate=true;
    magParticleMat.opacity=(fullPower?.85:.62)*breathe;
    // 鸭子周身辉光
    magGlow.position.set(dp.x,dp.y+.7,dp.z);
    magGlow.material.opacity=(fullPower?.3:.22)+Math.sin(gameClock*5)*(fullPower?.15:.1);
    const gs=(fullPower?2.4:1.9)+Math.sin(gameClock*5)*.25;magGlow.scale.set(gs,gs,1);
    // 三维磁力线缓慢交错旋转，和水面范围圈形成上下两层，不靠增加粒子数量堆效果。
    magFieldGroup.position.set(dp.x,dp.y+.72,dp.z);magFieldGroup.rotation.y=gameClock*.65;magFieldGroup.scale.setScalar(fullPower?1:.76);
    magFieldGroup.children.forEach((orbit,i)=>{orbit.rotation.z+=visualDt*(i%2?-.55:.48)});
    if(fullPower){magnetHud.style.display='flex';document.getElementById('mag-time').textContent=Math.ceil(Math.max(0,magnetTimer))}
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
    }else{cur.x=0;cur.z=0}
    // 浪高振幅随海浪事件平滑增减（事件时波涛汹涌，平时平缓）
    waveBoost+=((Math.max(waveEventActive?1.55:1,eventWaveTarget))-waveBoost)*Math.min(1,dt*1.2);
    return cur}

// 鸭子（base64 内嵌 GLB 模型）
let duckModel=null;const duckVel=new THREE.Vector3();const mv={f:false,b:false,l:false,r:false,str:0};
// ===== 双人远程鸭子（已迁移至 js/duo/remote-duck.js） =====
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
    runStats=createRunStats(Date.now());
    nearMissReadyAt=0;localCriticalRescueUsed=false;remoteCriticalRescueUsed=false;localCriticalRescueRetryAt=0;remoteCriticalRescueRetryAt=0;
    if(Duo.active)gameClock=0;
    gameActive=true;playStartTime=Date.now();
    // 双人模式：本地鸭子初始偏移到一侧（房主=-3.5，客机=+3.5），避免两只鸭子重叠
    if(Duo.active&&duckModel){const duoOffsetX=Duo.role==='guest'?3.5:Duo.role==='host'?-3.5:0;duckModel.position.set(duoOffsetX,.05,0);duckModel.rotation.set(0,0,0);duckModel.scale.setScalar(.72)}
    // 常驻氛围先启动，标志性开场等玩家关闭祝福卡后再播放，避免动画被弹窗吞掉。
    FestivalFx.start({deferIntro:true});
    updateHeartsUI();
    // 大厅不再提前构建约 2000 个子 Mesh。单人/房主开局时只构建一次；客机等待房主首个权威场景包。
    // 必须放在 Blessings.apply 之后，确保首局端午粽子/国庆蛋糕等节日替换正确生效。
    if(items.length===0&&(!Duo.active||Duo.role==='host')){spawnAround(duckModel?.position.x||0,duckModel?.position.z||0);spawnRefreshTimer=.2}
    // 首次开局后一次性预编译场景与全部物品着色器：石头(flatShading)、水草/荷叶/花朵(vertexColors)、
    // 磁铁等新材质首次渲染时的 GLSL 同步编译会阻塞主线程、把帧率拖到个位数，这里提前预热消除卡顿。
    if(!sceneShadersCompiled){try{scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);renderer.compile(scene,camera)}catch(err){console.warn('着色器预编译失败',err)}sceneShadersCompiled=true}
    autoStartMusic();
    if(Duo.active)Duo.beginGame();
    setTimeout(()=>showBlessingSplash(),350);
    if(!localStorage.getItem('tutorial_done'))setTimeout(()=>showTutorial(),4200);
}
function resetRunState(){
    // 原地开新局：销毁仅属于上一局的临时对象，保留设置、皮肤、祝福和已保存成绩。
    document.getElementById('gameover').classList.remove('show');
    document.getElementById('pause-overlay').classList.remove('show');
    closeShareModal();
    document.getElementById('blessing-splash').classList.remove('show');
    stopBlessingFx();
    document.getElementById('tutorial').classList.remove('show');
    isPaused=false;gameActive=false;lastEntry=null;pendingScore=0;pendingPlayTime=0;runStats=createRunStats(0);
    FestivalFx.stop();
    for(const item of items){scene.remove(item.mesh);disposeItemVisual(item)}items.length=0;
    for(const whirl of whirlpools)disposeWhirlpoolVisuals(whirl);
    whirlpools.length=0;whirlZones.length=0;
    setDuoNextItemId(1);resetDuoSceneSync();resetDuoRemoteMotion();duoSharkTarget=null;
    for(const fx of transientFx){scene.remove(fx.m);disposeTransientVisual(fx.m)}transientFx.length=0;
    endEvent();removeShark();hideWarn();
    score=0;hearts=3;hasShield=false;shieldTimer=0;invincible=0;
    shieldMesh.visible=false;shieldMesh.material.opacity=0;
    document.getElementById('shield-hud').style.display='none';
    openingMagnetGuaranteed=false;spawnRefreshTimer=0;runActiveSeconds=0;magnetActive=false;magnetTimer=0;comboMagnetTimer=0;hideMagnetFx();
    streakItems=[];streakActive=false;streakTimer=0;scoreMultiplier=1;streakType='';bigTimer=0;resetComboTargetHints();
    crownGroup.visible=false;auraMesh.visible=false;document.getElementById('combo-border').classList.remove('active');document.getElementById('combo-border').style.opacity='0';document.getElementById('multi-text').classList.remove('show');
    duckSink.state='none';duckSink.t=0;duckSink.whirl=null;sinkFx=0;screenShakeT=0;duckVel.set(0,0,0);
    heartTimer=8;localCriticalRescueUsed=false;remoteCriticalRescueUsed=false;localCriticalRescueRetryAt=0;remoteCriticalRescueRetryAt=0;nearMissReadyAt=0;whirlSpawnTimer=0;globalEventTimer=30;activeEventTime=0;pendingEvent=null;warnedFor=null;waveSpeed=1;waveSpeedTarget=1;eventWaveTarget=1;
    if(duckModel){duckModel.visible=true;const duoOffsetX=(typeof Duo!=='undefined'&&Duo.active&&Duo.role==='guest')?3.5:(typeof Duo!=='undefined'&&Duo.active&&Duo.role==='host')?-3.5:0;duckModel.position.set(duoOffsetX,.05,0);duckModel.rotation.set(0,0,0);duckModel.scale.setScalar(.72)}
    if(controls){controls.target.set(0,1,0);camSmoothY=1}
    document.getElementById('score').textContent='0';updateHeartsUI();updateStreakUI();
    // 节日重算、特效与本局物品统一由随后唯一一次 startGameSession() 创建，避免重开双重分配。
    updateHeartsUI();
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
// 跟随策略：相机与注视点【同步平移】——保持用户设定的视角方向/距离完全不变，
// 不与 OrbitControls 的阻尼/距离/俯仰约束打架；change 事件不能作为“暂停跟随”的依据，
// 因为程序调用 controls.update() 同样会触发 change。
let camSmoothY=1;
const cameraShakeOffset=new THREE.Vector3();
function clearCameraShakeOffset(){
    if(cameraShakeOffset.lengthSq()>0){camera.position.sub(cameraShakeOffset);camera.updateMatrixWorld(true)}
    cameraShakeOffset.set(0,0,0);
}
function applyCameraShake(dt){
    let x=0,y=0,z=0;
    if(camShake>0){camShake=Math.max(0,camShake-dt);const strength=camShake*.5;x+=(Math.random()-.5)*strength;y+=(Math.random()-.5)*strength*.6;z+=(Math.random()-.5)*strength}
    if(screenShakeT>0){screenShakeT=Math.max(0,screenShakeT-dt);const strength=screenShakeT/.35;x+=(Math.random()-.5)*.3*strength;y+=(Math.random()-.5)*.22*strength}
    cameraShakeOffset.set(x,y,z);camera.position.add(cameraShakeOffset);
}
function updateCam(dt){if(!duckModel)return;
// 鼠标旋转只改变轨道方向；跟随时相机与 target 同步平移，不能把相机留在原地。
if(!cam.followPaused){
    // 鸭子 Y 低通滤波（dt 归一化，帧率无关），吸收浪面顶点分帧更新带来的阶梯抖动
    camSmoothY+=((duckModel.position.y+1)-camSmoothY)*Math.min(1,dt*3.2);
    // 注视点平滑逼近鸭子（x/z 较快跟随，y 用滤波值）
    const k=Math.min(1,dt*5);
    const nx=controls.target.x+(duckModel.position.x-controls.target.x)*k;
    const nz=controls.target.z+(duckModel.position.z-controls.target.z)*k;
    const dx=nx-controls.target.x,dy=camSmoothY-controls.target.y,dz=nz-controls.target.z;
    if(dx||dy||dz){
        controls.target.x=nx;controls.target.y=camSmoothY;controls.target.z=nz;
        camera.position.x+=dx;camera.position.y+=dy;camera.position.z+=dz;
    }
}
if(stormActive){const d=camera.position.distanceTo(controls.target);if(d>9)camera.position.lerp(controls.target,dt*.4)}
}

// 碰撞 / 惊险擦边：危险窄环只在“进入后完整驶离”时结算，避免停在旁边或绕圈刷分。
const NEAR_MISS_SCORE=1,NEAR_MISS_COOLDOWN=2.5,NEAR_MISS_MIN_SPEED=1.2,NEAR_MISS_MIN_TRAVEL=.8,NEAR_MISS_MAX_DWELL=2;
const ROCK_NEAR_MARGIN=.75,ROCK_NEAR_EXIT=.35,WHIRL_NEAR_MARGIN=.65,WHIRL_NEAR_EXIT=.35;
const WHIRL_PULL_RADIUS=12;
let nearMissReadyAt=0;
function updateDangerNearMiss(hazard,distance,hitRadius,margin,hysteresis,eligible){
    if(!hazard._nearMiss)hazard._nearMiss=createNearMissState();
    const qualified=updateNearMissState(hazard._nearMiss,{distance,hitRadius,margin,hysteresis,eligible,
        now:runActiveSeconds,x:duckModel.position.x,z:duckModel.position.z,speed:Math.hypot(duckVel.x,duckVel.z),
        minSpeed:NEAR_MISS_MIN_SPEED,minTravel:NEAR_MISS_MIN_TRAVEL,maxDwell:NEAR_MISS_MAX_DWELL});
    if(!qualified||runActiveSeconds<nearMissReadyAt)return false;
    nearMissReadyAt=runActiveSeconds+NEAR_MISS_COOLDOWN;runStats.nearMisses++;
    const actual=addScore(NEAR_MISS_SCORE,'nearMiss',false);
    toast(`<i class="fa-solid fa-person-running"></i> 险过 +${Math.max(1,Math.floor(actual))}`,'s');
    playSFX('collect');spawnSplash(duckModel.position.clone());
    return true;
}
function cancelNearMissCandidates(){
    for(const hazard of[...items,...whirlpools]){const state=hazard?._nearMiss;if(!state||state.done)continue;state.armed=false;state.prevDistance=Infinity}
}
function checkHit(){if(!duckModel)return;const dp=duckModel.position;
for(const it of items){if(it.coll||it.duoHidden)continue;
// 水平距离判定（忽略Y轴差异），碰撞范围加大
const dx=dp.x-it.mesh.position.x,dz=dp.z-it.mesh.position.z,distSq=dx*dx+dz*dz;
const duckScale=duckModel.scale.x/.72;const duckRadius=0.6*duckScale;const hitR=it.r+duckRadius; // 碰撞半径随鸭子变大
const dangerousRock=it.type==='rock'&&!isFestival('festival_national_day');
if(dangerousRock)updateDangerNearMiss(it,Math.sqrt(distSq),hitR,ROCK_NEAR_MARGIN,ROCK_NEAR_EXIT,gameActive&&invincible<=0&&duckSink.state==='none');
if(distSq<hitR*hitR){
// 无敌状态只跳过危险岩石；国庆蛋糕虽沿用 rock 类型，仍是可收集奖励。
if(invincible>0&&it.type==='rock'&&!isFestival('festival_national_day'))continue;
duoQueueCollectedItem(it);
switch(it.type){case'rock':{
// 国庆：石头变成蛋糕，撞碎得分不扣血（咀嚼音效 + 奶油色碎屑）
if(Blessings.festival?.id==='festival_national_day'){
    addScore(2,'score');toast('<i class="fa-solid fa-cake-candles"></i> +2','p');playSFX('chew');trackStreak('flower');
    spawnRockShatter(it.mesh.position.clone(),it.mesh.scale.x,[0xfff4df,0xffffff,0xd8203f,0xf4c44e,0xb50f2f]);
    it.coll=true;scene.remove(it.mesh);
    break;
}
const kb=dp.clone().sub(it.mesh.position).normalize().multiplyScalar(2);takeDamage(1,'rock');duckVel.add(kb);
// 保护机制：撞击后石头粉碎销毁，避免连续扣血
const rockScale=it.mesh.scale.x;
spawnRockShatter(it.mesh.position.clone(),rockScale);
    it.coll=true;scene.remove(it.mesh); // 立即从场景移除，下一帧由 despawn 逻辑清理 items
    break;}
case'flower':addScore(2,'flower');if(rainbowActive)addScore(5);if(!streakActive||scoreMultiplier<=1)toast('<i class="fa-solid fa-sun"></i> +2','p');playSFX('flower');trackStreak('flower');scheduleItemRespawn(it,2000,-.02);break;
case'grass':addScore(1,'grass');if(rainbowActive)addScore(5);if(!streakActive||scoreMultiplier<=1)toast('<i class="fa-solid fa-seedling"></i> +1','p');playSFX('grass');trackStreak('grass');scheduleItemRespawn(it,2000,0);break;
case'lily':if(!it.coll){addScore(3,'lily');if(!streakActive||scoreMultiplier<=1)toast('<i class="fa-solid fa-spa" style="color:#ff9ec7"></i> 荷叶','p');playSFX('collect');trackStreak('lily');activateShield();scheduleItemRespawn(it,3000,.01)}break;
    case'heart':heal(1);playSFX('heal');trackStreak('heart');it.coll=true;scene.remove(it.mesh);spawnHeartParticles(it.mesh.position.clone());break;
    case'magnet':activateMagnet();playSFX('magnet');trackStreak('magnet');it.coll=true;scene.remove(it.mesh);break}}}}

function scheduleItemRespawn(item,delay,y){
    if(!item||item.respawning)return;
    item.coll=true;item.respawning=true;item.mesh.visible=false;
    if(item.respawnTimer)clearTimeout(item.respawnTimer);
    item.respawnTimer=setTimeout(()=>{
        item.respawnTimer=null;
        if(!items.includes(item)){item.respawning=false;return}
        const center=duckModel?.position||{x:0,z:0},angle=Math.random()*Math.PI*2,distance=10+Math.random()*15;
        item.mesh.position.set(center.x+Math.cos(angle)*distance,y,center.z+Math.sin(angle)*distance);
        if(!duoIsGuest()){
            const generation=Number.isSafeInteger(item.duoGen)&&item.duoGen>=0?item.duoGen:0;
            item.duoGen=generation<Number.MAX_SAFE_INTEGER?generation+1:generation;
        }
        item.coll=false;item.respawning=false;item.mesh.visible=!item.duoHidden;
    },delay);
}

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
    const baseY=renderedWaveHeight(backX,backZ);
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
                depthWrite:false,depthTest:true,fog:false
            })
        );
        ring.position.set(backX,baseY+.12,backZ);
        ring.rotation.x=-Math.PI/2;
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
                depthWrite:false,depthTest:true
            })
        );
        const offX=(Math.cos(yaw)*.4*side-Math.sin(yaw)*.3)*scaleFactor;
        const offZ=(-Math.sin(yaw)*.4*side-Math.cos(yaw)*.3)*scaleFactor;
        const dropX=pos.x+offX,dropZ=pos.z+offZ;
        m.position.set(dropX,renderedWaveHeight(dropX,dropZ)+.08*scaleFactor,dropZ);
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
    const baseY=renderedWaveHeight(backX,backZ);
    const n=Math.floor((5+Math.floor(Math.min(speed,4)*.6))*Math.min(scaleFactor,2.2));
    for(let i=0;i<n;i++){
        // 高质量球体（12 段）+ 蓝白渐变色；保留深度测试，让鸭身正确遮挡身后的水花。
        const isTop=Math.random()<.4;
        const m=new THREE.Mesh(
            new THREE.SphereGeometry((.06+Math.random()*.04)*scaleFactor,12,10),
            new THREE.MeshBasicMaterial({
                color:isTop?0xffffff:0xb8e3ff,
                transparent:true,opacity:.95,fog:false,
                depthWrite:false,depthTest:true
            })
        );
        // 起始位置：尾部水面之上 0.1-0.18，加少量横向偏移；偏移量随体型放大
        const sideOff=(Math.random()-.5)*.4*scaleFactor;
        const dropX=backX+Math.cos(yaw)*sideOff,dropZ=backZ-Math.sin(yaw)*sideOff;
        m.position.set(dropX,renderedWaveHeight(dropX,dropZ)+(.1+Math.random()*.08)*scaleFactor,dropZ);
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
// 水流/浪幅已在本帧水面更新前推进；鸭子读取同一份当前值，避免水面与漂浮高度错一帧。
const c=cur;
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
// 正常磁铁吸所有非危险道具；三连赠送的 2 秒小磁吸只作用于花/草/荷叶，互不覆盖计时。
beginMagnetTrailFrame();
if(magnetFxActive()&&duckModel){const dp=duckModel.position,mRange=activeMagnetRange(),rangeSq=mRange*mRange,fullPower=magnetActive;let attracting=false;for(const it of items){if(it.coll||it.duoHidden||it.type==='rock'||!fullPower&&!COMBO_MAGNET_TYPES.has(it.type))continue;const dx=dp.x-it.mesh.position.x,dz=dp.z-it.mesh.position.z,distSq=dx*dx+dz*dz;if(distSq<rangeSq&&distSq>.01){const d=Math.sqrt(distSq);
// 吸引动画：越近吸力越强（指数加速）；道具轻微浮起+旋转，表现被磁场牵引
const t=1-d/mRange; // 0=远，1=近
const f=((fullPower?.5:1.1)+t*t*(fullPower?8:10.5))*dt; // 小磁吸时间短，近场牵引略更干脆
it.mesh.position.x+=dx/d*f;it.mesh.position.z+=dz/d*f;
it.magT=Math.min(1,(it.magT||0)+dt*3);
addMagnetTrail(it,dp);attracting=true;
}}
// 有道具正被吸附时周期性播放轻微吸附声
_magnetSfxTimer-=dt;
if(attracting&&_magnetSfxTimer<=0){playSFX('pull');_magnetSfxTimer=.4}
}
finishMagnetTrailFrame();
updateMagnet(dt);
if(!duoIsGuest()){spawnRefreshTimer-=dt;if(spawnRefreshTimer<=0){spawnAround(duckModel.position.x,duckModel.position.z);spawnRefreshTimer=.2}}checkHit()}

// ===== 输入（键盘/摇杆已迁移至 js/input/controls.js） =====

// 动画
// ===== v2.0 生命 / 排行榜 / 漩涡 / 血瓶 / 随机事件 系统 =====
// ---- 生命系统 ----
let hearts=3;let MAX_HEARTS=5;let gameActive=false;playStartTime=Date.now(); // gameActive 由"开始冒险"按钮点击后置 true
// 本局运行统计（用于暂停界面展示 + 成就追踪）
let runStats=createRunStats(0);
let localCriticalRescueUsed=false,remoteCriticalRescueUsed=false,localCriticalRescueRetryAt=0,remoteCriticalRescueRetryAt=0;
function recordHealthTransition(before,after){
    if(before!==1&&after===1)beginLowHealth(runStats,runActiveSeconds);
    else if(before===1&&after>1)finishLowHealth(runStats,runActiveSeconds,true);
    else if(before===1&&after<=0)finishLowHealth(runStats,runActiveSeconds,false);
}
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
    const beforeHearts=hearts;
    hearts=Math.max(0,hearts-amount);resetCollectionChain(runStats);recordHealthTransition(beforeHearts,hearts);
    updateHeartsUI();
    toast('-'+amount+' <i class="fa-solid fa-heart"></i>','m');
    const damagePolicy=criticalHeartPolicy(hearts===1);
    if(hearts===1)heartTimer=0;
    screenFlash();playSFX(sfx);invincible=Math.max(invincible,damagePolicy.invincibility);screenShakeT=.35;
    if(hearts<=0)gameOver();
}
function heal(amount=1){
    if(!gameActive)return;
    const before=hearts;hearts=Math.min(MAX_HEARTS,hearts+amount);recordHealthTransition(before,hearts);updateHeartsUI();
    if(hearts>before){toast('+'+(hearts-before)+' <i class="fa-solid fa-heart"></i>','p');playSFX('collect');
        const beats=document.getElementById('hearts-hud').querySelectorAll('.hp');const b=beats[hearts-1];if(b){b.classList.add('beat');setTimeout(()=>b.classList.remove('beat'),450)}
    }else{toast('<i class="fa-solid fa-heart"></i> 生命已满','p')}
}

// ---- 治愈粒子特效 ----
const transientFx=[];
const transientResourceStats={disposeCalls:0,geometriesDisposed:0,materialsDisposed:0};
function disposeTransientVisual(root){
    if(!root)return;
    const geometries=new Set(),materials=new Set();
    root.traverse?.(node=>{if(node.geometry)geometries.add(node.geometry);if(node.material){const mats=Array.isArray(node.material)?node.material:[node.material];for(const mat of mats)if(mat)materials.add(mat)}});
    for(const geometry of geometries)geometry.dispose();
    // spark/wake 等贴图由全局缓存持有，不能随单个粒子释放。
    for(const material of materials)material.dispose();
    transientResourceStats.disposeCalls++;transientResourceStats.geometriesDisposed+=geometries.size;transientResourceStats.materialsDisposed+=materials.size;
}
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
                f.m.position.y=renderedWaveHeight(f.m.position.x,f.m.position.z)+.12;
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
        if(f.life<=0){scene.remove(f.m);disposeTransientVisual(f.m);transientFx.splice(i,1)}
    }
}

const duoNetStats={attempts:0,successes:0,failures:0,requestChars:0,responseChars:0,parseMs:0,maxRequestChars:0,maxResponseChars:0,maxRoundTripMs:0,last:null,byAction:Object.create(null),applyRoomMs:0,maxApplyRoomMs:0};
function recordDuoRequest(action,requestChars,responseChars,roundTripMs,parseMs,ok){
    const bucket=duoNetStats.byAction[action]||(duoNetStats.byAction[action]={attempts:0,successes:0,failures:0,requestChars:0,responseChars:0});
    duoNetStats.attempts++;bucket.attempts++;duoNetStats.requestChars+=requestChars;duoNetStats.responseChars+=responseChars;duoNetStats.parseMs+=parseMs;bucket.requestChars+=requestChars;bucket.responseChars+=responseChars;
    if(ok){duoNetStats.successes++;bucket.successes++}else{duoNetStats.failures++;bucket.failures++}
    duoNetStats.maxRequestChars=Math.max(duoNetStats.maxRequestChars,requestChars);duoNetStats.maxResponseChars=Math.max(duoNetStats.maxResponseChars,responseChars);duoNetStats.maxRoundTripMs=Math.max(duoNetStats.maxRoundTripMs,roundTripMs);
    duoNetStats.last={action,requestChars,responseChars,roundTripMs:+roundTripMs.toFixed(2),parseMs:+parseMs.toFixed(2),ok};
}
function snapshotDuoNetStats(){return{...duoNetStats,byAction:Object.fromEntries(Object.entries(duoNetStats.byAction).map(([key,value])=>[key,{...value}]))}}
const Duo={
    active:false,role:null,room:null,remoteState:null,_apiURL:null,_pollTimer:null,_pollPending:false,_stateTimer:null,_statePending:false,_started:false,_down:false,_teamDefeated:false,_respawnTicker:null,_nameSyncTimer:null,_name:'',_remoteSeq:-1,_remoteFingerprint:null,_roomRev:-1,_uiKey:'',
    get API_URLS(){const base=location.protocol+'//'+location.hostname+':8123/api/duo';return [...new Set([base,'/api/duo'].map(url=>new URL(url,location.href).href))]},
    get playerId(){return Leaderboard.getUserId()},
    get name(){return (document.getElementById('duo-name').value||this._name||'').trim().slice(0,12)},
    get me(){return this.role==='host'?this.room?.host:this.room?.guest},
    get other(){return this.role==='host'?this.room?.guest:this.room?.host},
    async request(action,payload={}){
        const urls=this._apiURL?[this._apiURL,...this.API_URLS.filter(url=>url!==this._apiURL)]:this.API_URLS;
        let lastError=null;
        for(const url of urls){
            const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3500);
            const body=JSON.stringify({action,playerId:this.playerId,name:this.name,role:this.role,sceneHash:this.role==='guest'&&Number.isFinite(duoItemsHash)?duoItemsHash:null,...payload}),started=performance.now();let responseChars=0,parseMs=0,recorded=false;
            try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body});
                const responseText=await response.text();responseChars=responseText.length;const parseStarted=performance.now();const data=JSON.parse(responseText);parseMs=performance.now()-parseStarted;
                recordDuoRequest(action,body.length,responseChars,performance.now()-started,parseMs,response.ok&&!!data?.ok);recorded=true;
                if(response.ok&&data.ok){this._apiURL=url;return data}
                if(data?.error){const apiError=new Error(data.error);apiError.code=data.error;throw apiError}
            }catch(error){lastError=error;if(!recorded)recordDuoRequest(action,body.length,responseChars,performance.now()-started,parseMs,false);if(error?.code==='SCENE_BASE_MISMATCH'||error?.code==='INVALID_SCENE_DELTA')throw error}finally{clearTimeout(timeout)}
        }
        throw lastError||new Error('SERVER_UNAVAILABLE');
    },
    activate(result){resetDuoSceneSync(true);resetDuoRemoteMotion();this._remoteSeq=-1;this._remoteFingerprint=null;this._roomRev=-1;this._uiKey='';this.active=true;this.role=result.role;this.applyRoom(result.room);this.startPolling()},
    showRespawn(downAt){
        const overlay=document.getElementById('duo-respawn'),time=document.getElementById('duo-respawn-time');
        const refresh=()=>{const left=Math.max(0,Math.ceil((10000-(Date.now()-(downAt||Date.now())))/1000));time.textContent=left||'…'};
        clearInterval(this._respawnTicker);refresh();this._respawnTicker=setInterval(refresh,250);overlay.classList.add('show');
    },
    hideRespawn(){clearInterval(this._respawnTicker);this._respawnTicker=null;document.getElementById('duo-respawn').classList.remove('show')},
    finishRespawn(state){
        this._down=false;this.hideRespawn();
        if(!duckModel||!state)return;
        duckSink.state='none';sinkFx=0;duckVel.set(0,0,0);duckModel.visible=true;cancelNearMissCandidates();
        duckModel.position.set(state.x,waveHeight(state.x,state.z,renderedWaveClock)-.08,state.z);duckModel.rotation.y=state.ry||0;
        const beforeHearts=hearts;hearts=1;recordHealthTransition(beforeHearts,hearts);invincible=Math.max(invincible,criticalHeartPolicy(true).invincibility);heartTimer=0;updateHeartsUI();gameActive=true;isPaused=false;
        clearInterval(this._stateTimer);this._stateTimer=setInterval(()=>this.sync(),180);this.sync();
        toast('<i class="fa-solid fa-heart-pulse"></i> 伙伴救援成功，保留 1 颗心','s');
    },
    applyRoom(room){
        if(!room)return;
        const nextRev=Number(room.rev);
        if(this.room?.code===room.code&&Number.isFinite(nextRev)&&nextRev<this._roomRev)return;
        const applyStarted=performance.now();
        if(Number.isFinite(nextRev))this._roomRev=nextRev;
        const wasDown=this._down,previousRound=this.room?.round,previousStatus=this.room?.status,startsNewRound=previousRound!=null&&room.round!==previousRound;this.room=room;
        if(room.status!=='running'&&whirlpools.length)duoReconcileWhirls([]);
        if(startsNewRound&&room.status==='running'){
            this._started=false;this._down=false;this._teamDefeated=false;resetRunState();
        }
        const mine=this.me,other=this.other;
        if(room.blessing&&(Blessings.current?.id!==room.blessing.id||Blessings.current?.mult!==room.blessing.mult))applyDuoBlessing(room.blessing);
        const remoteSeq=Number(other?.seq),hasRemoteSeq=Number.isFinite(remoteSeq);
        const st=other?.state;
        const remoteFingerprint=st?[st.x,st.z,st.ry,st.sh,st.mt,st.cm,st.bt,st.iv,st.scene?.clk,other.down?1:0].join('|'):null;
        const isNewRemote=!!st&&(hasRemoteSeq?remoteSeq>this._remoteSeq:remoteFingerprint!==this._remoteFingerprint);
        if(isNewRemote){
            this.remoteState=st;acceptDuoRemoteSnapshot(st,other.down);
            if(this.role==='host'&&Array.isArray(st.ci))duoApplyGuestCollections(st.ci);
            // guest 仅接受严格递增的 host 快照；在开场遮罩期间就预调和场景，避免亮相后集中建模卡顿。
            if(this.role==='guest'&&st.scene)duoApplyScene(st.scene,hasRemoteSeq?remoteSeq:undefined);
            if(hasRemoteSeq)this._remoteSeq=remoteSeq;
            this._remoteFingerprint=remoteFingerprint;
        }else if(duoRemoteTarget&&other)duoRemoteTarget.down=!!other.down;
        if(!this.active)return;
        const friendName=other?.name||'好友';
        const uiKey=[room.code,room.status,this.role,friendName,mine?.down?1:0].join('|');
        if(uiKey!==this._uiKey){
            this._uiKey=uiKey;
            const status=document.getElementById('duo-status'),roomMeta=document.getElementById('duo-room-meta'),actions=document.getElementById('duo-actions'),error=document.getElementById('duo-error');error.textContent='';
            actions.style.display='none';status.classList.add('show');
            status.classList.toggle('copy-action',room.status==='waiting');
            roomMeta.classList.toggle('show',room.status==='waiting');
            if(room.status==='waiting'){roomMeta.innerHTML=`<div class="room-label">房间号</div><div class="duo-code">${room.code}</div><div class="duo-copy-row"><button class="duo-copy-btn primary" onclick="copyDuoInvite()"><i class="fa-solid fa-link"></i> 复制邀请链接</button><button class="duo-copy-btn" onclick="copyDuoCode()"><i class="fa-solid fa-hashtag"></i> 复制房间号</button></div>`;status.innerHTML='';}
            else if(room.status==='ready'&&this.role==='host')status.innerHTML=`${escapeHtml(friendName)} 已加入<br><button class="duo-btn primary" onclick="startDuoRoom()">开始对局</button>`;
            else if(room.status==='ready')status.textContent='已加入房间，等待房主开始。';
            else if(room.status==='running')status.textContent=mine?.down?'等待伙伴救援…':'对局开始，正在进入海面…';
            else if(room.status==='finished')status.textContent='双人战绩已计入双人排行榜。';
            document.getElementById('duo-hud').classList.remove('show');
        }
        if(other&&gameActive&&!duoRemoteDuck)createDuoRemoteDuck(friendName,other.state);
        if(other?.name&&duoRemoteDuck)setDuoRemoteNameLabel(other.name);
        if(mine?.name&&duoLocalNameLabel?.userData?.duoName!==mine.name)setDuoLocalNameLabel(mine.name);
        if(other?.state?.skin&&duoRemoteDuck){
            let newSkin=other.state.skin;
            // 自定义皮肤必须带有效 palette（body/beak 均为合法 hex），否则降级为 classic，避免出现空白/黑色贴图或误用本地 palette
            let newPal=newSkin==='custom'?other.state.palette:null;
            if(newSkin==='custom'&&( !newPal || typeof newPal!=='object' || !/^#[0-9a-fA-F]{6}$/.test(newPal.body||'') || !/^#[0-9a-fA-F]{6}$/.test(newPal.beak||'') )){newSkin='classic';newPal=null}
            const palChanged=duoRemoteSkin!==newSkin||(newSkin==='custom'&&JSON.stringify(duoRemotePalette)!==JSON.stringify(newPal));
            if(palChanged){setDuoRemoteIdentity(newSkin,newPal);applyDuckSkinToRoot(duoRemoteDuck,newSkin,newPal)}
        }
        if(room.status==='finished'&&wasDown&&!this._teamDefeated){this._teamDefeated=true;this._down=false;clearInterval(this._stateTimer);this._stateTimer=null;this.hideRespawn();finishGameOver(true)}
        else if(mine?.down){this._down=true;if(duckModel)duckModel.visible=false;if(!wasDown)this.showRespawn(mine.downAt)}
        else if(wasDown)this.finishRespawn(mine?.state);
        if(room.status==='running'&&!gameActive&&!this._started&&!this._down){closeDuoModal();startGameSession()}
        if(room.status==='finished'&&previousStatus!=='finished'){Leaderboard.loaded=false;Leaderboard.load().catch(()=>{})}
        const applyMs=performance.now()-applyStarted;duoNetStats.applyRoomMs+=applyMs;duoNetStats.maxApplyRoomMs=Math.max(duoNetStats.maxApplyRoomMs,applyMs);
    },
    startPolling(){clearInterval(this._pollTimer);this._pollTimer=setInterval(()=>this.poll(),500)},
    async poll(){
        if(!this.active||!this.room||this._pollPending)return;
        // 正常对局由串行 state 请求同时带回房间状态；倒地、等待和结算阶段才需要额外轮询。
        if(this.room.status==='running'&&gameActive&&!this._down&&this._stateTimer)return;
        this._pollPending=true;
        try{const result=await this.request('status',{room:this.room.code});this.applyRoom(result.room)}catch(error){}finally{this._pollPending=false}
    },
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
        const downHostCaretaker=duoIsDownHostCaretaker();
        if(!this.active||!this.room||!duckModel||this._statePending||!gameActive&&!downHostCaretaker||this._down&&!downHostCaretaker)return;
        this._statePending=true;
        try{const st={x:duckModel.position.x,y:duckModel.position.y,z:duckModel.position.z,ry:duckModel.rotation.y,score,hearts,skin:activeDuckSkin,
            sh:hasShield?shieldTimer:0,mt:magnetActive?magnetTimer:0,cm:comboMagnetTimer>0?comboMagnetTimer:0,bt:bigTimer>0?bigTimer:0,iv:invincible>0?invincible:0,sk:streakActive?streakTimer:0};
        const collectedIds=duoPendingCollectionIds();if(collectedIds.length)st.ci=collectedIds;
        if(activeDuckSkin==='custom')st.palette=getDuckCustomPalette();
        let fullScene=null;
        if(this.role==='host'){fullScene=duoSerializeScene();st.scene=duoBuildHostSceneUpload(fullScene)}
        const result=await this.request('state',{room:this.room.code,state:st});
        if(fullScene)duoAcceptHostSceneAck(fullScene,result.sceneAck);
        this.applyRoom(result.room)}catch(error){if(error?.code==='SCENE_BASE_MISMATCH'||error?.code==='INVALID_SCENE_DELTA')resetDuoHostSceneBase()}finally{this._statePending=false}
    },
    async down(){
        if(!this.active||!this.room||!duckModel)return false;
        const st={x:duckModel.position.x,y:duckModel.position.y,z:duckModel.position.z,ry:duckModel.rotation.y,score,hearts,skin:activeDuckSkin,
            sh:hasShield?shieldTimer:0,mt:magnetActive?magnetTimer:0,cm:comboMagnetTimer>0?comboMagnetTimer:0,bt:bigTimer>0?bigTimer:0,iv:invincible>0?invincible:0,sk:streakActive?streakTimer:0};
        const collectedIds=duoPendingCollectionIds();if(collectedIds.length)st.ci=collectedIds;
        if(activeDuckSkin==='custom')st.palette=getDuckCustomPalette();
        const result=await this.request('down',{room:this.room.code,state:st});
        this.applyRoom(result.room);
        if(this.me?.down){gameActive=false;if(this.role!=='host'){clearInterval(this._stateTimer);this._stateTimer=null}return true}
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
    reset(){clearInterval(this._pollTimer);clearInterval(this._stateTimer);clearTimeout(this._nameSyncTimer);this.hideRespawn();this.active=false;this.room=null;this.remoteState=null;this._pollPending=false;this._statePending=false;this._started=false;this._down=false;this._teamDefeated=false;this._name='';this._remoteSeq=-1;this._remoteFingerprint=null;this._roomRev=-1;this._uiKey='';resetDuoSceneSync();if(duckModel)duckModel.visible=true;removeDuoRemoteDuck();removeDuoLocalNameLabel();document.getElementById('duo-hud').classList.remove('show')}
};
window.Duo=Duo; // 双人模块（scene-sync/remote-duck）通过全局守卫访问
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
function getRunHighlight(){return runStats.highlight||selectRunHighlight(runStats)}
function updateGameOverHighlight(){
    const highlight=getRunHighlight(),el=document.getElementById('go-highlight');if(!el)return;
    el.dataset.kind=highlight.kind||'multiplier';
    const icon=el.querySelector('.go-highlight-icon'),text=el.querySelector('.go-highlight-text');
    if(icon)icon.textContent=highlight.icon||'✨';if(text)text.textContent=highlight.text||'最高连胜倍率 ×1';
}
async function showGameOver(data, nameConflict, conflictedName, pwdWrong, isFirstTime, submittedName){
    const go=document.getElementById('gameover');
    document.getElementById('go-score').textContent=formatScore(score);
    updateGameOverHighlight();
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
    magnetActive=false;magnetTimer=0;comboMagnetTimer=0;hideMagnetFx();resetComboTargetHints();
    FestivalFx.stop();
    playSFX('die');
    const pt=Math.floor((Date.now()-playStartTime)/1000);
    pendingScore=score;pendingPlayTime=pt;if(Duo.active&&!skipDuoFinish)Duo.finish(pendingScore,pendingPlayTime);
    runStats.highlight=selectRunHighlight(runStats);
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
setShareCardCtx({Leaderboard,Duo,toast,getRunHighlight});

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
const CRITICAL_HEART_MIN_CLEARANCE=.5,CRITICAL_HEART_RETRY_DELAY=.5;
function addHeartItem(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    const mesh=mkHeart(x,z);scene.add(mesh);
    items.push({mesh,type:'heart',r:.6,coll:false});
    return mesh;
}
function spawnHeart(target=duckModel,minDistance=8,maxDistance=24){
    const center=target?.position||target;
    if(!Number.isFinite(center?.x)||!Number.isFinite(center?.z))return null;
    const ang=Math.random()*Math.PI*2,dist=minDistance+Math.random()*Math.max(0,maxDistance-minDistance);
    return addHeartItem(center.x+Math.cos(ang)*dist,center.z+Math.sin(ang)*dist);
}
function criticalHeartClearance(x,z){
    let clearance=Infinity;
    if(!isFestival('festival_national_day'))for(const item of items){
        if(item.type!=='rock'||item.coll||item.duoHidden)continue;
        clearance=Math.min(clearance,circleClearance(x,z,item.mesh.position.x,item.mesh.position.z,item.r+1.6));
    }
    for(const whirl of whirlpools){
        if(whirl.visualOnly||whirl.life<=0)continue;
        clearance=Math.min(clearance,circleClearance(x,z,whirl.x,whirl.z,WHIRL_PULL_RADIUS*(whirl.scale||1)));
    }
    return clearance;
}
function spawnCriticalHeart(target){
    const preferred=Number.isFinite(target?.ry)?target.ry:duckYaw;
    const candidates=[];
    for(let i=0;i<16;i++){
        const angle=preferred+i/16*Math.PI*2,distance=6+(i%4)/3*3;
        const x=target.x+Math.sin(angle)*distance,z=target.z+Math.cos(angle)*distance;
        candidates.push({x,z,clearance:criticalHeartClearance(x,z),preference:Math.cos(angle-preferred)*.25});
    }
    const best=selectSafeHeartCandidate(candidates,CRITICAL_HEART_MIN_CLEARANCE);
    return best?addHeartItem(best.x,best.z):null;
}
function ensureCriticalHeart(target){
    const nearby=items.some(item=>item.type==='heart'&&!item.coll&&!item.duoHidden&&!(item.falling>0)&&Math.hypot(item.mesh.position.x-target.x,item.mesh.position.z-target.z)<=12&&criticalHeartClearance(item.mesh.position.x,item.mesh.position.z)>=CRITICAL_HEART_MIN_CLEARANCE);
    return nearby||!!spawnCriticalHeart(target);
}
function trySpawnHeart(dt){
    const downHostCaretaker=duoIsDownHostCaretaker();
    if(!duckModel||!gameActive&&!downHostCaretaker)return;
    // duo guest：爱心刷新由房主场景同步负责
    if(duoIsGuest())return;
    const localTarget={x:duckModel.position.x,z:duckModel.position.z,ry:duckYaw};
    const remoteState=Duo.active&&Duo.role==='host'?Duo.other?.state:null;
    const remoteCritical=!!(remoteState&&remoteState.hearts===1&&Number.isFinite(remoteState.x)&&Number.isFinite(remoteState.z));
    const localCritical=gameActive&&hearts===1;
    if(hearts<=0&&!remoteCritical)return;
    let forced=false;
    if(localCritical&&!localCriticalRescueUsed&&gameClock>=localCriticalRescueRetryAt){
        if(ensureCriticalHeart(localTarget)){localCriticalRescueUsed=true;forced=true}else localCriticalRescueRetryAt=gameClock+CRITICAL_HEART_RETRY_DELAY;
    }
    if(remoteCritical&&!remoteCriticalRescueUsed&&gameClock>=remoteCriticalRescueRetryAt){
        if(ensureCriticalHeart(remoteState)){remoteCriticalRescueUsed=true;forced=true}else remoteCriticalRescueRetryAt=gameClock+CRITICAL_HEART_RETRY_DELAY;
    }
    const critical=localCritical||remoteCritical,policy=criticalHeartPolicy(critical);
    if(forced)heartTimer=Math.max(heartTimer,policy.nextMin);
    heartTimer-=dt;
    if(heartTimer>0)return;
    heartTimer=policy.nextMin+Math.random()*(policy.nextMax-policy.nextMin);
    const needsHeart=critical||hearts<MAX_HEARTS;
    const present=items.filter(i=>i.type==='heart'&&!i.coll).length;
    if(!shouldSpawnHeart({needsHeart,present,roll:Math.random(),critical}))return;
    // 残血时围绕真正需要救场的玩家生成；房主满血也不会再忽略一心客机。
    // 后续残血优先刷新也必须复用安全血瓶检查；直接 spawn 会在玩家附近已有
    // 可取得血瓶时继续叠出同位置副本，既浪费 Draw Call 也违背“每次只给一个明确目标”。
    if(critical)ensureCriticalHeart(localCritical?localTarget:remoteState);
    else spawnHeart(duckModel,8,24);
}

// ---- 漩涡系统 ----
const whirlpools=[];
// 漩涡圆盘会逐实例改写顶点，不能共享 Geometry；消失时必须显式释放 GPU 资源。
// 全局 CanvasTexture 仍由贴图缓存持有，这里只释放实例自己的 Geometry / Material。
function disposeWhirlpoolVisuals(w){
    if(!w||w.visualsDisposed)return;
    w.visualsDisposed=true;
    const geometries=new Set(),materials=new Set();
    for(const root of[w.group,w.rim,w.field,w.lantern]){
        if(!root)continue;
        scene.remove(root);
        root.traverse(obj=>{
            if(obj.geometry)geometries.add(obj.geometry);
            if(obj.material){
                const list=Array.isArray(obj.material)?obj.material:[obj.material];
                for(const mat of list)if(mat)materials.add(mat);
            }
        });
    }
    for(const geo of geometries)geo.dispose();
    for(const mat of materials)mat.dispose();
}
// 漩涡水流贴图：极坐标展开后，连续弧带会收拢成层次清晰的螺旋水流。
const whirlWaterTex=mkTex(1024,512,(x,W,H)=>{
    x.clearRect(0,0,W,H);
    // CanvasTexture 的 v=0 位于画布底部：中心深、向外逐渐融回海水，消除生硬圆盘边缘。
    const bg=x.createLinearGradient(0,H,0,0);
    bg.addColorStop(0,'rgba(2,17,34,.98)');bg.addColorStop(.2,'rgba(4,42,67,.96)');
    bg.addColorStop(.62,'rgba(11,91,126,.78)');bg.addColorStop(.9,'rgba(36,145,174,.32)');
    bg.addColorStop(1,'rgba(55,170,192,0)');
    x.fillStyle=bg;x.fillRect(0,0,W,H);
    x.lineCap='round';
    const flowFade=x.createLinearGradient(0,H,0,0);
    flowFade.addColorStop(0,'rgba(73,154,193,.12)');flowFade.addColorStop(.24,'rgba(77,174,213,.34)');
    flowFade.addColorStop(.72,'rgba(116,207,230,.24)');flowFade.addColorStop(1,'rgba(146,225,238,0)');
    const drawFlow=(x0,width)=>{
        x.beginPath();x.moveTo(x0,H+18);
        x.bezierCurveTo(x0+W*.10,H*.76,x0+W*.42,H*.38,x0+W*.62,-18);
        x.strokeStyle=flowFade;x.lineWidth=width;x.stroke();
    };
    for(let arm=0;arm<7;arm++){
        const base=arm/7*W;
        for(const ox of[-W,0,W]){
            drawFlow(base+ox,20+(arm%3)*4);
            drawFlow(base+ox+W*.055,3.5);
        }
    }
});
whirlWaterTex.wrapS=THREE.RepeatWrapping;whirlWaterTex.wrapT=THREE.ClampToEdgeWrapping;
whirlWaterTex.colorSpace=THREE.SRGBColorSpace;
whirlWaterTex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
// 漩涡泡沫：六条分段主臂配合柔和底纹，避免旧贴图像一大片交叉白线。
const whirlFoamTex=mkTex(1024,512,(x,W,H)=>{
    x.clearRect(0,0,W,H);x.lineCap='round';x.lineJoin='round';
    const soft=x.createLinearGradient(0,H,0,0);
    soft.addColorStop(0,'rgba(225,249,255,0)');soft.addColorStop(.16,'rgba(225,249,255,.18)');
    soft.addColorStop(.48,'rgba(235,252,255,.58)');soft.addColorStop(.82,'rgba(235,252,255,.32)');
    soft.addColorStop(1,'rgba(235,252,255,0)');
    const bright=x.createLinearGradient(0,H,0,0);
    bright.addColorStop(0,'rgba(255,255,255,0)');bright.addColorStop(.2,'rgba(249,255,255,.24)');
    bright.addColorStop(.5,'rgba(252,255,255,.86)');bright.addColorStop(.84,'rgba(247,255,255,.46)');
    bright.addColorStop(1,'rgba(247,255,255,0)');
    const path=x0=>{
        x.beginPath();x.moveTo(x0,H+22);
        x.bezierCurveTo(x0+W*.08,H*.76,x0+W*.38,H*.38,x0+W*.58,-22);
    };
    for(let arm=0;arm<6;arm++){
        const base=arm/6*W;
        for(const ox of[-W,0,W]){
            x.setLineDash([]);path(base+ox);x.strokeStyle=soft;x.lineWidth=19;x.stroke();
            x.setLineDash([54,28,16,24]);x.lineDashOffset=arm*-13;
            path(base+ox);x.strokeStyle=bright;x.lineWidth=5;x.stroke();
        }
    }
    x.setLineDash([]);
    // 外缘零散泡沫珠让圆周更自然；固定伪随机序列保证每次加载外观一致。
    let seed=7349;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
    for(let i=0;i<90;i++){
        const px=rnd()*W,py=H*(.06+rnd()*.48),rr=1.2+rnd()*3.2;
        x.fillStyle=`rgba(239,253,255,${.16+rnd()*.34})`;
        x.beginPath();x.arc(px,py,rr,0,Math.PI*2);x.fill();
    }
});
whirlFoamTex.wrapS=THREE.RepeatWrapping;whirlFoamTex.wrapT=THREE.ClampToEdgeWrapping;
whirlFoamTex.colorSpace=THREE.SRGBColorSpace;
whirlFoamTex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
// 中心暗洞使用普通平面 UV，径向渐变才能在世界中保持完整圆形。
const whirlCoreTex=mkTex(256,256,(x,W,H)=>{
    const g=x.createRadialGradient(W*.5,H*.5,2,W*.5,H*.5,W*.5);
    g.addColorStop(0,'rgba(0,5,12,1)');g.addColorStop(.34,'rgba(1,10,21,1)');
    g.addColorStop(.63,'rgba(2,22,37,.96)');g.addColorStop(.82,'rgba(8,55,75,.58)');
    g.addColorStop(1,'rgba(20,105,128,0)');x.fillStyle=g;x.fillRect(0,0,W,H);
    const glint=x.createRadialGradient(W*.43,H*.4,0,W*.43,H*.4,W*.28);
    glint.addColorStop(0,'rgba(52,137,161,.18)');glint.addColorStop(1,'rgba(52,137,161,0)');
    x.fillStyle=glint;x.fillRect(0,0,W,H);
});
whirlCoreTex.colorSpace=THREE.SRGBColorSpace;
function mkWhirlpool(x,z,fixedScale){
    const g=new THREE.Group();
    const rTop=3.0,depth=2.4;
    // 元宵：漩涡本体视觉与常规漩涡【完全一致】（同一套贴图/层级/抬升），
    // 只在中心额外立一盏大型祈福花灯。引力判定保留（whirlZones）→ 玩家进入被"送回岸边"。
    const isLantern=isFestival('festival_lantern');
    let lantern=null;
    // 随机大小：1/1.5/2/2.5/3 倍（0.5 档位）；双人模式客机使用房主同步的固定缩放
    const wm=fixedScale||(1+Math.floor(Math.random()*5)*.5);
    // ---- 漩涡本体（漏斗 + 浪花 + 暗洞） ----
    // 各层直接拟合屏幕上真正显示的水面三角网格，再以极小世界空间偏移保持层序。
    const disk=mkWaveDisk(rTop,16,72,new THREE.MeshBasicMaterial({map:whirlWaterTex,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false,fog:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),1,1);
    disk.renderOrder=5;g.add(disk);
    const foam=mkWaveDisk(rTop*.98,14,72,new THREE.MeshBasicMaterial({map:whirlFoamTex,transparent:true,opacity:.72,side:THREE.DoubleSide,depthWrite:false,fog:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),1,1);
    foam.renderOrder=6;g.add(foam);
    const core=mkWaveDisk(.88,6,64,new THREE.MeshBasicMaterial({map:whirlCoreTex,transparent:true,opacity:1,side:THREE.DoubleSide,depthWrite:false,fog:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}),1,1,'planar');
    core.renderOrder=7;g.add(core);
    g.scale.setScalar(wm);
    g.position.set(x,0,z);scene.add(g);
    // 边缘浪花环 + 引力提示圈（贴浪面网格，不会被海浪盖住）
    const rim=mkWaveRing(2,72,new THREE.MeshBasicMaterial({map:wakeTex,transparent:true,opacity:.85,depthWrite:false,fog:false,side:THREE.DoubleSide}),3);
    rim.renderOrder=8; // 浪花环盖在漩涡边缘之上（depthWrite=false 时按 renderOrder 分层）
    const field=mkWaveRing(1,72,new THREE.MeshBasicMaterial({color:0x66ccff,transparent:true,opacity:.25,depthWrite:false,fog:false,side:THREE.DoubleSide}),1);
    field.renderOrder=4;
    scene.add(rim,field);
    const zone={x,z,r:rTop*wm,depth};whirlZones.push(zone);
    // 创建即同步一次顶点（其余帧由 updateWhirlpools 每帧刷新），
    // 否则生成后到下个更新帧之间贴图会平躺在 y=0 高度闪一下
    disk.userData.update(x,z,wm,.12);foam.userData.update(x,z,wm,.14);core.userData.update(x,z,wm,.16);
    rim.userData.update(x,z,2.3*wm,3.9*wm,.52);field.userData.update(x,z,4.6*wm,5*wm,.24);
    if(isLantern){
        // 元宵：中心一盏祈福孔明灯（唯一、居中、体量适中、略浮于水面之上）
        const L=mkWhirlLantern();
        L.scale.setScalar(2.1);
        const lanternGroup=new THREE.Group();
        lanternGroup.add(L);
        lanternGroup.position.set(x,0,z);
        lanternGroup.userData.yaw=0;
        // renderOrder 已在 mkWhirlLantern 内每个 Mesh 上设置（20），Group 上设置无效
        scene.add(lanternGroup);
        lantern=lanternGroup;
    }
    return{group:g,disk,foam,core,rim,field,zone,life:9+Math.random()*4,x,z,scale:wm,depth,lantern,isLanternFx:isLantern};
}
function spawnWhirlpool(){
    if(!duckModel)return;
    const ang=Math.random()*Math.PI*2,dist=12+Math.random()*16;
    whirlpools.push(mkWhirlpool(duckModel.position.x+Math.cos(ang)*dist,duckModel.position.z+Math.sin(ang)*dist));
}
window.__whirlTest={
    spawn:near=>{if(!duckModel)return;const d=near||6;whirlpools.push(mkWhirlpool(duckModel.position.x+d,duckModel.position.z));return whirlpools.length},
    spawnAt:(x,z,scale=1,visualOnly=false)=>{const w=mkWhirlpool(Number(x)||0,Number(z)||0,Math.max(.5,Number(scale)||1));w.visualOnly=!!visualOnly;if(w.visualOnly)w.life=60;whirlpools.push(w);return whirlpools.length},
    clear:()=>{for(const w of whirlpools)w.life=0;return whirlpools.length}, // 全部标记消散（下一帧清理）
    suppress:seconds=>{whirlSpawnTimer=-Math.max(1,Number(seconds)||120);return-whirlSpawnTimer}, // QA 平静场景：指定时间内不随机生成
    info:()=>whirlpools.map(w=>({lantern:!!w.isLanternFx,hasDisk:!!w.disk,diskLift:w.disk&&w.disk.userData.update?'sync':'no',diskDepthWrite:w.disk?w.disk.material.depthWrite:null,diskPolygonOffset:w.disk?w.disk.material.polygonOffset:null,diskRenderOrder:w.disk?w.disk.renderOrder:null})),
    // 检查漩涡 disk 顶点与实际可见水面的差值（应等于抬升 .12/ws）
    checkSync:()=>{const w=whirlpools[0];if(!w)return'no whirl';if(!w.disk)return'lantern whirlpool (no disk)';const ws=w.scale||1;const pos=w.disk.geometry.attributes.position;let maxDiff=0,samples=0;const cx=w.x,cz=w.z;for(let i=0;i<pos.count;i+=20){const lx=pos.getX(i),lz=pos.getZ(i);const wx=cx+lx*ws,wz=cz+lz*ws;const wh=renderedWaveHeight(wx,wz);const expected=(wh+.12)/ws;const actual=pos.getY(i);const diff=Math.abs(actual-expected);if(diff>maxDiff)maxDiff=diff;samples++}return{maxDiff:samples?maxDiff.toFixed(4):0,samples}}
};
window.__auraTest={
    info:()=>({depthWrite:auraMesh.material.depthWrite,renderOrder:auraMesh.renderOrder,visible:auraMesh.visible,opacity:auraMesh.material.opacity})
};
// 调试：强制切换节日（key 如 'lantern'/'dragon_boat'，null 清除）+ 附近生成物品
window.__debugFestival=key=>Blessings.applyDebugSelection(null,key);
window.__dbgSpawn=(type,count)=>dbgSpawnItem(type,count);
window.__debugEvent=key=>{if(activeEvent)endEvent();if(key)startEvent(key);return activeEvent};
window.__setGameClock=value=>{const next=Number(value);if(Number.isFinite(next))gameClock=Math.max(0,next);return gameClock};
window.__comboHintState=()=>comboTargetDebugState();
// 调试：把相机对准世界坐标点（视觉自检截图用），暂停自动跟随
window.__lookAt=(tx,ty,tz,dist=20,ang=.5)=>{
    cam.followPaused=true;
    controls.target.set(tx,ty,tz);
    camera.position.set(tx+Math.cos(ang)*dist,ty+dist*.55,tz+Math.sin(ang)*dist);
    camera.lookAt(controls.target);
};
// 调试：相机 Y 采样（验证随浪起伏平滑度）+ 解除手动锁定恢复自动跟随
window.__camY=()=>camera.position.y;
window.__unlockCam=()=>{cam.followPaused=false};
// 临时测试钩子：暴露游戏内部状态用于双人模式同步验证
window.__gameState=()=>({
    itemsCount:items.length,
    itemsActive:items.filter(i=>!i.coll).length,
    itemsTypes:items.filter(i=>!i.coll).map(i=>i.type),
    itemsPositions:items.filter(i=>!i.coll).map(i=>[i.type,Math.round(i.mesh.position.x*10)/10,Math.round(i.mesh.position.z*10)/10]),
    whirlpoolsCount:whirlpools.length,
    whirlpoolsPos:whirlpools.map(w=>[Math.round(w.x*10)/10,Math.round(w.z*10)/10,Math.round(w.scale*100)/100]),
    festival:Blessings.festival?.id||null,
    duckPos:duckModel?[Math.round(duckModel.position.x*10)/10,Math.round(duckModel.position.z*10)/10]:null,
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
    duoSceneStats:{...duoSceneStats,last:duoSceneStats.last?{...duoSceneStats.last}:null},
    duoNetwork:snapshotDuoNetStats(),
    duoStableIds:{count:items.filter(it=>Number.isInteger(it.duoId)&&it.duoId>0).length,unique:new Set(items.filter(it=>Number.isInteger(it.duoId)&&it.duoId>0).map(it=>it.duoId)).size},
    itemResourceStats:{...itemResourceStats},
    opening:{progress:Math.round(openingGraceProgress()*1000)/1000,activeSeconds:Math.round(runActiveSeconds*1000)/1000,guaranteedMagnet:openingMagnetGuaranteed,refreshTimer:Math.round(spawnRefreshTimer*1000)/1000},
    streakProgress:[...streakItems],
    comboHint:comboTargetDebugState(),
    score:score,
    hearts:hearts,
    gameActive:gameActive,
    isPaused:typeof isPaused!=='undefined'?isPaused:null,
    frameCount:typeof frameCount!=='undefined'?frameCount:null,
    fps:typeof fpsValue!=='undefined'?fpsValue:null,
    drsScale:quality.drsScale,
    rendererMemory:renderer?{geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}:null,
    rendererFrame:renderer?{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,points:renderer.info.render.points,lines:renderer.info.render.lines}:null,
    camera:camera?{x:+camera.position.x.toFixed(4),y:+camera.position.y.toFixed(4),z:+camera.position.z.toFixed(4)}:null,
    cameraTarget:controls?{x:+controls.target.x.toFixed(4),y:+controls.target.y.toFixed(4),z:+controls.target.z.toFixed(4)}:null,
    cameraOrbitRadius:controls?+camera.position.distanceTo(controls.target).toFixed(4):null,
    cameraFollow:cam?{paused:cam.followPaused,interacting:cam.userInteracting}:null,
    camShake:+camShake.toFixed(4),screenShake:+screenShakeT.toFixed(4),
    storm:getStormDebug(),
    localNameLabel:duoLocalNameLabel?{renderOrder:duoLocalNameLabel.renderOrder,depthTest:duoLocalNameLabel.material.depthTest,depthWrite:duoLocalNameLabel.material.depthWrite}:null,
    remoteNameLabel:duoRemoteDuck?.children.find(node=>node.userData?.duoNameLabel)?(()=>{const label=duoRemoteDuck.children.find(node=>node.userData?.duoNameLabel);return{renderOrder:label.renderOrder,depthTest:label.material.depthTest,depthWrite:label.material.depthWrite}})():null,
    // 双人同步调试：本地/远程鸭子位置 + 远程特效状态
    localDuckPos:duckModel?{x:Math.round(duckModel.position.x*100)/100,y:Math.round(duckModel.position.y*100)/100,z:Math.round(duckModel.position.z*100)/100}:null,
    camY:camera?Math.round(camera.position.y*1000)/1000:null,
    remoteDuckPos:duoRemoteDuck?{x:Math.round(duoRemoteDuck.position.x*100)/100,y:Math.round(duoRemoteDuck.position.y*100)/100,z:Math.round(duoRemoteDuck.position.z*100)/100}:null,
    remoteDuckVisible:duoRemoteDuck?duoRemoteDuck.visible:null,
    remoteTarget:duoRemoteTarget?{x:Math.round(duoRemoteTarget.x*100)/100,z:Math.round(duoRemoteTarget.z*100)/100,sh:duoRemoteTarget.sh,mt:duoRemoteTarget.mt,cm:duoRemoteTarget.cm,bt:duoRemoteTarget.bt,iv:duoRemoteTarget.iv}:null,
    remoteShieldVisible:(()=>{const fx=duoRemoteDebugFxSnapshot();return fx.shield?fx.shield.visible:null})(),
    remoteMagnetRingVisible:(()=>{const fx=duoRemoteDebugFxSnapshot();return fx.ring?fx.ring.visible:null})(),
    remoteMagnetParticlesVisible:(()=>{const fx=duoRemoteDebugFxSnapshot();return fx.particles?fx.particles.visible:null})(),
    remoteCrownVisible:(()=>{const fx=duoRemoteDebugFxSnapshot();return fx.crown?fx.crown.visible:null})(),
    remoteAuraVisible:(()=>{const fx=duoRemoteDebugFxSnapshot();return fx.aura?fx.aura.visible:null})(),
    remoteDuckScale:duoRemoteDuck?Math.round(duoRemoteDuck.scale.x*100)/100:null,
    sharkExists:typeof shark!=='undefined'&&shark?{x:Math.round(shark.g.position.x*100)/100,z:Math.round(shark.g.position.z*100)/100}:null,
    waveEventActive:typeof waveEventActive!=='undefined'?waveEventActive:null,
    waveEventDir:typeof waveEventDir!=='undefined'?{x:Math.round(waveEventDir.x*100)/100,z:Math.round(waveEventDir.z*100)/100}:null,
    waveEventDuration:typeof waveEventDuration!=='undefined'?Math.round(waveEventDuration*100)/100:null,
    localShield:typeof hasShield!=='undefined'?{active:hasShield,timer:typeof shieldTimer!=='undefined'?Math.round(shieldTimer*100)/100:null}:null,
    localMagnet:typeof magnetActive!=='undefined'?{active:magnetActive,timer:typeof magnetTimer!=='undefined'?Math.round(magnetTimer*100)/100:null,comboTimer:Math.round(comboMagnetTimer*100)/100,range:magnetFxActive()?activeMagnetRange():0,particleCount:magParticleGeo.drawRange.count,trailCount:magnetTrails.filter(line=>line.visible).length}:null,
    localBigTimer:typeof bigTimer!=='undefined'?Math.round(bigTimer*100)/100:null,
    localInvincible:typeof invincible!=='undefined'?Math.round(invincible*100)/100:null
});
window.__resourceState=()=>{
    const sceneGeometries=new Set(),sceneMaterials=new Set(),itemGeometries=new Set(),itemMaterials=new Set();
    let sceneMeshes=0,itemMeshes=0,sceneObjects=0,itemObjects=0;
    const collect=(root,geometries,materials,isScene)=>root?.traverse(node=>{if(isScene)sceneObjects++;else itemObjects++;if(!node.isMesh&&!node.isPoints&&!node.isLine&&!node.isSprite)return;if(isScene)sceneMeshes++;else itemMeshes++;if(node.geometry)geometries.add(node.geometry);if(node.material){const mats=Array.isArray(node.material)?node.material:[node.material];for(const mat of mats)if(mat)materials.add(mat)}});
    collect(scene,sceneGeometries,sceneMaterials,true);for(const item of items)collect(item.mesh,itemGeometries,itemMaterials,false);
    return{renderer:{geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures},scene:{geometries:sceneGeometries.size,materials:sceneMaterials.size,meshes:sceneMeshes,objects:sceneObjects},items:{count:items.length,geometries:itemGeometries.size,materials:itemMaterials.size,meshes:itemMeshes,objects:itemObjects,respawning:items.filter(item=>item.respawning).length,hidden:items.filter(item=>item.duoHidden).length},quality:{requested:graphicsQuality,effective:quality.effectiveTier||graphicsQuality,segments:waveMesh.geometry.userData.detail,shadows:renderer.shadowMap.enabled,waveHz:quality.waveUpdateHz,normalHz:quality.waveNormalHz,shadowHz:quality.shadowUpdateHz,drs:quality.drsScale},water:waterGetUpdateStats(),transient:{active:transientFx.length,...transientResourceStats},skinTextures:{cached:duckSkinTextureCache.size,limit:DUCK_SKIN_TEXTURE_CACHE_LIMIT},disposed:{...itemResourceStats}};
};
window.__perfState=()=>({
    visibility:document.visibilityState,role:Duo.active?Duo.role:null,fps:fpsValue,clock:gameClock,drs:quality.drsScale,quality:{requested:graphicsQuality,effective:quality.effectiveTier||graphicsQuality,shadows:renderer.shadowMap.enabled,waveHz:quality.waveUpdateHz,normalHz:quality.waveNormalHz,shadowHz:quality.shadowUpdateHz},water:waterGetUpdateStats(),
    frames:{...framePerf},network:snapshotDuoNetStats(),sceneSync:{...duoSceneStats,last:duoSceneStats.last?{...duoSceneStats.last}:null},
    camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z},duck:duckModel?{x:duckModel.position.x,y:duckModel.position.y,z:duckModel.position.z}:null,
    camShake,screenShakeT,items:items.length,renderer:{geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}
});
const _lanternUp=new THREE.Vector3(0,1,0);
const _lanternNormal=new THREE.Vector3();
const _lanternTiltQ=new THREE.Quaternion();
const _lanternYawQ=new THREE.Quaternion();
const _lanternTargetQ=new THREE.Quaternion();
function updateWhirlpools(dt,surfaceChanged=true){
    // 漩涡贴图旋转动画：沿圆周方向（UV-U）滚动 = 螺旋水流旋转，泡沫反向转更有层次
    whirlWaterTex.offset.x=(whirlWaterTex.offset.x+dt*.09)%1;
    whirlFoamTex.offset.x=(whirlFoamTex.offset.x-dt*.13+1)%1;
    for(let i=whirlpools.length-1;i>=0;i--){
        const w=whirlpools[i];
        // duo guest：life 和物品销毁由房主场景同步负责，客机跳过避免不同步
        if(!duoIsGuest())w.life-=dt;
        const ws=w.scale||1;       // 漩涡缩放倍数
        const R=WHIRL_PULL_RADIUS*ws; // 影响半径（与残血血瓶安全落点共用同一边界）
        const SINK_R=1.0*ws;       // 进入中心阈值：到达此处触发沉没动画
        // ---- 漩涡本体（元宵/常规完全一致的视觉与动画） ----
        // 五层网格合计约 3156 个顶点；水面未变化时重复拟合没有任何视觉收益。
        if(surfaceChanged){
            w.disk.userData.update(w.x,w.z,ws,.12);
            w.foam.userData.update(w.x,w.z,ws,.14);
            w.core.userData.update(w.x,w.z,ws,.16);
            w.rim.userData.update(w.x,w.z,2.3*ws,3.9*ws,.52);
            w.field.userData.update(w.x,w.z,4.6*ws,5*ws,.24);
        }
        // 漩涡贴图随昼夜变暗（MeshBasicMaterial 自发光，否则夜晚亮得突兀）
        w.disk.material.color.setScalar(envBright);w.foam.material.color.setScalar(envBright);
        w.core.material.color.setScalar(envBright);w.rim.material.color.setScalar(envBright);
        w.field.material.color.setHex(0x66ccff);w.field.material.color.multiplyScalar(envBright);
        w.rim.material.opacity=.55+Math.sin(gameClock*5+i)*.25;
        w.field.material.opacity=.16+Math.sin(gameClock*3+i)*.1;
        if(w.lantern){
            // 元宵中心孔明灯：采样整个底座所覆盖的浪面，而不是只读漩涡最低的中心点。
            // 用采样平面同时求支撑高度和水面坡度，灯笼便会像荷叶等漂浮物一样贴浪升降、随浪倾摆。
            const model=w.lantern.children[0],ls=model.scale.x;
            const samples=model.userData.floatSamples,heights=model.userData.floatHeights;
            const yaw=w.lantern.userData.yaw||0,cy=Math.cos(yaw),sy=Math.sin(yaw);
            let sumH=0,sumXH=0,sumZH=0,sumXX=0,sumZZ=0;
            for(let si=0;si<samples.length;si++){
                const sample=samples[si];
                const lx=sample.x*ls,lz=sample.y*ls;
                const dx=lx*cy+lz*sy,dz=-lx*sy+lz*cy;
                const h=renderedWaveHeight(w.x+dx,w.z+dz);
                heights[si]=h;sumH+=h;sumXH+=dx*h;sumZH+=dz*h;sumXX+=dx*dx;sumZZ+=dz*dz;
            }
            const support=sumH/samples.length;
            let slopeX=sumXX>0?sumXH/sumXX:0,slopeZ=sumZZ>0?sumZH/sumZZ:0;
            // 真实浪面坡度为主，叠加与普通漂浮物同节奏的细微摇摆；限制倾角避免巨浪把灯笼掀翻。
            const maxSlope=Math.tan(.16);
            slopeX=THREE.MathUtils.clamp(slopeX,-maxSlope,maxSlope)+Math.sin(gameClock*1.2+w.x)*.018;
            slopeZ=THREE.MathUtils.clamp(slopeZ,-maxSlope,maxSlope)-Math.cos(gameClock*1.0+w.z)*.015;
            // 以最终（已限幅）的倾斜平面重新求净空，强浪下即使倾角受限，底座高侧也不会切入浪面。
            let clearance=0;
            for(let si=0;si<samples.length;si++){
                const sample=samples[si];
                const lx=sample.x*ls,lz=sample.y*ls;
                const dx=lx*cy+lz*sy,dz=-lx*sy+lz*cy;
                clearance=Math.max(clearance,heights[si]-(support+slopeX*dx+slopeZ*dz));
            }
            const lift=model.userData.bottomExtent*ls+.012;
            w.lantern.position.set(w.x,support+clearance+lift,w.z);
            _lanternNormal.set(-slopeX,1,-slopeZ).normalize();
            _lanternTiltQ.setFromUnitVectors(_lanternUp,_lanternNormal);
            w.lantern.userData.yaw=(yaw+dt*.08)%(Math.PI*2);
            _lanternYawQ.setFromAxisAngle(_lanternUp,w.lantern.userData.yaw);
            _lanternTargetQ.copy(_lanternTiltQ).multiply(_lanternYawQ);
            // 与水面本帧姿态保持同相；若做滞后插值，高侧会在巨浪突变时短暂切进水面。
            w.lantern.quaternion.copy(_lanternTargetQ);
        }
        // 定向视觉回归只验证水面贴合与 UI 层级，不允许测试漩涡改变玩家/道具状态。
        if(w.visualOnly){
            if(!duoIsGuest()&&w.life<=0){disposeWhirlpoolVisuals(w);const zi=whirlZones.indexOf(w.zone);if(zi>=0)whirlZones.splice(zi,1);whirlpools.splice(i,1)}
            continue;
        }
        if(gameActive&&duckModel&&duckSink.state==='none'){
            const dx=w.x-duckModel.position.x,dz=w.z-duckModel.position.z;const d=Math.sqrt(dx*dx+dz*dz);
            const whirlImmune=Blessings.isWhirlImmune();
            updateDangerNearMiss(w,d,SINK_R,WHIRL_NEAR_MARGIN*ws,WHIRL_NEAR_EXIT*ws,!w.isLanternFx&&!whirlImmune&&invincible<=0);
            if(d<R&&d>0.001){
                const nx=dx/d,nz=dz/d;
                // 动态引力：越靠近中心越强（指数曲线 ratio^5），远处温和可感知，近处暴增
                const ratio=1-d/R;          // 0=远，1=中心
                const wr=whirlImmune?0:1-(activeRewards.whirlResist||0); // 祝福免伤优先，其次是成就永久抗性
                const pull=(Math.pow(ratio,5)*60+ratio*3)*wr;  // 边缘~3，中段~5，近处~63（暴增）
                duckVel.x+=nx*pull*dt;duckVel.z+=nz*pull*dt;
                // 切向旋涡（随距离指数增强）
                const tan=(Math.pow(ratio,4)*15+ratio*2)*wr;
                duckVel.x+=-nz*tan*dt;duckVel.z+=nx*tan*dt;
                // 到达中心 → 触发沉没动画：护盾(hasShield)不能挡，只有无敌(invincible>0)可挡
                if(d<SINK_R&&invincible<=0&&!whirlImmune){
                    cancelNearMissCandidates();if(w._nearMiss)w._nearMiss.done=true;
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
        if(!duoIsGuest()&&w.life<=0){disposeWhirlpoolVisuals(w);const zi=whirlZones.indexOf(w.zone);if(zi>=0)whirlZones.splice(zi,1);whirlpools.splice(i,1)}
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
            const beforeHearts=hearts;hearts=Math.max(0,hearts-1);resetCollectionChain(runStats);recordHealthTransition(beforeHearts,hearts);if(hearts===1)heartTimer=0;updateHeartsUI();screenFlash();playSFX('whirl');
            // 成就追踪：累计被漩涡吸入次数
            Achievements.updateStat('whirlDeaths',1);
            if(hearts<=0){D.state='none';gameOver();return}
            // 重生到安全位置（原点附近）；吃掉鸭子的漩涡随之消散（防止重生后被同一漩涡反复吞没）
            duckModel.position.set(0,.05,0);duckVel.set(0,0,0);cancelNearMissCandidates();
            duckModel.scale.setScalar(.72);duckModel.rotation.y=0;
            if(D.whirl)D.whirl.life=0;
            invincible=2;
            toast('<i class="fa-solid fa-water"></i> 被漩涡吸入 -1 <i class="fa-solid fa-heart"></i>','m');
            D.state='none';D.whirl=null;
        }
    }
}

// ---- 水下暗影（鲨鱼） ----
let shark=null,duoSharkTarget=null,sharkHitCd=0,sharkSpawnCount=0,sharkAttackCount=0,eventSharkSpawnCount=0;
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
    if(duoIsGuest()&&duoSharkTarget){
        const dx=duoSharkTarget.x-p.x,dz=duoSharkTarget.z-p.z,err2=dx*dx+dz*dz;
        if(err2>25){p.x=duoSharkTarget.x;p.z=duoSharkTarget.z}
        else{const k=1-Math.exp(-dt*8);p.x+=dx*k;p.z+=dz*k}
        let rd=duoSharkTarget.ry-shark.g.rotation.y;rd=Math.atan2(Math.sin(rd),Math.cos(rd));
        shark.g.rotation.y+=rd*(1-Math.exp(-dt*8));
    }
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
function removeShark(){if(shark){scene.remove(shark.g);scene.remove(shark.wake);disposeTransientVisual(shark.g);disposeTransientVisual(shark.wake);shark=null}}

// ---- 随机事件系统（每30秒全局触发） ----
// 难度递进只统计玩家实际可操作时间；祝福卡、教程、竖屏提示和后台停留不会偷跑难度。
function difficultyFactor(){
    return Math.min(1,runActiveSeconds/300);
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
    if(!gameActive||festivalFxDimmed())return;
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
        'new_years_eve':{id:'festival_eve',name:'除夕',greeting:'爆竹声中一岁除，春风送暖入屠苏。',desc:'金色纸片 · 开局自带 1 层护盾',icon:'fa-champagne-glasses',target:'shield',value:1,fx:'#ffd166'},
        'spring':{id:'festival_spring',name:'春节',greeting:'新春大吉，鸭鸭给你拜年啦！',desc:'烟花绽放 · 初始 5 颗心',icon:'fa-burst',target:'startHearts',value:5,fx:'#ffd166'},
        'lantern':{id:'festival_lantern',name:'元宵',greeting:'花好月圆人团圆，元宵快乐！',desc:'孔明灯升空 · 祈福灯笼漩涡吸入只传送不扣分',icon:'fa-lightbulb',target:'lanternWhirl',value:1,fx:'#ffb3c6'},
        'dragon_heads':{id:'festival_dragon_heads',name:'龙抬头',greeting:'二月二龙抬头，鸿运当头好兆头！',desc:'青金粒子 · 磁铁持续时间 +50%',icon:'fa-dragon',target:'magnet',mult:1.5,fx:'#a8e6cf'},
        'qingming':{id:'festival_qingming',name:'清明',greeting:'清明时节雨纷纷，路上行人欲断魂。',desc:'青叶飘落 · 生命上限 +1',icon:'fa-cloud-rain',target:'maxHearts',value:1,fx:'#a8d8ea'},
        '0501':{id:'festival_labor',name:'劳动节',greeting:'劳动最光荣，今天也要加油鸭！',desc:'金青粒子 · 移动速度 +30%',icon:'fa-sun',target:'speed',mult:1.3,fx:'#ffd166'},
        'dragon_boat':{id:'festival_dragon_boat',name:'端午',greeting:'粽叶飘香，端午安康！',desc:'水草变粽子 · 绿叶飘落 · 得分 ×3',icon:'fa-water',target:'grass',mult:3,fx:'#9fe6b8'},
        'qixi':{id:'festival_qixi',name:'七夕',greeting:'金风玉露一相逢，便胜却人间无数。',desc:'粉紫爱心 · 花朵得分 ×3',icon:'fa-heart',target:'flower',mult:3,fx:'#ffafcc'},
        'zhongyuan':{id:'festival_zhongyuan',name:'中元节',greeting:'河灯盏盏，思念绵绵。',desc:'鬼火浮现 · 漩涡免伤',icon:'fa-fire',target:'whirl',value:1,fx:'#cdb4db'},
        'mid_autumn':{id:'festival_mid_autumn',name:'中秋',greeting:'海上生明月，天涯共此时。',desc:'白黄星光 · 夜空明月 · 月亮血条 · 所有得分 ×1.5',icon:'fa-moon',target:'score',mult:1.5,fx:'#ffe3a3'},
        'double_ninth':{id:'festival_double_ninth',name:'重阳节',greeting:'遥知兄弟登高处，遍插茱萸少一人。',desc:'金叶飘落 · 开局自带 1 层护盾',icon:'fa-mountain-sun',target:'shield',value:1,fx:'#ffc8a2'},
        '1001':{id:'festival_national_day',name:'国庆',greeting:'山河锦绣，国泰民安，假期快乐！',desc:'礼花星光 · 红旗飘扬 · 撞碎蛋糕得分',icon:'fa-flag',target:'cakeRocks',value:1,fx:'#ff9d6b'},
        'winter_solstice':{id:'festival_winter_solstice',name:'冬至',greeting:'冬至大如年，人间小团圆。',desc:'四角冰花 · 所有得分 ×1.5',icon:'fa-snowflake',target:'score',mult:1.5,fx:'#bde0fe'},
        'laba':{id:'festival_laba',name:'腊八节',greeting:'过了腊八就是年，粥到福到！',desc:'四角雾气 · 水草得分 ×2',icon:'fa-bowl-food',target:'grass',mult:2,fx:'#e6c79c'},
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

// ===== 节日场景特效：统一屏幕粒子 / 国庆红旗 / 中秋月亮（灯笼漩涡/粽子/蛋糕在生成处特判） =====
// 节日判定（TDZ 安全）：模块级初始化早于 Blessings 声明，typeof 无法挡 TDZ，需 try/catch 兜底
function isFestival(id){try{return typeof Blessings!=='undefined'&&Blessings.festival?.id===id}catch(e){return false}}
// 元旦磁铁范围 ×2
function getMagnetRange(){return MAGNET_RANGE*(isFestival('festival_new_year')?2:1)}
function disposeFestivalObject(root){
    if(!root)return;
    const geometries=new Set(),materials=new Set(),textures=new Set();
    root.traverse(node=>{
        if(node.geometry)geometries.add(node.geometry);
        if(node.material){
            const list=Array.isArray(node.material)?node.material:[node.material];
            for(const material of list)if(material){materials.add(material);if(material.map)textures.add(material.map)}
        }
    });
    scene.remove(root);
    for(const geometry of geometries)geometry.dispose();
    for(const texture of textures)texture.dispose();
    for(const material of materials)material.dispose();
}
const _flagFrustum=new THREE.Frustum();
const _flagViewProjection=new THREE.Matrix4();
const _flagBounds=new THREE.Sphere(new THREE.Vector3(),1.65);
const _moonBase=new THREE.Vector3(); // 中秋月亮世界空间定位回退原点（duckModel 未就绪时）
function festivalFxDimmed(){
    return rotateHintActive||['#blessing-splash','#settings-modal','#pause-overlay','#tutorial','#ach-modal','#help','#gameover','#duo-respawn'].some(selector=>document.querySelector(selector)?.classList.contains('show'));
}
const festivalScreenFx=createFestivalScreenFx({
    window,document,
    getQuality:()=>quality.effectiveTier||graphicsQuality,
    getReducedMotion:()=>reduceFestivalMotion,
    isPaused:()=>isPaused,
    isHidden:()=>document.hidden||!gameActive,
    isDimmed:festivalFxDimmed
});
const FestivalFx={
    activeId:null,screen:festivalScreenFx,
    flagsGroup:null,
    moonSprite:null, // 中秋：挂在天空盒上的大满月（世界空间远处，参与深度测试）
    start(options={}){
        const id=Blessings.festival?.id;
        if(!id){this.stop();return false}
        if(this.activeId===id){if(!options.deferIntro)this.screen.playIntro();return true}
        this.clearWorld();this.activeId=id;
        this.screen.start(id,options);
        if(id==='festival_national_day')this.startFlags();
        if(id==='festival_mid_autumn')this.startMoon();
        return true;
    },
    clearWorld(){
        if(this.flagsGroup){disposeFestivalObject(this.flagsGroup);this.flagsGroup=null}
        if(this.moonSprite){disposeFestivalObject(this.moonSprite);this.moonSprite=null}
    },
    stop(){
        this.screen.stop();this.activeId=null;
        this.clearWorld();
    },
    playIntro(){return this.screen.playIntro()},
    updateWorld(dt){
        if(this.flagsGroup)this.updateFlags(dt);
        if(this.moonSprite)this.updateMoon();
    },
    updateScreen(dt){this.screen.update(dt)},
    update(dt){this.updateWorld(dt);this.updateScreen(dt)},
    resize(){this.screen.resize()},
    info(){return{...this.screen.getDebugState(),flags:!!this.flagsGroup,moon:!!this.moonSprite,
        moonState:this.moonSprite?{visible:this.moonSprite.visible,opacity:+this.moonSprite.material.opacity.toFixed(3),scale:+this.moonSprite.scale.x.toFixed(2),pos:[+this.moonSprite.position.x.toFixed(1),+this.moonSprite.position.y.toFixed(1),+this.moonSprite.position.z.toFixed(1)]}:null,
        knownIds:FESTIVAL_SCREEN_FX_IDS.length}},
    // --- 国庆：全场景红旗飘扬 ---
    startFlags(){
        // 标准 3:2 比例与 30×20 国旗坐标；小星各有一个尖角准确朝向大星。
        const flagTex=mkTex(384,256,(x,w,h)=>{
            x.fillStyle='#de2910';x.fillRect(0,0,w,h);
            // 极淡经纬织纹、边缘明暗与包边缝线，让近景有布料层次但不增加额外贴图。
            const shade=x.createLinearGradient(0,0,w,0);
            shade.addColorStop(0,'rgba(78,0,0,.16)');shade.addColorStop(.12,'rgba(255,255,255,.035)');
            shade.addColorStop(.72,'rgba(255,255,255,.015)');shade.addColorStop(1,'rgba(72,0,0,.11)');
            x.fillStyle=shade;x.fillRect(0,0,w,h);
            x.lineWidth=1;
            x.strokeStyle='rgba(255,255,255,.045)';
            for(let py=2;py<h;py+=4){x.beginPath();x.moveTo(0,py);x.lineTo(w,py);x.stroke()}
            x.strokeStyle='rgba(72,0,0,.045)';
            for(let px=2;px<w;px+=5){x.beginPath();x.moveTo(px,0);x.lineTo(px,h);x.stroke()}
            x.fillStyle='rgba(82,0,0,.14)';x.fillRect(0,0,13,h);x.fillRect(0,0,w,5);x.fillRect(0,h-5,w,5);
            x.strokeStyle='rgba(255,225,168,.3)';x.lineWidth=1.5;x.setLineDash([5,6]);
            x.beginPath();x.moveTo(10,7);x.lineTo(10,h-7);x.stroke();x.setLineDash([]);
            const unit=w/30;
            const star=(gx,gy,r,tipAngle)=>{
                x.beginPath();
                for(let i=0;i<10;i++){
                    const a=tipAngle+i*Math.PI/5,rr=(i%2===0?r:r*.382)*unit;
                    const px=gx*unit+Math.cos(a)*rr,py=gy*unit+Math.sin(a)*rr;
                    if(i===0)x.moveTo(px,py);else x.lineTo(px,py);
                }
                x.closePath();x.fill();
            };
            x.fillStyle='#ffde00';
            const big={x:5,y:5};star(big.x,big.y,3,-Math.PI/2);
            for(const small of[{x:10,y:2},{x:12,y:4},{x:12,y:7},{x:10,y:9}]){
                star(small.x,small.y,1,Math.atan2(big.y-small.y,big.x-small.x));
            }
        });
        flagTex.colorSpace=THREE.SRGBColorSpace;
        flagTex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
        const g=new THREE.Group();
        // 银色旗杆、金色顶饰/旗扣、红金浮座烘焙为一个顶点色网格，十面旗共享同一份资源。
        const staffParts=[];
        const addStaffPart=(geometry,color,position=[0,0,0],rotation=[0,0,0],scale=[1,1,1])=>{
            const transform=new THREE.Object3D();
            transform.position.set(...position);transform.rotation.set(...rotation);transform.scale.set(...scale);transform.updateMatrix();
            geometry.applyMatrix4(transform.matrix);
            const c=new THREE.Color(color),colors=new Float32Array(geometry.attributes.position.count*3);
            for(let i=0;i<geometry.attributes.position.count;i++){colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b}
            geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));staffParts.push(geometry);
        };
        addStaffPart(new THREE.CylinderGeometry(.16,.19,.11,18),0xb51f36,[0,.04,0]);
        addStaffPart(new THREE.TorusGeometry(.165,.022,8,20),0xf2c14e,[0,.095,0],[Math.PI/2,0,0]);
        addStaffPart(new THREE.CylinderGeometry(.065,.085,.07,12),0xf2c14e,[0,.13,0]);
        addStaffPart(new THREE.CylinderGeometry(.025,.032,2.65,10),0xd9dee5,[0,1.38,0]);
        addStaffPart(new THREE.CylinderGeometry(.046,.055,.09,12),0xf2c14e,[0,2.71,0]);
        addStaffPart(new THREE.SphereGeometry(.07,12,8),0xf2c14e,[0,2.79,0]);
        for(const y of[1.85,2.39])addStaffPart(new THREE.SphereGeometry(.034,10,8),0xf2c14e,[.032,y,0],[0,0,0],[1.25,.85,1]);
        const staffGeo=mergeGeometries(staffParts,false);staffParts.forEach(geometry=>geometry.dispose());
        if(!staffGeo)throw new Error('国庆旗杆几何合并失败');
        staffGeo.computeBoundingSphere();
        const staffMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.36,metalness:.24});
        // 顶点着色器飘动：uv.x=0 的整条旗杆侧严格固定；世界位置为每面旗生成不同相位。
        const flagMat=new THREE.MeshStandardMaterial({map:flagTex,side:THREE.DoubleSide,roughness:.68,metalness:0});
        flagMat.onBeforeCompile=sh=>{
            sh.uniforms.uTime={value:0};
            sh.uniforms.uFlutter={value:1};
            flagMat.userData.shader=sh;
            sh.vertexShader='uniform float uTime;\nuniform float uFlutter;\n'+sh.vertexShader.replace('#include <begin_vertex>',
                `#include <begin_vertex>
                float anchor=smoothstep(0.0,.12,uv.x);
                float tip=uv.x*uv.x;
                float phase=dot(modelMatrix[3].xz,vec2(.071,.113));
                float primary=sin(uv.x*7.4-uTime*4.8+phase);
                float ripple=sin(uv.x*16.0-uTime*7.1+phase*1.7+(uv.y-.5)*2.2);
                transformed.z+=(primary*.055+ripple*.018)*anchor*(.25+.75*tip)*uFlutter;
                transformed.y+=sin(uv.x*5.1-uTime*3.8+phase+(uv.y-.5)*1.4)*.018*anchor*tip*uFlutter;`);
        };
        const flagGeo=new THREE.PlaneGeometry(.9,.6,18,8);
        flagGeo.translate(.45,0,0); // 左边缘对齐旗杆轴线，整条根部不参与形变。
        const center=duckModel?duckModel.position:{x:0,z:0};
        const initialWindYaw=-Math.atan2(evWindDir.z,evWindDir.x);
        for(let i=0;i<10;i++){
            const fg=new THREE.Group();
            const staff=new THREE.Mesh(staffGeo,staffMat);staff.castShadow=true;fg.add(staff);
            const flag=new THREE.Mesh(flagGeo,flagMat);
            flag.position.set(.032,2.12,0);fg.add(flag);
            const ang=i/10*Math.PI*2+(duoRand(i*7.1+1)-.5)*.42,dist=10+duoRand(i*11.3+3)*23;
            fg.position.set(center.x+Math.cos(ang)*dist,0,center.z+Math.sin(ang)*dist);
            fg.userData={index:i,ph:duoRand(i*13.7+5)*Math.PI*2,windYaw:initialWindYaw,recycles:0};
            fg.rotation.y=initialWindYaw;
            g.add(fg);
        }
        g.userData.flagMaterial=flagMat;g.userData.flagSize={width:.9,height:.6};
        scene.add(g);this.flagsGroup=g;
    },
    updateFlags(dt){
        const sh=this.flagsGroup.userData.flagMaterial?.userData?.shader;
        if(sh){
            sh.uniforms.uTime.value=gameClock;
            const targetFlutter=stormActive?1.5:windActive?1.25:1;
            sh.uniforms.uFlutter.value+=(targetFlutter-sh.uniforms.uFlutter.value)*Math.min(1,dt*2.4);
        }
        const center=duckModel?duckModel.position:{x:0,z:0};
        const targetWindYaw=-Math.atan2(evWindDir.z,evWindDir.x);
        // 回收必须发生在镜头外：雾起点不是“不可见边界”，只按距离会让旗帜在清晰区域瞬移。
        camera.updateMatrixWorld();
        _flagViewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
        _flagFrustum.setFromProjectionMatrix(_flagViewProjection);
        for(const fg of this.flagsGroup.children){
            const dx=fg.position.x-center.x,dz=fg.position.z-center.z;
            fg.position.y=renderedWaveHeight(fg.position.x,fg.position.z)-.025;
            _flagBounds.center.set(fg.position.x,fg.position.y+1.4,fg.position.z);
            if(dx*dx+dz*dz>55*55&&!_flagFrustum.intersectsSphere(_flagBounds)){
                const recycleIndex=fg.userData.recycles+1;
                // 从确定性候选中选择一个同样位于视锥外的位置，避免新旗突然出现在镜头正前方。
                for(let attempt=0;attempt<12;attempt++){
                    const seed=fg.userData.index*37+recycleIndex*101+attempt*53;
                    const ang=duoRand(seed+1)*Math.PI*2,dist=18+duoRand(seed+2)*18;
                    const nx=center.x+Math.cos(ang)*dist,nz=center.z+Math.sin(ang)*dist;
                    const ny=renderedWaveHeight(nx,nz)-.025;
                    _flagBounds.center.set(nx,ny+1.4,nz);
                    if(_flagFrustum.intersectsSphere(_flagBounds))continue;
                    fg.userData.recycles=recycleIndex;
                    fg.position.set(nx,ny,nz);
                    break;
                }
            }
            let diff=targetWindYaw-fg.userData.windYaw;diff=Math.atan2(Math.sin(diff),Math.cos(diff));
            fg.userData.windYaw+=diff*Math.min(1,dt*.9);
            // 同向迎风但略有独立摆头；真正的布面形变由不同相位的顶点着色器完成。
            fg.rotation.y=fg.userData.windYaw+Math.sin(gameClock*.38+fg.userData.ph)*.035;
        }
    },
    // --- 中秋：大满月挂在天空盒上（世界空间远处，参与深度测试，被近景自然遮挡）。 ---
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
            // 低对比度月海与环形山，让月盘缩小后仍有层次，而不是一块过曝白圆。
            x.fillStyle='rgba(168,145,96,.13)';
            for(const crater of[[91,87,19,11,-.35],[157,103,14,22,.42],[112,151,25,14,.18],[164,160,12,8,-.2],[75,139,10,17,.5]]){
                x.beginPath();x.ellipse(crater[0],crater[1],crater[2],crater[3],crater[4],0,6.283);x.fill();
            }
            x.strokeStyle='rgba(255,249,222,.2)';x.lineWidth=2;
            x.beginPath();x.arc(151,77,12,0,6.283);x.stroke();
        });
        // 挂在天空盒上：保留默认 depthTest(true)，让月盘与天空盒一起被近处云朵/鸭子自然遮挡；
        // 仅关 depthWrite，避免透明月盘挡住后续半透明物。不设 renderOrder、不关深度、不跟随相机。
        const mat=new THREE.SpriteMaterial({map:tex,transparent:true,opacity:0,fog:false,depthWrite:false});
        const s=new THREE.Sprite(mat);
        s.scale.set(46,46,1);
        scene.add(s);this.moonSprite=s;
    },
    updateMoon(){
        if(!this.moonSprite)return;
        // 夜晚最亮，白天仍保留淡淡月盘（中秋月白天也可见，但更柔）。
        const h=((timeOfDay%24)+24)%24;
        const nightF=h>=19?Math.min(1,(h-19)/.8):h<5?1:0;
        // 天空盒式定位：世界空间远处高空，随鸭子平移保持可见、随相机转动有正确视差，
        // 整体比旧版（前方约 34、高约 26）更远、更靠下，让满月真正落在“后面天空盒”上。
        const base=duckModel?duckModel.position:_moonBase;
        this.moonSprite.position.set(base.x+18,17+Math.sin(gameClock*.2)*1.2,base.z-100);
        this.moonSprite.material.opacity=.45+nightF*.5;
        this.moonSprite.visible=gameActive;
    }
};
window.__festivalFxTest={
    info:()=>FestivalFx.info(),
    themes:()=>FESTIVAL_SCREEN_FX_IDS.map(id=>({id,label:FESTIVAL_SCREEN_FX_THEMES[id].label,theme:FESTIVAL_SCREEN_FX_THEMES[id].theme,mode:FESTIVAL_SCREEN_FX_THEMES[id].mode,palette:[...FESTIVAL_SCREEN_FX_THEMES[id].palette],quality:{...FESTIVAL_SCREEN_FX_THEMES[id].quality}})),
    particles:()=>FestivalFx.screen.getParticleSnapshot(),
    playIntro:()=>FestivalFx.playIntro(),
    setReducedMotion:value=>{reduceFestivalMotion=!!value;FestivalFx.screen.setReducedMotion(reduceFestivalMotion);return FestivalFx.info()}
};
window.__flagTest={
    info:()=>{
        const group=FestivalFx.flagsGroup;
        if(!group)return{active:false};
        const geometries=new Set(),materials=new Set(),textures=new Set();let meshes=0;
        group.traverse(node=>{if(!node.isMesh)return;meshes++;if(node.geometry)geometries.add(node.geometry);if(node.material){materials.add(node.material);if(node.material.map)textures.add(node.material.map)}});
        const material=group.userData.flagMaterial,texture=material?.map;
        return{active:true,count:group.children.length,meshes,geometries:geometries.size,materials:materials.size,textures:textures.size,
            flagSize:group.userData.flagSize,textureSize:texture?{width:texture.image.width,height:texture.image.height}:null,colorSpace:texture?.colorSpace||null,
            shaderReady:!!material?.userData?.shader,positions:group.children.map(fg=>({x:+fg.position.x.toFixed(2),y:+fg.position.y.toFixed(2),z:+fg.position.z.toFixed(2),yaw:+fg.rotation.y.toFixed(3)}))};
    }
};
// --- 元宵：漩涡中心漂浮的祈福孔明灯 ---
// 宣纸贴图：暖橙纸面 + 竹骨阴影 + 顶部收口褶皱 + 纸面纤维颗粒 + 灯身"福"字（祈福特写细节）
let _skyLanternTex=null;
function getSkyLanternTex(){
    if(_skyLanternTex)return _skyLanternTex;
    _skyLanternTex=mkTex(512,512,x=>{
        // 纸面底色：暖橙红（深一点防止阳光下洗白）
        const bg=x.createLinearGradient(0,512,0,0);
        bg.addColorStop(0,'#d95a14');bg.addColorStop(.35,'#c8430c');bg.addColorStop(.8,'#a83308');bg.addColorStop(1,'#8f2806');
        x.fillStyle=bg;x.fillRect(0,0,512,512);
        // 纸面纤维颗粒（宣纸质感）
        for(let i=0;i<600;i++){
            x.fillStyle=`rgba(${120+Math.random()*80|0},${40+Math.random()*40|0},10,${.02+Math.random()*.04})`;
            x.fillRect(Math.random()*512,Math.random()*512,1+Math.random()*2,1+Math.random()*2);
        }
        // 中间烛光光晕（居中，从内部透出的暖光）
        const centerGlow=x.createRadialGradient(256,300,15,256,300,200);
        centerGlow.addColorStop(0,'rgba(255,250,200,.45)');
        centerGlow.addColorStop(.4,'rgba(255,210,120,.18)');
        centerGlow.addColorStop(1,'rgba(255,210,120,0)');
        x.fillStyle=centerGlow;x.fillRect(30,50,452,412);
        // 底部烛光光晕
        const gl=x.createLinearGradient(0,512,0,320);
        gl.addColorStop(0,'rgba(255,230,170,.28)');gl.addColorStop(1,'rgba(255,230,170,0)');
        x.fillStyle=gl;x.fillRect(0,320,512,192);
        // 灯身"福"字（居中）
        x.save();
        x.translate(256,280);x.rotate(-.03);
        x.fillStyle='rgba(120,18,6,.5)';
        x.font='bold 140px "KaiTi","STKaiti","SimSun",serif';
        x.textAlign='center';x.textBaseline='middle';
        x.fillText('福',0,0);
        x.restore();
    });
    _skyLanternTex.wrapS=THREE.RepeatWrapping;_skyLanternTex.wrapT=THREE.ClampToEdgeWrapping;
    _skyLanternTex.repeat.set(4,1); // 横向重复 4 次包裹方筒
    return _skyLanternTex;
}
// 孔明灯 emissive 贴图：中间亮、四周暗（烛光从内部透出的效果）
let _skyLanternEmissiveTex=null;
function getSkyLanternEmissiveTex(){
    if(_skyLanternEmissiveTex)return _skyLanternEmissiveTex;
    _skyLanternEmissiveTex=mkTex(512,256,x=>{
        // 中间暖黄亮区（烛光位置，居中）
        const g=x.createRadialGradient(256,140,10,256,140,130);
        g.addColorStop(0,'rgba(255,255,230,1)');
        g.addColorStop(.3,'rgba(255,230,150,.8)');
        g.addColorStop(.7,'rgba(255,200,100,.25)');
        g.addColorStop(1,'rgba(200,120,40,0)');
        x.fillStyle=g;x.fillRect(0,0,512,256);
        // 底部更亮（烛光在下，横向连续）
        const bg=x.createLinearGradient(0,256,0,100);
        bg.addColorStop(0,'rgba(255,220,120,.2)');bg.addColorStop(1,'rgba(255,220,120,0)');
        x.fillStyle=bg;x.fillRect(0,100,512,156);
    });
    _skyLanternEmissiveTex.wrapS=THREE.RepeatWrapping;_skyLanternEmissiveTex.wrapT=THREE.ClampToEdgeWrapping;
    _skyLanternEmissiveTex.repeat.set(4,1); // 横向重复 4 次包裹方筒
    return _skyLanternEmissiveTex;
}
function mkWhirlLantern(){
    // 孔明灯：上下等宽方筒纸灯罩 + 棱角竹骨 + 顶部封口 + 底部竹圈 + 中间烛光发光
    const g=new THREE.Group();
    const RO=20;
    const bambooMat=new THREE.MeshStandardMaterial({color:0xb9904f,roughness:.6});
    const paperMat=new THREE.MeshStandardMaterial({
        map:getSkyLanternTex(),roughness:.7,metalness:0,
        side:THREE.DoubleSide,
        emissive:0xffaa40,emissiveIntensity:.5,
        emissiveMap:getSkyLanternEmissiveTex()
    });
    const sqF=th=>{const c=Math.abs(Math.cos(th)),s=Math.abs(Math.sin(th));
        return Math.pow(Math.pow(c,4)+Math.pow(s,4),-.25)};
    // 上下等宽方筒
    const H=1.0, R=.44;
    const faceArc=Math.PI/2;
    for(let f=0;f<4;f++){
        const baseAng=f*Math.PI/2;
        const SEG_U=8, SEG_V=8;
        const geo=new THREE.PlaneGeometry(1,1,SEG_U,SEG_V);
        const p=geo.attributes.position;
        const uv=geo.attributes.uv;
        for(let i=0;i<p.count;i++){
            const u=uv.getX(i), v=uv.getY(i);
            const th=baseAng+u*faceArc;
            const r=R*sqF(th);
            p.setXYZ(i,Math.cos(th)*r, v*H, Math.sin(th)*r);
            // UV 映射：每个面都覆盖完整贴图（0~1），这样每个面都能看到完整的发光效果
            uv.setXY(i, u, v);
        }
        geo.computeVertexNormals();
        const face=new THREE.Mesh(geo,paperMat);
        face.renderOrder=RO;g.add(face);
    }
    // 纵向竹骨条：4 根立在接缝上
    for(let f=0;f<4;f++){
        const ang=f*Math.PI/2+Math.PI/4;
        const pts=[];
        for(let v=0;v<=8;v++){
            const y=v/8*H;
            const r=R*sqF(ang);
            pts.push(new THREE.Vector3(Math.cos(ang)*r,y,Math.sin(ang)*r));
        }
        const rib=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),8,.01,5),bambooMat);
        rib.renderOrder=RO;g.add(rib);
    }
    // 顶部封口（覆盖整个方口的纸片）
    const topShape=new THREE.Shape();
    const topSegs=16;
    for(let i=0;i<=topSegs;i++){
        const th=i/topSegs*Math.PI*2;
        const rr=R*sqF(th);
        if(i===0) topShape.moveTo(Math.cos(th)*rr,Math.sin(th)*rr);
        else topShape.lineTo(Math.cos(th)*rr,Math.sin(th)*rr);
    }
    const topGeo=new THREE.ShapeGeometry(topShape);
    const topMesh=new THREE.Mesh(topGeo,paperMat);
    topMesh.position.y=H;topMesh.rotation.x=Math.PI/2;topMesh.renderOrder=RO;g.add(topMesh);
    // 顶部竹圈
    const topRingPts=[];
    for(let i=0;i<=16;i++){
        const th=i/16*Math.PI*2;
        const rr=R*sqF(th)+.008;
        topRingPts.push(new THREE.Vector3(Math.cos(th)*rr,H,Math.sin(th)*rr));
    }
    const topRing=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(topRingPts,true),32,.018,6),bambooMat);
    topRing.renderOrder=RO;g.add(topRing);
    // 底部方竹圈
    const ringPts=[];
    for(let i=0;i<=16;i++){
        const th=i/16*Math.PI*2;
        const rr=R*sqF(th)+.008;
        ringPts.push(new THREE.Vector3(Math.cos(th)*rr,.01,Math.sin(th)*rr));
    }
    const ring=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts,true),32,.02,6),bambooMat);
    ring.renderOrder=RO;g.add(ring);
    // 底部封口
    const botShape=new THREE.Shape();
    for(let i=0;i<=16;i++){const th=i/16*Math.PI*2;const rr=R*sqF(th);if(i===0)botShape.moveTo(Math.cos(th)*rr,Math.sin(th)*rr);else botShape.lineTo(Math.cos(th)*rr,Math.sin(th)*rr);}
    const botGeo=new THREE.ShapeGeometry(botShape);
    const botMesh=new THREE.Mesh(botGeo,paperMat);
    botMesh.position.y=0;botMesh.rotation.x=Math.PI/2;botMesh.renderOrder=RO;g.add(botMesh);
    ring.renderOrder=RO;g.add(ring);
    // 中间烛光：只用点光源照亮内部，纸罩 emissive 让光"透"出来
    const light=new THREE.PointLight(0xff9040,2.5,1.75);
    light.position.y=H*.4;g.add(light);
    // 漂浮采样点沿灯笼底座外缘分布，供漩涡更新拟合局部浪面支撑平面。
    const floatSamples=[new THREE.Vector2(0,0)];
    for(let i=0;i<8;i++){
        const a=i/8*Math.PI*2,rr=R*sqF(a);
        floatSamples.push(new THREE.Vector2(Math.cos(a)*rr,Math.sin(a)*rr));
    }
    g.userData.floatSamples=floatSamples;
    g.userData.floatHeights=new Float32Array(floatSamples.length);
    // 最低点是底部竹圈（中心 y=.01、管径 .02）；留少量余量即可贴住水线，不再悬空。
    g.userData.bottomExtent=.015;
    return g;
}
// --- 端午：粽子（替代水草） ---
// 粽身底纹：保留大块叶色、压折阴影和纤维，立体覆叶负责主要层次，避免细节互相打架。
let _zongziTex=null;
function getZongziTex(){
    if(_zongziTex)return _zongziTex;
    _zongziTex=mkTex(512,512,(x,W,H)=>{
        const bg=x.createLinearGradient(0,0,0,H);
        bg.addColorStop(0,'#43a952');bg.addColorStop(.42,'#2b873b');bg.addColorStop(1,'#17602b');
        x.fillStyle=bg;x.fillRect(0,0,W,H);
        // 8 条可无缝衔接的纵向叶折：宽阴影旁配窄高光，远看仍能读出包裹方向。
        for(let i=0;i<=8;i++){
            const px=i*64;
            const fold=x.createLinearGradient(px-18,0,px+18,0);
            fold.addColorStop(0,'rgba(7,52,20,0)');fold.addColorStop(.42,'rgba(7,48,18,.22)');
            fold.addColorStop(.58,'rgba(190,232,163,.13)');fold.addColorStop(1,'rgba(190,232,163,0)');
            x.fillStyle=fold;x.fillRect(px-18,0,36,H);
            x.strokeStyle='rgba(202,236,178,.22)';x.lineWidth=1.5;
            x.beginPath();x.moveTo(px+5,0);x.bezierCurveTo(px-3,H*.34,px+10,H*.68,px+2,H);x.stroke();
        }
        // 少量细长纤维，透明度刻意压低，避免实际游戏尺寸下形成噪点。
        for(let i=0;i<28;i++){
            const px=(i*137)%W,lean=((i*29)%19)-9;
            x.strokeStyle=`rgba(214,240,190,${.025+(i%4)*.012})`;x.lineWidth=.7+(i%3)*.25;
            x.beginPath();x.moveTo(px,H);x.bezierCurveTo(px+lean,H*.7,px-lean,H*.32,px+lean*.4,0);x.stroke();
        }
    });
    _zongziTex.wrapS=THREE.RepeatWrapping;_zongziTex.wrapT=THREE.ClampToEdgeWrapping;
    _zongziTex.colorSpace=THREE.SRGBColorSpace;
    _zongziTex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    return _zongziTex;
}
// 单片粽叶贴图：中脉 + 细密侧脉 + 叶缘压暗（用于 3D 叶片几何）
let _leafTex=null;
function getLeafTex(){
    if(_leafTex)return _leafTex;
    _leafTex=mkTex(256,512,(x,W,H)=>{
        const bg=x.createLinearGradient(0,512,0,0);
        bg.addColorStop(0,'#236b2c');bg.addColorStop(.54,'#338f3e');bg.addColorStop(1,'#55b65b');
        x.fillStyle=bg;x.fillRect(0,0,W,H);
        // 中脉由暗槽、亮脊两层组成，比单根粗白线更像真实叶脉。
        const cv=x.createLinearGradient(0,H,0,0);
        cv.addColorStop(0,'rgba(219,239,184,.64)');cv.addColorStop(1,'rgba(239,249,207,.88)');
        x.strokeStyle='rgba(12,67,24,.26)';x.lineWidth=10;
        x.beginPath();x.moveTo(W*.5,H+4);x.bezierCurveTo(W*.48,H*.66,W*.52,H*.34,W*.5,-4);x.stroke();
        x.strokeStyle=cv;x.lineWidth=4;
        x.beginPath();x.moveTo(W*.5,H+4);x.bezierCurveTo(W*.48,H*.66,W*.52,H*.34,W*.5,-4);x.stroke();
        // 侧脉数量减半并逐渐收尖，保留近看精度而不产生摩尔纹。
        for(let i=0;i<12;i++){
            const y0=30+i*40,reach=104-Math.abs(i-5.5)*2.8;
            x.strokeStyle='rgba(211,237,187,'+(.13+(i%3)*.025)+')';x.lineWidth=1.35;
            x.beginPath();x.moveTo(W*.5,y0);x.quadraticCurveTo(W*.28,y0+8,W*.5-reach,y0+30);x.stroke();
            x.beginPath();x.moveTo(W*.5,y0);x.quadraticCurveTo(W*.72,y0+8,W*.5+reach,y0+30);x.stroke();
        }
        // 叶缘压暗（卷曲阴影感）
        const eg=x.createLinearGradient(0,0,W,0);
        eg.addColorStop(0,'rgba(7,46,16,.58)');eg.addColorStop(.1,'rgba(7,46,16,.06)');
        eg.addColorStop(.9,'rgba(7,46,16,.06)');eg.addColorStop(1,'rgba(7,46,16,.58)');
        x.fillStyle=eg;x.fillRect(0,0,W,H);
        for(let i=0;i<18;i++){
            const px=8+(i*53)%(W-16);
            x.strokeStyle=`rgba(232,247,211,${.025+(i%3)*.01})`;x.lineWidth=.7;
            x.beginPath();x.moveTo(px,H);x.lineTo(px+((i%5)-2)*5,0);x.stroke();
        }
    });
    _leafTex.wrapS=_leafTex.wrapT=THREE.ClampToEdgeWrapping;
    _leafTex.colorSpace=THREE.SRGBColorSpace;
    _leafTex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    return _leafTex;
}
// 麻绳绞纹贴图：斜向明暗条纹绕在环面上 = 绞丝感
let _ropeTex=null;
function getRopeTex(){
    if(_ropeTex)return _ropeTex;
    _ropeTex=mkTex(128,64,(x,W,H)=>{
        const bg=x.createLinearGradient(0,0,0,H);
        bg.addColorStop(0,'#e2c47b');bg.addColorStop(.5,'#c99d4e');bg.addColorStop(1,'#a97835');
        x.fillStyle=bg;x.fillRect(0,0,W,H);
        x.lineCap='round';
        // 32px 周期可无缝平铺；暗缝和细高光构成两股交捻的稻草绳。
        for(let i=-3;i<=7;i++){
            const px=i*32;
            x.strokeStyle='rgba(111,73,27,.58)';x.lineWidth=7;
            x.beginPath();x.moveTo(px,H+5);x.lineTo(px+38,-5);x.stroke();
            x.strokeStyle='rgba(255,239,186,.48)';x.lineWidth=2;
            x.beginPath();x.moveTo(px+6,H+5);x.lineTo(px+44,-5);x.stroke();
        }
    });
    _ropeTex.wrapS=_ropeTex.wrapT=THREE.RepeatWrapping;
    _ropeTex.repeat.set(4,1);
    _ropeTex.colorSpace=THREE.SRGBColorSpace;
    _ropeTex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    return _ropeTex;
}
let _zongziTemplate=null;
function mkZongzi(x,z){
    // 所有粽子造型完全一致：缓存一个不入场景的模板，clone 时共享 Geometry / Material，
    // 既减少批量生成开销，也避免刷新淘汰后 GPU 资源随实例数量持续增长。
    if(_zongziTemplate){
        const instance=_zongziTemplate.clone(true);
        instance.userData.sharedItemResources=true;
        instance.position.set(x,0,z);
        return instance;
    }
    // 卡通圆润粽子：球面顶点向正四面体面投影并向外融合 → 饱满圆角的四面粽
    const g=new THREE.Group();
    const bodyMat=new THREE.MeshStandardMaterial({map:getZongziTex(),roughness:.68,metalness:0});
    const geo=new THREE.SphereGeometry(1,48,32);
    // 正四面体四个面的外法线（四个顶点方向取反）
    const tetV=[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]].map(v=>new THREE.Vector3(v[0],v[1],v[2]).normalize());
    const tetN=tetV.map(v=>v.clone().negate());
    const IN=.7,SPH=2.0,Q=.5; // 圆角更饱满，同时保留清晰的四面粽轮廓
    const pos=geo.attributes.position;const d=new THREE.Vector3();
    for(let i=0;i<pos.count;i++){
        d.set(pos.getX(i),pos.getY(i),pos.getZ(i)).normalize();
        let t=1e9;
        for(const n of tetN){const c=d.dot(n);if(c>1e-4)t=Math.min(t,IN/c)}
        const r=t*(1-Q)+SPH*Q;
        pos.setXYZ(i,d.x*r,d.y*r,d.z*r);
    }
    geo.computeVertexNormals();
    // 一个顶点朝上（底部为平面，稳稳坐在水面）
    const qUp=new THREE.Quaternion().setFromUnitVectors(tetV[0],new THREE.Vector3(0,1,0));
    geo.applyQuaternion(qUp);
    geo.scale(.16,.175,.16);
    const body=new THREE.Mesh(geo,bodyMat);
    body.position.y=.27;body.castShadow=true;g.add(body);
    // 卡通描边：略大的反面 hull，深绿轮廓线
    const outline=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x14521f,side:THREE.BackSide}));
    outline.scale.setScalar(1.028);outline.position.copy(body.position);g.add(outline);
    // 叶棱：从顶尖到三个底角的叶脉压边（深绿细管，沿棱线微微外鼓）
    const seamMat=new THREE.MeshStandardMaterial({color:0x1b6b2c,roughness:.72,metalness:0});
    const rVert=(IN/(1/3))*(1-Q)+SPH*Q;   // 顶点处半径
    const rEdge=(IN/(1/Math.sqrt(3)))*(1-Q)+SPH*Q; // 棱中点处半径
    const apex=new THREE.Vector3(0,1,0).multiplyScalar(rVert);
    for(let k=1;k<4;k++){
        const base=tetV[k].clone().applyQuaternion(qUp).multiplyScalar(rVert);
        const mid=tetV[0].clone().add(tetV[k]).normalize().applyQuaternion(qUp).multiplyScalar(rEdge*1.05);
        const sv=v=>new THREE.Vector3(v.x*.16,v.y*.175,v.z*.16).add(new THREE.Vector3(0,.27,0));
        const curve=new THREE.QuadraticBezierCurve3(sv(apex),sv(mid),sv(base));
        const seam=new THREE.Mesh(new THREE.TubeGeometry(curve,16,.011,6),seamMat);
        g.add(seam);
    }
    // 3D 粽叶包裹：三个侧面各覆一片独立叶形几何（真粽子是"叶子包出来的"，贴图画不出叠压感）
    // 叶片顶点直接按角度投影到粽身表面（与 body 同一套投影函数），零悬浮完美贴合
    const leafFrame=new THREE.Group();
    leafFrame.quaternion.copy(qUp);leafFrame.scale.set(.16,.175,.16);leafFrame.position.y=.27;
    g.add(leafFrame);
    const leafTex=getLeafTex();
    const leafMats=[0xf2ffe9,0xe8f8e0,0xf7ffed].map(color=>new THREE.MeshStandardMaterial({
        map:leafTex,bumpMap:leafTex,bumpScale:.008,color,roughness:.66,metalness:0,side:THREE.DoubleSide,
        polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1
    }));
    // 粽身半径函数（与上面的投影同一套）：给定方向求表面距离
    const rOf=dir=>{let t=1e9;for(const nn of tetN){const c=dir.dot(nn);if(c>1e-4)t=Math.min(t,IN/c)}return t*(1-Q)+SPH*Q};
    for(let k=1;k<4;k++){
        const n=tetN[k]; // 含顶尖的侧面外法线
        const u=tetV[0].clone().sub(n.clone().multiplyScalar(tetV[0].dot(n))).normalize(); // 面内朝顶尖
        const wAxis=new THREE.Vector3().crossVectors(n,u).normalize(); // 面内横向
        // 角度域铺叶：ty 沿叶长（-0.55 靠近底棱 → +1.32 越过顶尖），tx 沿叶宽（±0.5 锥形收尖）
        const ROWS=14,COLS=8;
        const lg=new THREE.PlaneGeometry(1,1,COLS,ROWS); // 仅用于拿拓扑，顶点全量重写
        const lp=lg.attributes.position,luv=lg.attributes.uv;
        const tmp=new THREE.Vector3();
        for(let i=0;i<lp.count;i++){
            const ny=luv.getY(i),nx=luv.getX(i); // 0..1
            const ty=-0.55+ny*1.87; // 叶长覆盖角
            const wProf=Math.sin(Math.pow(Math.max(ny,.02),.8)*Math.PI); // 叶形：中部宽两端尖
            const tx=(nx-.5)*1.0*Math.max(.05,wProf);
            tmp.copy(n).addScaledVector(u,Math.tan(ty)).addScaledVector(wAxis,Math.tan(tx)*wProf).normalize();
            const rr=rOf(tmp)+.026+(k-1)*.012; // 三片叶逐层错开，顶尖处也能看清叠压关系
            lp.setXYZ(i,tmp.x*rr,tmp.y*rr,tmp.z*rr);
        }
        lg.computeVertexNormals();
        leafFrame.add(new THREE.Mesh(lg,leafMats[k-1]));
    }
    // 麻绳十字捆扎：腰横一圈 + 过顶纵一圈。每个控制点都复用粽身的 rOf/qUp 投影，
    // 再为描边、粽叶与绳管半径预留外移量，避免固定圆绳路切进圆角四面体。
    const ropeTex=getRopeTex();
    const ropeMat=new THREE.MeshStandardMaterial({map:ropeTex,bumpMap:ropeTex,bumpScale:.014,roughness:.86,metalness:0});
    const ropeRadius=.014,ropeLift=.028;
    const qDown=qUp.clone().invert();
    const bodyCenter=new THREE.Vector3(0,.27,0);
    const ropeSurfacePoint=(orientedDir,lift)=>{
        const bodyDir=orientedDir.clone().applyQuaternion(qDown).normalize();
        const p=bodyDir.multiplyScalar(rOf(bodyDir)).applyQuaternion(qUp);
        p.set(p.x*.16,p.y*.175,p.z*.16).add(bodyCenter);
        return p.addScaledVector(orientedDir,lift);
    };
    // 横向腰绳：固定方向纬度、逐点投影到真实表面，随三角粽身自然起伏。
    const waistPts=[],waistY=-.12,waistXZ=Math.sqrt(1-waistY*waistY),ROPE_SEG=48;
    for(let i=0;i<ROPE_SEG;i++){
        const a=i/ROPE_SEG*Math.PI*2;
        waistPts.push(ropeSurfacePoint(new THREE.Vector3(Math.cos(a)*waistXZ,waistY,Math.sin(a)*waistXZ),ropeLift));
    }
    const waistCurve=new THREE.CatmullRomCurve3(waistPts,true,'centripetal');
    const waistRope=new THREE.Mesh(new THREE.TubeGeometry(waistCurve,64,ropeRadius,8,true),ropeMat);
    g.add(waistRope);
    // 纵向绳：完整绕行 2π，从顶尖经底面再回到顶尖；不再使用会原路折返的旧三角波路径。
    const baseDir=tetV[1].clone().applyQuaternion(qUp);
    const meridianAng=Math.atan2(baseDir.z,baseDir.x),vertPts=[];
    for(let i=0;i<ROPE_SEG;i++){
        const a=i/ROPE_SEG*Math.PI*2,s=Math.sin(a);
        const dir=new THREE.Vector3(Math.cos(meridianAng)*s,Math.cos(a),Math.sin(meridianAng)*s);
        // 纵绳在腰绳交叉处局部抬起，明确上下穿插关系，不再糊成一条粗带。
        const crossLift=.019*Math.exp(-Math.pow((dir.y-waistY)/.13,2));
        vertPts.push(ropeSurfacePoint(dir,ropeLift+.003+crossLift));
    }
    const vertCurve=new THREE.CatmullRomCurve3(vertPts,true,'centripetal');
    const vertRope=new THREE.Mesh(new THREE.TubeGeometry(vertCurve,64,ropeRadius,8,true),ropeMat);
    g.add(vertRope);
    // 绳结和线头已去掉（用户反馈不需要）
    g.position.set(0,0,0);
    // 防穿模：道具漂浮逻辑对 grass 固定下沉 .06（水草从水里长出才压水面），
    // 粽子是"浮"在水上的，需要净抬高，否则底面被浪面切片
    g.userData.floatLift=.14;
    g.userData.sharedItemResources=true;
    _zongziTemplate=g;
    const instance=g.clone(true);
    instance.position.set(x,0,z);
    return instance;
}
// --- 国庆：双层庆典蛋糕（替代石头，撞碎得分） ---
let _cakeTemplate=null;
function buildCakeTemplate(){
    const parts=[];
    // 把全部小装饰烘焙为一个顶点色网格：造型更丰富，但每个蛋糕主体仍只有一次绘制。
    const addPart=(geometry,color,position=[0,0,0],rotation=[0,0,0],scale=[1,1,1])=>{
        const transform=new THREE.Object3D();
        transform.position.set(...position);transform.rotation.set(...rotation);transform.scale.set(...scale);transform.updateMatrix();
        geometry.applyMatrix4(transform.matrix);
        const c=new THREE.Color(color),colors=new Float32Array(geometry.attributes.position.count*3);
        for(let i=0;i<geometry.attributes.position.count;i++){colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b}
        geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
        parts.push(geometry);
    };
    // 金色托盘、香草蛋糕胚、红色夹心和双层镜面淋酱。
    addPart(new THREE.CylinderGeometry(.63,.66,.055,32),0xe5b84d,[0,.028,0]);
    addPart(new THREE.CylinderGeometry(.54,.58,.30,32),0xffe9c9,[0,.205,0]);
    addPart(new THREE.TorusGeometry(.555,.038,10,32),0xc91837,[0,.18,0],[Math.PI/2,0,0]);
    addPart(new THREE.TorusGeometry(.535,.045,10,32),0xffffff,[0,.34,0],[Math.PI/2,0,0]);
    addPart(new THREE.CylinderGeometry(.42,.46,.25,32),0xfff4df,[0,.485,0]);
    addPart(new THREE.CylinderGeometry(.445,.455,.075,32),0xd8203f,[0,.645,0]);
    addPart(new THREE.TorusGeometry(.43,.04,10,32),0xf44a5f,[0,.615,0],[Math.PI/2,0,0]);
    // 圆润滴落沿上层外缘错落分布，避免旧模型像两块简单圆柱堆起来。
    const dripHeights=[.12,.08,.15,.095,.13,.075];
    for(let i=0;i<dripHeights.length;i++){
        const a=i/dripHeights.length*Math.PI*2+.2,h=dripHeights[i];
        addPart(new THREE.SphereGeometry(.064,10,8),0xd8203f,[Math.cos(a)*.444,.60-h*.38,Math.sin(a)*.444],[0,0,0],[.72,h/.11,.72]);
    }
    // 一圈奶油花、金色糖珠与三颗莓果，轮廓在正常游戏距离下也能看清。
    for(let i=0;i<10;i++){
        const a=i/10*Math.PI*2;
        addPart(new THREE.SphereGeometry(.072,10,8),0xffffff,[Math.cos(a)*.34,.715,Math.sin(a)*.34],[0,0,0],[1,.62,1]);
        if(i%2===0)addPart(new THREE.SphereGeometry(.026,8,6),0xf4c44e,[Math.cos(a+.18)*.265,.752,Math.sin(a+.18)*.265]);
    }
    for(let i=0;i<3;i++){
        const a=i/3*Math.PI*2+.55,x=Math.cos(a)*.15,z=Math.sin(a)*.15;
        addPart(new THREE.SphereGeometry(.066,10,8),0xb50f2f,[x,.77,z],[0,0,0],[.9,1.12,.9]);
        addPart(new THREE.SphereGeometry(.035,8,6),0x3b8f45,[x,.83,z],[0,0,a],[1.3,.28,.65]);
    }
    // 中央金色签杆承托“10·1”庆典牌。
    addPart(new THREE.CylinderGeometry(.013,.017,.48,8),0xf4c44e,[0,.92,0]);
    const merged=mergeGeometries(parts,false);
    parts.forEach(geometry=>geometry.dispose());
    if(!merged)throw new Error('国庆蛋糕几何合并失败');
    merged.computeBoundingSphere();
    const body=new THREE.Mesh(merged,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.38,metalness:.04}));
    body.castShadow=true;body.receiveShadow=true;

    // 两片交叉的双面庆典牌保证从任意方向都能读到“10·1”，贴图和几何由全部实例共享。
    const signTex=mkTex(256,128,(x,w,h)=>{
        x.clearRect(0,0,w,h);x.fillStyle='#c91632';x.strokeStyle='#ffd66b';x.lineWidth=8;
        x.beginPath();x.roundRect(8,12,w-16,h-24,22);x.fill();x.stroke();
        const star=(cx,cy,r)=>{x.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r:r*.42;x.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr)}x.closePath();x.fill()};
        x.fillStyle='#ffd66b';star(48,64,27);
        x.font='900 58px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText('10·1',158,66);
    });
    signTex.colorSpace=THREE.SRGBColorSpace;signTex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    const signParts=[];
    for(const ry of[0,Math.PI/2]){
        const geo=new THREE.PlaneGeometry(.43,.215),transform=new THREE.Object3D();
        transform.position.set(0,1.04,0);transform.rotation.y=ry;transform.updateMatrix();geo.applyMatrix4(transform.matrix);signParts.push(geo);
    }
    const signGeo=mergeGeometries(signParts,false);signParts.forEach(geometry=>geometry.dispose());
    if(!signGeo)throw new Error('国庆蛋糕庆典牌合并失败');
    const sign=new THREE.Mesh(signGeo,new THREE.MeshBasicMaterial({map:signTex,side:THREE.DoubleSide,alphaTest:.08}));
    sign.castShadow=true;
    const g=new THREE.Group();g.add(body,sign);g.userData.sharedItemResources=true;return g;
}
function mkCake(p,s){
    if(!_cakeTemplate)_cakeTemplate=buildCakeTemplate();
    const instance=_cakeTemplate.clone(true);
    instance.userData.sharedItemResources=true;
    instance.position.copy(p);instance.scale.setScalar(s*1.4);
    return instance;
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
function getGraphicsPreset(level){
    const presets={
        low:{ratio:Math.min(devicePixelRatio,.85),wave:5,normals:24,waveHz:60,normalHz:4,environment:4,segments:36,shadows:false,shadowEvery:0,shadowHz:0},
        mid:{ratio:Math.min(devicePixelRatio,1),wave:4,normals:18,waveHz:60,normalHz:6,environment:3,segments:48,shadows:true,shadowEvery:4,shadowHz:15},
        high:{ratio:Math.min(devicePixelRatio*1.15,1.5),wave:3,normals:12,waveHz:60,normalHz:8,environment:2,segments:56,shadows:true,shadowEvery:3,shadowHz:20}
    };
    return presets[level]||presets.high;
}
function applyGraphicsQuality(level){
    graphicsQuality=['low','mid','high'].includes(level)?level:'high';
    const preset=getGraphicsPreset(graphicsQuality);
    quality.basePixelRatio=preset.ratio;quality.drsScale=1; // 切档时重置动态分辨率
    quality.renderPixelRatio=preset.ratio;
    quality.waveUpdateInterval=preset.wave;
    quality.waveNormalInterval=preset.normals;
    quality.waveUpdateHz=preset.waveHz;
    quality.stormWaveUpdateHz=60;
    quality.waveNormalHz=preset.normalHz;
    quality.environmentUpdateInterval=preset.environment;
    quality.shadowUpdateInterval=preset.shadowEvery;
    quality.shadowUpdateHz=preset.shadowHz;
    quality.restricted=false;
    quality.effectiveTier=graphicsQuality;
    setWaveDetail(preset.segments);
    renderer.setPixelRatio(quality.renderPixelRatio);
    renderer.setSize(innerWidth,innerHeight);
    renderer.shadowMap.enabled=preset.shadows;
    renderer.shadowMap.autoUpdate=false;
    renderer.shadowMap.needsUpdate=true;
    if(typeof resizeEnvironment==='function')resizeEnvironment();
    restrictedLowSeconds=0;restrictedRecoverySeconds=0;
    localStorage.setItem('duck_quality',graphicsQuality);
}
let restrictedLowSeconds=0,restrictedRecoverySeconds=0;
function setPerformanceRestricted(restricted){
    if(quality.restricted===restricted)return;
    const preset=getGraphicsPreset(graphicsQuality);
    quality.restricted=restricted;quality.effectiveTier=restricted?'restricted':graphicsQuality;
    quality.waveNormalHz=restricted?Math.min(3,preset.normalHz):preset.normalHz;
    quality.environmentUpdateInterval=restricted?Math.max(4,preset.environment):preset.environment;
    quality.shadowUpdateHz=restricted?0:preset.shadowHz;
    renderer.shadowMap.enabled=restricted?false:preset.shadows;
    setWaveDetail(restricted?Math.min(36,preset.segments):preset.segments);
    if(!restricted&&preset.shadows)renderer.shadowMap.needsUpdate=true;
    restrictedLowSeconds=0;restrictedRecoverySeconds=0;
}
function updatePerformanceRestriction(dt){
    if(!gameActive||document.visibilityState!=='visible'){restrictedLowSeconds=0;restrictedRecoverySeconds=0;return}
    if(!quality.restricted){
        if(fpsValue<45&&quality.drsScale<=.7)restrictedLowSeconds+=dt;else restrictedLowSeconds=Math.max(0,restrictedLowSeconds-dt*2);
        if(restrictedLowSeconds>=3)setPerformanceRestricted(true);
    }else{
        if(fpsValue>57&&quality.drsScale>=.9)restrictedRecoverySeconds+=dt;else restrictedRecoverySeconds=0;
        if(restrictedRecoverySeconds>=12)setPerformanceRestricted(false);
    }
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
const DUCK_SKIN_TEXTURE_CACHE_LIMIT=16;
function isDuckSkinTextureInUse(texture){
    let inUse=false;
    for(const root of[duckModel,duoRemoteDuck]){
        if(!root||inUse)continue;
        root.traverse(node=>{
            if(inUse||!node.material)return;
            const list=Array.isArray(node.material)?node.material:[node.material];
            if(list.some(material=>material?.map===texture))inUse=true;
        });
    }
    return inUse;
}
function pruneDuckSkinTextureCache(protectedTexture=null){
    if(duckSkinTextureCache.size<=DUCK_SKIN_TEXTURE_CACHE_LIMIT)return;
    for(const[key,texture]of duckSkinTextureCache){
        if(duckSkinTextureCache.size<=DUCK_SKIN_TEXTURE_CACHE_LIMIT)break;
        if(texture===protectedTexture||isDuckSkinTextureInUse(texture))continue;
        duckSkinTextureCache.delete(key);texture.dispose();
    }
}
function getDuckSkinTexture(source,skin,override){
    if(!source||skin==='classic')return source;
    const pal=getDuckPalette(skin,override);
    const key=source.uuid+'-'+skin+'-'+pal.color+pal.beak+pal.wing;
    if(duckSkinTextureCache.has(key)){
        const cached=duckSkinTextureCache.get(key);
        // Map 的插入顺序作为 LRU；命中时移到队尾。
        duckSkinTextureCache.delete(key);duckSkinTextureCache.set(key,cached);
        return cached;
    }
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
    // 返回给材质之前先保护本次新纹理；applyDuckSkinToRoot 完成赋值后会再次无保护清理。
    duckSkinTextureCache.set(key,texture);pruneDuckSkinTextureCache(texture);return texture;
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
    // 赋值完成后再清一次，可安全淘汰刚刚被替换、已无人引用的旧颜色贴图。
    pruneDuckSkinTextureCache();
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
        document.getElementById('set-sb-desc').textContent=festival
            ?`今日祝福效果：${b.desc}\n节日加成（${festival.name}）：${festival.desc}`
            :`今日祝福效果：${b.desc}`;
    }
    setSwitchState('set-music',musicOn);
    setSwitchState('set-sfx',sfxOn);
    setSwitchState('set-fps',document.getElementById('fps-hud').classList.contains('show'));
    setSwitchState('set-reduced-motion',reduceFestivalMotion);
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
document.getElementById('set-reduced-motion').onclick=()=>{reduceFestivalMotion=!reduceFestivalMotion;localStorage.setItem('duck_reduce_festival_motion',reduceFestivalMotion?'1':'0');FestivalFx.screen.setReducedMotion(reduceFestivalMotion);updateSettingsPanel()};
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
document.getElementById('set-joy').oninput=e=>{setJoySensitivity(Number(e.target.value)/100);localStorage.setItem('duck_joy_sensitivity',String(joySensitivity));document.getElementById('set-joy-val').textContent=joySensitivity.toFixed(1)};
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
    FestivalFx.playIntro();
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
// ===== 阶段 7-8 迁移模块依赖注入（惰性求值：箭头函数/访问器在运行期才解引用） =====
initDuoSceneSync({
    gameActive:()=>gameActive,items,RESPAWNING_ITEM_TYPES,scheduleItemRespawn,scene,
    gameClock:()=>gameClock,addGameClock:v=>gameClock+=v,globalEventTimer:()=>globalEventTimer,activeEvent:()=>activeEvent,activeEventTime:()=>activeEventTime,
    syncState:{
        waveSpeed:{get:()=>waveSpeed,set:v=>waveSpeed=v},
        waveSpeedTarget:{get:()=>waveSpeedTarget,set:v=>waveSpeedTarget=v},
        eventWaveTarget:{get:()=>eventWaveTarget,set:v=>eventWaveTarget=v},
        globalEventTimer:{get:()=>globalEventTimer,set:v=>globalEventTimer=v},
        activeEventTime:{get:()=>activeEventTime,set:v=>activeEventTime=v},
        activeEvent:{get:()=>activeEvent,set:v=>activeEvent=v},
        waveEventDir:{get:()=>waveEventDir,set:v=>waveEventDir=v},
        waveEventStrength:{get:()=>waveEventStrength,set:v=>waveEventStrength=v},
        waveEventActive:{get:()=>waveEventActive,set:v=>waveEventActive=v},
        waveEventDuration:{get:()=>waveEventDuration,set:v=>waveEventDuration=v},
        windActive:{get:()=>windActive,set:v=>windActive=v},
        windSpeedMul:{get:()=>windSpeedMul,set:v=>windSpeedMul=v},
        evWindDir:{get:()=>evWindDir,set:v=>evWindDir=v},
        stormActive:{get:()=>stormActive,set:v=>stormActive=v},
        rainbowActive:{get:()=>rainbowActive,set:v=>rainbowActive=v}
    },
    getShark:()=>shark,setDuoSharkTarget:v=>duoSharkTarget=v,getStormSync,applyStormSync,isFestival,
    mkCake,mkRock,mkFlower,mkZongzi,mkGrass,mkLily,mkMagnet,mkHeart,magnetFxActive,
    whirlpools,whirlZones,disposeWhirlpoolVisuals,mkWhirlpool,disposeItemVisual,
    startEvent,endEvent,drawArrowTexture,arrowTex,arrowPlane,cur,spawnShark,removeShark
});
initDuoRemoteDuck({
    scene,applyDuckSkinToRoot,mkWaveRing,waveHeight,
    getRenderedWaveClock:()=>renderedWaveClock,getGameClock:()=>gameClock,getDuckModel:()=>duckModel,
    magnetDashTex,crownGroup,auraMat,magnetPulse,glowTex,sparkTex,MAG_PARTICLES,
    getMagnetRange,magnetVisualConfig,COMBO_MAGNET_RANGE
});
initDebugPanel({
    getHearts:()=>hearts,setHearts:v=>hearts=v,getMaxHearts:()=>MAX_HEARTS,recordHealthTransition,
    getScore:()=>score,setScore:v=>score=v,gameOver,
    setPendingEvent:v=>pendingEvent=v,setWarnedFor:v=>warnedFor=v,
    getActiveEvent:()=>activeEvent,endEvent,pickEvent,startEvent,setGlobalEventTimer:v=>globalEventTimer=v,
    getBlessings:()=>Blessings,updateSettingsPanel,getDuckModel:()=>duckModel,isFestival,
    mkCake,mkRock,mkFlower,mkZongzi,mkGrass,mkLily,mkMagnet,mkHeart,mkWhirlpool,whirlpools,scene,items
});
initControls({isMobile,mv,getDuckMaxSpeed:()=>DUCK_MAX_SPEED});
let sceneShadersCompiled=false; // 首局开局后一次性预编译全部着色器，避免新材质首次渲染时同步编译造成卡顿
let fpsAccum=0,fpsFrames=0,fpsValue=60;
let lastShadowUpdateMs=0;
const framePerf={samples:0,over33:0,over50:0,maxMs:0,lastMs:0};
(function loop(){requestAnimationFrame(loop);
    const rawDt=clock.getDelta(),dt=Math.min(rawDt,.05),frameMs=rawDt*1000,frameNow=performance.now();
    framePerf.samples++;framePerf.lastMs=frameMs;framePerf.maxMs=Math.max(framePerf.maxMs,frameMs);if(frameMs>33.34)framePerf.over33++;if(frameMs>50)framePerf.over50++;
    // FPS 统计（即使暂停也统计，因为仍在渲染）
    // 必须使用未截断的真实帧间隔；旧逻辑在 5~10 FPS 时仍会错误显示成 20 FPS。
    fpsAccum+=rawDt;fpsFrames++;
    if(fpsAccum>=0.5){
        fpsValue=Math.round(fpsFrames/fpsAccum);
        fpsAccum=0;fpsFrames=0;
        const fpsEl=document.getElementById('fps-hud');
        if(fpsEl.classList.contains('show')){
            fpsEl.querySelector('.fps-val').textContent=fpsValue;
            fpsEl.className='fps-hud show'+(fpsValue<30?' bad':fpsValue<50?' warn':'');
        }
    }
    // 暂停/设置页不改变动态画质，避免轻负载界面把 DRS 和阴影误恢复，回到游戏瞬间再次卡顿。
    if(!isPaused){
        quality.drsTimer+=dt;
        if(quality.drsTimer>1.5){
            quality.drsTimer=0;
            if(fpsValue<46&&quality.drsScale>.62){quality.drsScale=Math.max(.6,quality.drsScale-.15);applyDRS({sizeStormCv:resizeEnvironment})}
            else if(fpsValue>57&&quality.drsScale<1){quality.drsScale=Math.min(1,quality.drsScale+.1);applyDRS({sizeStormCv:resizeEnvironment})}
        }
        updatePerformanceRestriction(dt);
    }
    // 上一帧的随机抖动只是渲染偏移，先精确撤销，绝不写进 OrbitControls 的轨道基准。
    clearCameraShakeOffset();
    // 暂停时不更新游戏逻辑
    if(isPaused){
        camera.updateMatrixWorld(true);
        updateComboTargetCards();
        FestivalFx.updateScreen(0); // 冻结粒子，但立即把暂停/设置层下方的特效降到低透明度。
        renderer.render(scene,camera);
        return;
    }
    // 开局友好期只累计玩家真正可操作的前台时间；祝福卡、教程和后台挂起都不偷走这 20 秒。
    if(gameActive&&!document.hidden&&!festivalFxDimmed())runActiveSeconds+=dt;
    frameCount++;
    gameClock+=dt;updateDuoClock(dt);timeOfDay=(timeOfDay+dt*TIME_SPEED/60)%24;
    if(magnetFxActive()||(duoRemoteTarget?.mt||0)>0||(duoRemoteTarget?.cm||0)>0)magnetDashTex.offset.x=(magnetDashTex.offset.x-dt*.8+1)%1;
// 波浪相位独立推进：暴风雨/海浪事件加速，平静时刻减速（平滑过渡）
waterUpdatePhase(dt,waveSpeedTarget);
// 先推进海浪事件、水流和 waveBoost；随后水面与鸭子都读取这一帧的同一状态。
if(duckModel&&gameActive)updateCur(dt);
// 先更新本帧真正显示的水面，再让鸭子、远端角色和相机采样同一个 renderedWaveClock。
// 旧顺序是鸭子/相机先读旧水面、随后水面跳到新相位，30 FPS 时会出现一帧错相和明显阶梯抖动。
if(duckModel)waterFollowTarget(duckModel.position.x,duckModel.position.z);
const waterSurfaceChanged=waterUpdateVertices(gameClock,duckModel?.position.x,duckModel?.position.z,frameNow);
// 暴风雨强度 / 闪电余晖 平滑过渡
stormFactor+=((stormActive?1:0)-stormFactor)*Math.min(1,dt*.9);
lightningFlash=Math.max(0,lightningFlash-dt*2.6);
if(duckSink.state==='none')updateDuck(dt);updateDuoRemoteDuck(dt);updateDuckSink(dt);updateCam(dt);updateGlobalEvent(dt);updateShark(dt);trySpawnHeart(dt);updateTransientFx(dt);
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
// 漩涡仅在波面真正变化时重拟合数千个顶点；吸力、寿命和贴图旋转仍逐帧推进。
updateWhirlpools(dt,waterSurfaceChanged);
// 方向箭头贴合浪面起伏（以渲染时钟采样，与水面网格严格一致）
if(arrowPlane.material.opacity>.01){const ap=arrowPlane.geometry.attributes.position;for(let i=0;i<ap.count;i++){const lx=ap.getX(i),ly=ap.getY(i);ap.setZ(i,waveHeight(lx+arrowPlane.position.x,-ly+arrowPlane.position.z,renderedWaveClock)+.14)}ap.needsUpdate=true}
// 花朵/海草/荷叶随海浪漂浮
const smoothDuoItems=duoIsGuest(),duoItemLerpK=smoothDuoItems?1-Math.exp(-dt*9):0,localMagnetPull=smoothDuoItems&&magnetFxActive();
for(const it of items){if(it.coll||it.duoHidden)continue;
if(smoothDuoItems&&!(localMagnetPull&&(it.magT||0)>.01)&&Number.isFinite(it.duoTargetX)&&Number.isFinite(it.duoTargetZ)){
    const dx=it.duoTargetX-it.mesh.position.x,dz=it.duoTargetZ-it.mesh.position.z,err2=dx*dx+dz*dz;
    if(err2>16){it.mesh.position.x=it.duoTargetX;it.mesh.position.z=it.duoTargetZ}
    else{it.mesh.position.x+=dx*duoItemLerpK;it.mesh.position.z+=dz*duoItemLerpK}
}
const ix=it.mesh.position.x,iz=it.mesh.position.z;const floatY=waveHeight(ix,iz,renderedWaveClock);
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
if(it.type==='lily'){it.mesh.position.y=floatY+.04+mLift;it.mesh.rotation.z=Math.sin(gameClock*1.2+ix)*.06;it.mesh.rotation.x=Math.cos(gameClock*1.0+iz)*.06;it.mesh.rotation.y+=itSpin}else if(it.type==='flower'){it.mesh.position.y=floatY-.02+mLift;it.mesh.rotation.z=Math.sin(gameClock*1.5+ix*2)*.08;it.mesh.rotation.x=Math.cos(gameClock*1.3+iz*2)*.05;it.mesh.rotation.y+=itSpin}else if(it.type==='grass'){it.mesh.position.y=floatY-.06+(it.mesh.userData.floatLift||0)+mLift;it.mesh.rotation.z=Math.sin(gameClock*2+ix*3)*.1;it.mesh.rotation.x=Math.cos(gameClock*1.8+iz*3)*.06;it.mesh.rotation.y+=itSpin}else if(it.type==='rock'){it.mesh.position.y=floatY-.12}else if(it.type==='heart'){it.mesh.position.y=floatY+.4+mLift+Math.sin(gameClock*2+ix)*.12;it.mesh.rotation.y=gameClock*1.6}else if(it.type==='magnet'){const phase=it.mesh.userData.idlePhase||0;it.mesh.position.y=floatY+.65+mLift+Math.sin(gameClock*1.8+phase)*.06;it.mesh.rotation.y=gameClock*1.15+phase+it.magT*2;it.mesh.rotation.x=Math.cos(gameClock*1.35+phase)*.045;it.mesh.rotation.z=Math.sin(gameClock*1.55+phase)*.07}}
// 连胜边框柔和呼吸
if(streakActive){const s=.5+Math.sin(gameClock*2)*.5;document.getElementById('combo-border').style.opacity=s}
// OrbitControls 的 dampingFactor 是“每次 update”的比例；换算到真实 dt 后，30/60/120 FPS 衰减手感一致。
controls.dampingFactor=1-Math.pow(1-.06,Math.min(dt,.05)*60);
controls.update();
updateComboTargetHints(dt);
// 3D 节日物件在水面与最终相机轨道更新后采样：旗座贴浪，镜头外回收也不会被阻尼转动带入本帧视野。
FestivalFx.updateWorld(dt);
// 雷击/受伤只作为本帧最终渲染偏移；渲染完成立即撤销，不给两帧间的鼠标事件读到抖动坐标。
applyCameraShake(dt);
camera.updateMatrixWorld(true);
updateComboTargetCards();
// 屏幕粒子覆盖完整画面，不再读取或擦除鸭子、名牌和 HUD 区域。
FestivalFx.updateScreen(dt);
// 吸入结束后滤镜继续旋转着褪去（sinkFx 衰减到 0）
if(duckSink.state==='none'&&sinkFx>0)sinkFx=Math.max(0,sinkFx-dt*.9);
// 阴影按真实时间而不是显示器帧数更新；120/165Hz 屏不再比60Hz多提交两三倍 shadow pass。
if(renderer.shadowMap.enabled&&quality.shadowUpdateHz>0&&frameNow-lastShadowUpdateMs>=1000/quality.shadowUpdateHz){renderer.shadowMap.needsUpdate=true;lastShadowUpdateMs=frameNow}
// 漩涡吸入时走后处理滤镜（涡旋+模糊+暗角），平时直渲
try{
    if(sinkFx>0.004)swirlPostfx.render(sinkFx);
    else renderer.render(scene,camera);
}finally{clearCameraShakeOffset()}
})();
addEventListener('resize',()=>resizeRuntime(innerWidth,innerHeight,swirlPostfx));
// 统一画布自行处理内部清晰度与分层网格粒子重排。
addEventListener('resize',()=>FestivalFx.resize());
