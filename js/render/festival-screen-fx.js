// 16 套节日屏幕氛围：单 Canvas、本地确定性粒子、分档预算与减动效。
// 本模块不依赖 THREE，也不创建 RAF；生命周期和帧循环由游戏主循环统一驱动。

const TAU=Math.PI*2;
const QUALITY_PRESETS=Object.freeze({
    low:{hz:30,resolution:.75},
    mid:{hz:45,resolution:1},
    high:{hz:60,resolution:1}
});

function theme(id,themeName,label,palette,quality,introDuration,mode){
    return Object.freeze({id,theme:themeName,label,palette:Object.freeze(palette),quality:Object.freeze(quality),introDuration,mode});
}

export const FESTIVAL_SCREEN_FX_THEMES=Object.freeze({
    festival_new_year:theme('festival_new_year','ice-crystal-dawn','元旦 · 冰晶晨光',['#f7fbff','#9fd8ff','#78bde8'],{low:24,mid:56,high:96},2.2,'snow'),
    festival_eve:theme('festival_eve','new-years-eve-embers','除夕 · 守岁火光',['#ffcf70','#e94335','#8f241e'],{low:24,mid:48,high:72},4,'eve'),
    festival_spring:theme('festival_spring','golden-spring-sky','春节 · 金红天幕',['#ffe29a','#e52b24','#ff8d3a'],{low:48,mid:84,high:132},8.5,'spring'),
    festival_lantern:theme('festival_lantern','lantern-river','元宵 · 灯河祈福',['#ffe0a3','#ff8c52','#b92832'],{low:8,mid:16,high:28},2.8,'lantern'),
    festival_dragon_heads:theme('festival_dragon_heads','jade-dragon-awakens','龙抬头 · 青龙醒水',['#d7f7df','#42c7b8','#d8b45c'],{low:8,mid:16,high:28},2.2,'dragon'),
    festival_qingming:theme('festival_qingming','misty-willow-rain','清明 · 烟雨柳色',['#b8d2d9','#759e9c','#76a66b'],{low:18,mid:36,high:60},2.4,'qingming'),
    festival_labor:theme('festival_labor','morning-worklight','劳动节 · 勤劳晨光',['#ffe5a1','#e0a83b','#8dc9cf'],{low:10,mid:20,high:34},2.6,'labor'),
    festival_dragon_boat:theme('festival_dragon_boat','dragon-boat-current','端午 · 竞渡粽香',['#cde8bd','#4c9a61','#e4c85a','#d86b59'],{low:12,mid:24,high:40},2.5,'dragonBoat'),
    festival_qixi:theme('festival_qixi','magpie-bridge-stars','七夕 · 鹊桥银河',['#ffd0e5','#c9b4ff','#8ed9ff'],{low:12,mid:26,high:44},3,'qixi'),
    festival_zhongyuan:theme('festival_zhongyuan','lotus-lamp-river','中元 · 河灯寄思',['#ffd29b','#7a75ba','#263d78'],{low:8,mid:16,high:28},2.8,'zhongyuan'),
    festival_mid_autumn:theme('festival_mid_autumn','moonlight-osmanthus','中秋 · 月华桂影',['#fff1c7','#e7b64b','#aab9da'],{low:10,mid:22,high:38},2.5,'midAutumn'),
    festival_double_ninth:theme('festival_double_ninth','chrysanthemum-highlands','重阳 · 登高赏菊',['#ffd176','#a34b3e','#8b765f'],{low:10,mid:20,high:34},2.4,'doubleNinth'),
    festival_national_day:theme('festival_national_day','mountains-ribbon-stars','国庆 · 山河红绸',['#ffdc72','#d92826','#fff1cf'],{low:20,mid:40,high:64},2.5,'national'),
    festival_winter_solstice:theme('festival_winter_solstice','warm-steam-frost','冬至 · 寒水暖气',['#e9f7ff','#a9d8ee','#ffe7bd'],{low:6,mid:12,high:20},2.2,'winter'),
    festival_laba:theme('festival_laba','eight-treasure-warmth','腊八 · 八宝暖粥',['#f2dec2','#a44f45','#d5aa70','#f0c985'],{low:8,mid:16,high:32},2.8,'laba'),
    festival_xiaonian:theme('festival_xiaonian','hearth-sweeping-light','小年 · 扫尘送灶',['#ffd071','#e84b32','#ff934d'],{low:12,mid:24,high:40},2,'xiaonian')
});

export const FESTIVAL_SCREEN_FX_IDS=Object.freeze(Object.keys(FESTIVAL_SCREEN_FX_THEMES));

function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function lerp(a,b,t){return a+(b-a)*t}
function smoothstep(a,b,v){const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t)}
function normalizeQuality(value){return value==='high'?'high':value==='low'||value==='restricted'?'low':'mid'}
function hashText(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function seeded(seed){let x=seed>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296}
function rectValue(rect,key,fallback){const value=Number(rect?.[key]);return Number.isFinite(value)?value:fallback}

function roundedRect(ctx,x,y,w,h,r){
    const rr=Math.min(r,w*.5,h*.5);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
}
function drawStar(ctx,r,inner=.44,points=5){
    ctx.beginPath();for(let i=0;i<points*2;i++){const a=-Math.PI/2+i*Math.PI/points,rr=i%2?r:r*inner;const x=Math.cos(a)*rr,y=Math.sin(a)*rr;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.closePath();
}
function drawHeart(ctx,s){
    ctx.beginPath();ctx.moveTo(0,s*.65);ctx.bezierCurveTo(-s*1.15,-s*.05,-s*.58,-s,0,-s*.34);ctx.bezierCurveTo(s*.58,-s,s*1.15,-s*.05,0,s*.65);ctx.closePath();
}
function drawLeaf(ctx,s,round=.35){
    ctx.beginPath();ctx.moveTo(-s,0);ctx.quadraticCurveTo(-s*.15,-s*(.35+round),s,0);ctx.quadraticCurveTo(-s*.15,s*(.35+round),-s,0);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(-s*.82,0);ctx.lineTo(s*.74,0);ctx.stroke();
}
function drawSnowflake(ctx,r){
    ctx.beginPath();for(let i=0;i<3;i++){const a=i*Math.PI/3,dx=Math.cos(a)*r,dy=Math.sin(a)*r;ctx.moveTo(-dx,-dy);ctx.lineTo(dx,dy)}ctx.stroke();
}
function drawGear(ctx,r,teeth=10){
    ctx.beginPath();for(let i=0;i<teeth*2;i++){const a=i*Math.PI/teeth,rr=i%2?r:r*.78;const x=Math.cos(a)*rr,y=Math.sin(a)*rr;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.closePath();ctx.stroke();ctx.beginPath();ctx.arc(0,0,r*.33,0,TAU);ctx.stroke();
}
function drawLantern(ctx,s){
    ctx.beginPath();ctx.moveTo(-s*.55,-s*.62);ctx.quadraticCurveTo(-s*.9,0,-s*.55,s*.62);ctx.lineTo(s*.55,s*.62);ctx.quadraticCurveTo(s*.9,0,s*.55,-s*.62);ctx.closePath();ctx.fill();ctx.strokeRect(-s*.45,-s*.78,s*.9,s*.15);ctx.beginPath();ctx.moveTo(0,s*.62);ctx.lineTo(0,s);ctx.stroke();
}
function drawLotus(ctx,s){
    ctx.beginPath();ctx.moveTo(-s,0);ctx.quadraticCurveTo(-s*.55,-s*.55,0,0);ctx.quadraticCurveTo(-s*.25,-s*.9,0,-s*.24);ctx.quadraticCurveTo(s*.25,-s*.9,0,0);ctx.quadraticCurveTo(s*.55,-s*.55,s,0);ctx.quadraticCurveTo(0,s*.45,-s,0);ctx.closePath();ctx.fill();
}
function drawDuckOutline(ctx,x,y,s,alpha){
    ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.globalAlpha*=alpha;ctx.strokeStyle='#ffe59a';ctx.lineWidth=2.2/s;ctx.beginPath();ctx.ellipse(0,0,1.2,.78,0,0,TAU);ctx.moveTo(.42,-.6);ctx.arc(.43,-.72,.48,.2,TAU-.28);ctx.moveTo(.82,-.78);ctx.quadraticCurveTo(1.34,-.7,1.5,-.48);ctx.quadraticCurveTo(1.17,-.34,.8,-.42);ctx.moveTo(-1.06,.12);ctx.quadraticCurveTo(-1.48,-.05,-1.38,-.38);ctx.stroke();ctx.restore();
}

class FestivalScreenFx{
    constructor(options={}){
        this.options=options;
        this.document=options.document||globalThis.document||null;
        this.window=options.window||globalThis.window||globalThis;
        this.canvas=null;this.ctx=null;this.activeId=null;this.theme=null;
        this.width=0;this.height=0;this.dpr=1;this.resolution=1;
        this.quality=normalizeQuality(typeof options.quality==='function'?options.quality():options.quality);
        this.reducedMotion=!!(typeof options.reducedMotion==='function'?options.reducedMotion():options.reducedMotion);
        this.motionScale=this.reducedMotion?.2:1;this.flashEnabled=!this.reducedMotion;
        this.pool=[];this.activeCount=0;this.age=0;this.introAge=-1;this.introPending=false;
        this.accumulator=0;this.drawCount=0;this.startCount=0;this.stopCount=0;this.resizeCount=0;
        this.seed=1;this.staticAvoidRects=[];this.avoidRects=[];this.avoidRefresh=0;this.lastAvoidCount=0;this.paint={};
        this._lastQuality=this.quality;this._lastReduced=this.reducedMotion;
    }
    start(id,options={}){
        const next=FESTIVAL_SCREEN_FX_THEMES[id];
        if(!next){this.stop();return false}
        const deferIntro=!!options.deferIntro;
        if(this.activeId===id&&this.canvas){
            if(!deferIntro)this.playIntro();
            return true;
        }
        // 调试切换主题复用同一张 Canvas；真正 stop 时才移除，避免反复分配整屏 surface。
        const reuseSurface=!!this.canvas&&!!this.ctx;
        this.activeId=id;this.theme=next;this.seed=hashText(id);this.age=0;this.accumulator=0;
        this.introPending=deferIntro;this.introAge=deferIntro?-1:0;this.drawCount=0;
        if(!reuseSurface)this._createCanvas();
        if(!this.canvas||!this.ctx){this.activeId=null;this.theme=null;return false}
        if(this.canvas.dataset)this.canvas.dataset.festival=id;
        this.startCount++;this._syncPreferences(true);this.resize();this._resetAll(true);this._draw();return true;
    }
    playIntro(){
        if(!this.activeId||this.reducedMotion)return false;
        this.introPending=false;this.introAge=0;this._resetAll(true);return true;
    }
    stop(){
        const wasRunning=!!this.canvas;
        if(this.canvas?.remove)this.canvas.remove();
        else if(this.canvas?.parentNode?.removeChild)this.canvas.parentNode.removeChild(this.canvas);
        this.canvas=null;this.ctx=null;this.activeId=null;this.theme=null;this.activeCount=0;this.age=0;this.introAge=-1;this.introPending=false;this.accumulator=0;this.staticAvoidRects=[];this.avoidRects=[];
        if(wasRunning)this.stopCount++;
    }
    setQuality(level){
        const next=normalizeQuality(level);if(next===this.quality)return;
        this.quality=next;this._lastQuality=next;if(this.canvas){this.resize();this._setBudget();this._advance(0);this._draw()}
    }
    setReducedMotion(value){
        const next=!!value;if(next===this.reducedMotion)return;
        this.reducedMotion=next;this._lastReduced=next;this.motionScale=next?.2:1;this.flashEnabled=!next;
        if(next){this.introPending=false;this.introAge=-1}
        if(this.canvas){this._setBudget();this._resetAll(true);this._draw()}
    }
    resize(width,height,dpr){
        if(!this.canvas||!this.ctx)return false;
        const win=this.window||{};
        const nextW=Math.max(1,Math.round(Number(width)||Number(win.innerWidth)||1));
        const nextH=Math.max(1,Math.round(Number(height)||Number(win.innerHeight)||1));
        this.dpr=Math.max(1,Number(dpr)||Number(win.devicePixelRatio)||1);
        this.resolution=QUALITY_PRESETS[this.quality].resolution;
        const oldW=this.width||nextW,oldH=this.height||nextH;
        this.width=nextW;this.height=nextH;
        this.canvas.width=Math.max(1,Math.round(nextW*this.resolution));
        this.canvas.height=Math.max(1,Math.round(nextH*this.resolution));
        if(this.canvas.style){this.canvas.style.width=nextW+'px';this.canvas.style.height=nextH+'px'}
        this.ctx.setTransform(this.resolution,0,0,this.resolution,0,0);
        this.resizeCount++;this._buildPaints();
        if(this.activeCount){const sx=nextW/oldW,sy=nextH/oldH;for(let i=0;i<this.activeCount;i++){this.pool[i].x*=sx;this.pool[i].y*=sy}}
        this._refreshAvoidRects(true);return true;
    }
    update(dt){
        if(!this.canvas||!this.ctx||!this.theme)return;
        this._syncPreferences(false);
        const frameDt=clamp(Number(dt)||0,0,.1);
        const dimmed=this._safeCall('isDimmed',false),paused=this._safeCall('isPaused',false)||this._safeCall('isHidden',false);
        if(this.canvas.style)this.canvas.style.opacity=dimmed?'0.18':'1';
        this._refreshAvoidRects(false,frameDt);
        if(paused)return;
        const updateHz=this.reducedMotion?5:QUALITY_PRESETS[this.quality].hz,step=1/updateHz;
        this.accumulator+=frameDt;const steps=Math.floor((this.accumulator+1e-9)/step);if(steps<1)return;
        this.accumulator-=steps*step;const elapsed=Math.min(.1,steps*step);this.age+=elapsed;
        if(this.introAge>=0)this.introAge+=elapsed;
        if(!this.reducedMotion)this._advance(elapsed*this.motionScale);
        this._draw();
    }
    getDebugState(){
        return{
            running:!!this.canvas,activeId:this.activeId,theme:this.theme?.theme||null,themeId:this.theme?.theme||null,label:this.theme?.label||null,
            width:this.width,height:this.height,dpr:this.dpr,resolution:this.resolution,quality:this.quality,reducedMotion:this.reducedMotion,
            motionScale:this.motionScale,flashEnabled:this.flashEnabled,particleCount:this.activeCount,poolSize:this.pool.length,
            particleBudget:this.theme?this.theme.quality[this.quality]:0,surfaceCount:this.canvas?1:0,updateHz:this.reducedMotion?5:QUALITY_PRESETS[this.quality].hz,
            introPending:this.introPending,introActive:this.introAge>=0&&this.introAge<(this.theme?.introDuration||0),introAge:this.introAge,
            avoidRectCount:this.lastAvoidCount,drawCount:this.drawCount,startCount:this.startCount,stopCount:this.stopCount,resizeCount:this.resizeCount
        };
    }
    _createCanvas(){
        if(!this.document?.createElement)return;
        const canvas=this.document.createElement('canvas');canvas.className='festival-fx-cv';
        if(canvas.dataset)canvas.dataset.festival=this.activeId;
        const ctx=canvas.getContext?.('2d',{alpha:true});if(!ctx)return;
        this.canvas=canvas;this.ctx=ctx;this.document.body?.appendChild?.(canvas);
    }
    _safeCall(name,fallback){try{const fn=this.options[name];return typeof fn==='function'?fn():fallback}catch(e){return fallback}}
    _syncPreferences(force){
        const qualitySource=typeof this.options.getQuality==='function'?this.options.getQuality():typeof this.options.quality==='function'?this.options.quality():this.quality;
        const reducedSource=typeof this.options.getReducedMotion==='function'?this.options.getReducedMotion():typeof this.options.reducedMotion==='function'?this.options.reducedMotion():this.reducedMotion;
        const nextQuality=normalizeQuality(qualitySource),nextReduced=!!reducedSource;
        if(force||nextQuality!==this._lastQuality){this.quality=nextQuality;this._lastQuality=nextQuality;if(!force&&this.canvas)this.resize()}
        if(force||nextReduced!==this._lastReduced){this.reducedMotion=nextReduced;this._lastReduced=nextReduced;this.motionScale=nextReduced?.2:1;this.flashEnabled=!nextReduced;if(nextReduced){this.introPending=false;this.introAge=-1}}
        if(this.theme)this._setBudget();
    }
    _setBudget(){
        if(!this.theme)return;
        const full=this.theme.quality[this.quality],next=this.reducedMotion?Math.max(2,Math.floor(full*.3)):full;
        while(this.pool.length<next)this.pool.push({cycle:0});
        const old=this.activeCount;this.activeCount=next;
        for(let i=old;i<next;i++)this._resetParticle(this.pool[i],i,true);
    }
    _resetAll(initial){this._setBudget();for(let i=0;i<this.activeCount;i++){this.pool[i].cycle=0;this._resetParticle(this.pool[i],i,initial)}this._advance(0)}
    _rand(index,salt,cycle=0){
        const base=(this.seed+Math.imul(index+1,0x9e3779b1)+Math.imul(salt+1,0x85ebca6b)+Math.imul(cycle+1,0xc2b2ae35))>>>0;
        const injected=this.options.random;if(typeof injected==='function'){const value=Number(injected(base,index,salt,cycle));if(Number.isFinite(value))return value-Math.floor(value)}
        return seeded(base);
    }
    _resetParticle(p,index,initial=false){
        const W=this.width||1,H=this.height||1,r=(salt)=>this._rand(index,salt,p.cycle||0),mode=this.theme?.mode;
        p.index=index;p.variant=0;p.alpha=.55+r(1)*.4;p.size=2+r(2)*5;p.phase=r(3)*TAU;p.rot=r(4)*TAU;p.vr=(r(5)-.5)*1.8;p.life=4+r(6)*7;p.t=initial?r(7)*p.life:0;p.side=r(8)<.5?-1:1;p.color=index%this.theme.palette.length;
        switch(mode){
            case 'snow':p.variant=index%5===0?1:0;p.x=r(9)*W;p.y=initial?r(10)*H:-20;p.vx=(r(11)-.5)*14;p.vy=18+r(12)*36;p.size=p.variant?4+r(13)*4:1.2+r(13)*2.6;break;
            case 'eve':p.variant=index%3===0?1:0;p.x=r(9)*W;p.y=p.variant?(initial?r(10)*H:H+15):(initial?r(10)*H:H*.15+r(10)*H*.65);p.vx=(r(11)-.5)*(p.variant?18:35);p.vy=p.variant?-(24+r(12)*55):22+r(12)*42;p.size=p.variant?1.4+r(13)*2.5:3+r(13)*5;break;
            case 'spring':{p.variant=index%5===0?1:0;const burst=index%3,ox=W*(.2+burst*.3),oy=H*(.18+(burst%2)*.11),a=r(9)*TAU,sp=35+r(10)*145;p.x=ox;p.y=oy;p.vx=Math.cos(a)*sp;p.vy=Math.sin(a)*sp;p.life=1.8+r(11)*2.4;p.t=initial?r(12)*p.life:0;p.size=p.variant?3+r(13)*5:1.4+r(13)*2.5;break}
            case 'lantern':p.x=p.side<0?W*(.05+r(9)*.25):W*(.7+r(9)*.25);p.y=initial?H*(.36+r(10)*.55):H+25;p.vx=(r(11)-.5)*8;p.vy=-(12+r(12)*12);p.size=6+r(13)*7;break;
            case 'dragon':p.u=initial?r(9):0;p.x=0;p.y=0;p.vy=.1+r(10)*.08;p.size=3+r(11)*4;p.variant=index%5===0?1:0;break;
            case 'qingming':p.variant=index%4===0?1:0;p.x=r(9)*W;p.y=initial?r(10)*H:-20;p.vx=p.variant?-(5+r(11)*14):-(12+r(11)*24);p.vy=p.variant?18+r(12)*22:85+r(12)*65;p.size=p.variant?6+r(13)*6:1;break;
            case 'labor':p.variant=index%9===0?1:0;p.x=p.variant?(p.side<0?W*.08:W*.92):r(9)*W;p.y=p.variant?H*(.25+r(10)*.45):H*(.3+r(10)*.65);p.vx=(r(11)-.5)*5;p.vy=p.variant?0:-(5+r(12)*12);p.size=p.variant?15+r(13)*9:1.5+r(13)*2.5;break;
            case 'dragonBoat':p.variant=index%3;p.x=p.side<0?(initial?r(9)*W:W+25):(initial?r(9)*W:-25);p.y=H*(.55+r(10)*.38);p.vx=p.side*(26+r(11)*42);p.vy=(r(12)-.5)*6;p.size=4+r(13)*8;break;
            case 'qixi':p.variant=index%7===0?2:index%4===0?1:0;p.u=initial?r(9):0;p.side=index%2?-1:1;p.x=0;p.y=0;p.vy=.055+r(10)*.045;p.size=2+r(11)*5;break;
            case 'zhongyuan':p.variant=index%4===0?1:0;p.x=initial?r(9)*W:(p.side<0?W+25:-25);p.y=H*(.68+r(10)*.2);p.vx=p.side*(8+r(11)*14);p.vy=(r(12)-.5)*2;p.size=5+r(13)*7;break;
            case 'midAutumn':p.variant=index%6===0?1:0;p.x=r(9)*W;p.y=initial?r(10)*H:-15;p.vx=-(5+r(11)*15);p.vy=p.variant?3+r(12)*7:10+r(12)*15;p.size=p.variant?16+r(13)*14:3+r(13)*5;break;
            case 'doubleNinth':p.variant=index%5===0?1:0;p.x=p.side<0?W*(.04+r(9)*.25):W*(.71+r(9)*.25);p.y=initial?H*(.45+r(10)*.55):H+18;p.vx=p.side*(2+r(11)*8);p.vy=-(10+r(12)*18);p.size=p.variant?3+r(13)*4:4+r(13)*6;break;
            case 'national':p.variant=index%5===0?1:0;p.x=p.side<0?W*(.02+r(9)*.28):W*(.7+r(9)*.28);p.y=initial?r(10)*H:(p.variant?H+12:-12);p.vx=(r(11)-.5)*16;p.vy=p.variant?-(8+r(12)*18):18+r(12)*32;p.size=p.variant?3+r(13)*5:2+r(13)*4;break;
            case 'winter':p.variant=index%5===0?1:0;p.x=p.side<0?W*(.04+r(9)*.18):W*(.78+r(9)*.18);p.y=initial?H*(.65+r(10)*.35):H+18;p.vx=(r(11)-.5)*5;p.vy=-(8+r(12)*12);p.size=p.variant?4+r(13)*5:10+r(13)*15;break;
            case 'laba':p.group=Math.floor(index/8);p.variant=index%8;p.phase=index/8*TAU+r(9)*.18;p.x=0;p.y=0;p.size=3+r(10)*4;break;
            case 'xiaonian':p.variant=index%4===0?1:index%5===0?2:0;p.x=p.side<0?W*(.02+r(9)*.28):W*(.7+r(9)*.28);p.y=initial?H*(.55+r(10)*.5):H+15;p.vx=(r(11)-.5)*18;p.vy=-(20+r(12)*34);p.size=p.variant?3+r(13)*5:1.3+r(13)*2.5;break;
        }
        p.homeX=p.x;p.homeY=p.y;
    }
    _advance(dt){
        const W=this.width,H=this.height,mode=this.theme.mode;
        for(let i=0;i<this.activeCount;i++){
            const p=this.pool[i];p.t+=dt;p.rot+=p.vr*dt;
            switch(mode){
                case 'snow':p.x+=p.vx*dt+Math.sin(this.age*.7+p.phase)*6*dt;p.y+=p.vy*dt;if(p.y>H+18){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'eve':p.x+=p.vx*dt+Math.sin(this.age+p.phase)*4*dt;p.y+=p.vy*dt;if(p.variant)p.vy-=2*dt;if(p.y>H+20||p.y<-25){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'spring':p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=42*dt;p.vx*=Math.max(0,1-dt*.35);if(p.t>p.life){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'lantern':p.x+=p.vx*dt+Math.sin(this.age*.8+p.phase)*5*dt;p.y+=p.vy*dt;if(p.y<-30){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'dragon':p.u+=p.vy*dt;if(p.u>1){p.cycle++;this._resetParticle(p,i,false)}p.x=W*(p.side<0?.18:.82)+p.side*Math.sin(p.u*Math.PI*2.2+p.phase*.18)*W*.1;p.y=H*(.82-p.u*.7);break;
                case 'qingming':p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.y>H+25){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'labor':if(!p.variant){p.x+=p.vx*dt+Math.sin(this.age+p.phase)*2*dt;p.y+=p.vy*dt;if(p.y<H*.2){p.cycle++;this._resetParticle(p,i,false)}}break;
                case 'dragonBoat':p.x+=p.vx*dt;p.y+=p.vy*dt+Math.sin(this.age*2+p.phase)*3*dt;if(p.x<-35||p.x>W+35){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'qixi':p.u+=p.vy*dt;if(p.u>1){p.cycle++;this._resetParticle(p,i,false)}{const u=p.u,fromX=p.side<0?W*.08:W*.92,toX=W*.5;p.x=lerp(fromX,toX,Math.min(1,u*1.45))+Math.sin(p.phase+u*8)*9;p.y=H*(.2+.13*Math.sin(u*Math.PI))+Math.sin(p.phase+u*5)*12;if(u>.7){p.y+=((u-.7)/.3)*H*.55;p.x+=p.side*((u-.7)/.3)*W*.2}}break;
                case 'zhongyuan':p.x+=p.vx*dt;p.y+=Math.sin(this.age*.8+p.phase)*1.2*dt;if(p.x<-35||p.x>W+35){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'midAutumn':p.x+=p.vx*dt;p.y+=p.vy*dt+Math.sin(this.age+p.phase)*3*dt;if(p.y>H+25||p.x<-30){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'doubleNinth':p.x+=p.vx*dt+Math.sin(this.age+p.phase)*4*dt;p.y+=p.vy*dt;if(p.y<-22){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'national':p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.y>H+20||p.y<-20){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'winter':p.x+=p.vx*dt+Math.sin(this.age*.55+p.phase)*5*dt;p.y+=p.vy*dt;if(p.y<H*.28){p.cycle++;this._resetParticle(p,i,false)}break;
                case 'laba':{const side=p.group%2?-1:1,cx=side<0?W*.13:W*.87,cy=H*.84,radX=28+p.group*5,radY=10+p.group*2,a=p.phase+this.age*(.08+p.group*.012);p.x=cx+Math.cos(a)*radX;p.y=cy+Math.sin(a)*radY}break;
                case 'xiaonian':p.x+=p.vx*dt+Math.sin(this.age+p.phase)*3*dt;p.y+=p.vy*dt;if(p.y<-22){p.cycle++;this._resetParticle(p,i,false)}break;
            }
        }
    }
    _normalizeAvoidRects(source){
        const result=[];for(const rect of source||[]){const left=rectValue(rect,'left',rectValue(rect,'x',0)),top=rectValue(rect,'top',rectValue(rect,'y',0));const width=rectValue(rect,'width',Math.max(0,rectValue(rect,'right',left)-left)),height=rectValue(rect,'height',Math.max(0,rectValue(rect,'bottom',top)-top));if(width<=0||height<=0)continue;const kind=typeof rect?.kind==='string'?rect.kind:'ui',strength=clamp(rectValue(rect,'strength',kind==='label'?1:.86),0,1),feather=clamp(rectValue(rect,'feather',kind==='label'?18:14),0,40);result.push({left,top,right:left+width,bottom:top+height,kind,strength,feather})}return result;
    }
    _refreshAvoidRects(force,elapsed=0){
        this.avoidRefresh-=Math.max(0,elapsed);
        if(force||this.avoidRefresh<=0){this.avoidRefresh=.2;let source=[];try{source=this.options.getAvoidRects?.()||[]}catch(e){source=[]}this.staticAvoidRects=this._normalizeAvoidRects(source)}
        let dynamic=[];try{dynamic=this.options.getDynamicAvoidRects?.()||[]}catch(e){dynamic=[]}
        this.avoidRects=this.staticAvoidRects.concat(this._normalizeAvoidRects(dynamic));this.lastAvoidCount=this.avoidRects.length;
    }
    _softAlpha(x,y,r=0){
        let a=1;const W=this.width,H=this.height;
        if(x>W*.33&&x<W*.67&&y>H*.3&&y<H*.62)a*=.28;
        for(const box of this.avoidRects){const pad=12+r;if(x>=box.left-pad&&x<=box.right+pad&&y>=box.top-pad&&y<=box.bottom+pad){a*=.12;break}}
        return a;
    }
    _buildPaints(){
        const c=this.ctx,W=this.width,H=this.height;if(!c?.createRadialGradient)return;
        const corner=c.createRadialGradient(0,0,0,0,0,Math.max(W,H)*.55);corner.addColorStop(0,'rgba(210,242,255,.18)');corner.addColorStop(1,'rgba(210,242,255,0)');
        const warm=c.createRadialGradient(W*.5,H,0,W*.5,H,Math.max(W,H)*.62);warm.addColorStop(0,'rgba(255,190,92,.13)');warm.addColorStop(1,'rgba(255,190,92,0)');
        const mist=c.createLinearGradient(0,H,0,H*.48);mist.addColorStop(0,'rgba(95,124,150,.13)');mist.addColorStop(1,'rgba(95,124,150,0)');
        this.paint={corner,warm,mist};
    }
    _draw(){
        const c=this.ctx,W=this.width,H=this.height;if(!c)return;
        c.setTransform(this.resolution,0,0,this.resolution,0,0);c.clearRect(0,0,W,H);c.save();
        const staticTime=this.reducedMotion?0:this.age,intro=this.introAge>=0?this.introAge:-1;
        this._drawBackdrop(c,W,H,staticTime,intro);
        for(let i=0;i<this.activeCount;i++)this._drawParticle(c,this.pool[i]);
        this._applyAvoidMask(c);
        c.restore();c.globalAlpha=1;c.globalCompositeOperation='source-over';this.drawCount++;
    }
    _applyAvoidMask(c){
        if(!this.avoidRects.length)return;
        c.save();c.globalCompositeOperation='destination-out';c.fillStyle='#000';
        for(const box of this.avoidRects){const width=box.right-box.left,height=box.bottom-box.top,feather=box.feather||0,layers=feather>0?[[feather,box.strength*.18],[feather*.5,box.strength*.35],[0,box.strength]]:[[0,box.strength]];for(const [pad,alpha] of layers){c.globalAlpha=clamp(alpha,0,1);roundedRect(c,box.left-pad,box.top-pad,width+pad*2,height+pad*2,Math.min(20+pad,width*.25,height*.25));c.fill()}}
        c.restore();
    }
    _drawBackdrop(c,W,H,t,intro){
        const mode=this.theme.mode,introP=intro<0?0:1-smoothstep(0,this.theme.introDuration,intro);
        c.save();c.globalCompositeOperation='source-over';
        switch(mode){
            case 'snow':
            case 'winter':c.fillStyle=this.paint.corner||'rgba(210,242,255,.08)';c.fillRect(0,0,W,H);c.save();c.translate(W,H);c.scale(-1,-1);c.fillStyle=this.paint.corner||'rgba(210,242,255,.08)';c.fillRect(0,0,W,H);c.restore();c.strokeStyle='rgba(225,248,255,.16)';c.lineWidth=1;for(const ox of[18,W-18])for(let i=0;i<4;i++){c.beginPath();c.moveTo(ox,H*.08+i*28);c.lineTo(ox+(ox<W/2?1:-1)*(28+i*5),H*.03+i*20);c.stroke()}break;
            case 'eve':c.strokeStyle=`rgba(244,66,48,${.07+introP*.16})`;c.lineWidth=2;for(const x of[18,W-18]){c.beginPath();c.moveTo(x,H*.18);c.lineTo(x,H*.82);c.stroke();if(introP){c.fillStyle='rgba(255,193,82,.65)';for(let i=0;i<7;i++){const y=H*(.2+i*.09),pulse=Math.max(0,1-Math.abs(intro-i*.22)*2.2);c.globalAlpha=pulse*introP;c.beginPath();c.arc(x,y,2+pulse*3,0,TAU);c.fill()}c.globalAlpha=1}}break;
            case 'spring':c.strokeStyle=`rgba(224,52,43,${.08+introP*.1})`;c.lineWidth=2;c.strokeRect(12,12,W-24,H-24);if(intro>=0&&intro<this.theme.introDuration){c.globalCompositeOperation='lighter';for(let j=0;j<3;j++){const cycle=(intro-j*1.3)%4;if(cycle<0)continue;const fade=1-smoothstep(.2,2.2,cycle),x=W*(.2+j*.3),y=H*(.18+(j%2)*.11),rad=20+cycle*42;c.strokeStyle=`rgba(255,208,102,${fade*.45})`;c.lineWidth=1.4;for(let k=0;k<18;k++){const a=k/18*TAU;c.beginPath();c.moveTo(x+Math.cos(a)*rad*.55,y+Math.sin(a)*rad*.55);c.lineTo(x+Math.cos(a)*rad,y+Math.sin(a)*rad);c.stroke()}}const duckFade=Math.max(0,1-Math.abs(intro-3.6)/1.4);drawDuckOutline(c,W*.5,H*.28,18,duckFade*.75)}break;
            case 'lantern':c.fillStyle=this.paint.warm||'rgba(255,190,92,.08)';c.fillRect(0,H*.47,W,H*.53);c.strokeStyle='rgba(255,181,90,.12)';for(let i=0;i<5;i++){const y=H*(.72+i*.035);c.beginPath();c.moveTo(W*.06,y);c.quadraticCurveTo(W*.26,y+Math.sin(t+i)*4,W*.42,y);c.moveTo(W*.58,y);c.quadraticCurveTo(W*.76,y-Math.sin(t+i)*4,W*.94,y);c.stroke()}break;
            case 'dragon':c.globalCompositeOperation='lighter';c.strokeStyle=`rgba(80,213,192,${.08+introP*.28})`;c.lineWidth=2.2;for(const side of[-1,1]){c.beginPath();for(let i=0;i<=28;i++){const u=i/28,edgeX=W*(side<0?.18:.82),x=edgeX+side*Math.sin(u*Math.PI*2.2+t*.18)*W*.1,y=H*(.82-u*.7);if(i===0)c.moveTo(x,y);else c.lineTo(x,y)}c.stroke()}break;
            case 'qingming':c.fillStyle=this.paint.mist||'rgba(95,124,150,.08)';c.fillRect(0,H*.45,W,H*.55);c.strokeStyle='rgba(92,132,119,.1)';c.lineWidth=2;for(const side of[-1,1]){const x=side<0?0:W;c.beginPath();c.moveTo(x,H*.16);c.bezierCurveTo(x-side*50,H*.32,x-side*18,H*.55,x-side*85,H*.74);c.stroke()}break;
            case 'labor':c.fillStyle=this.paint.warm||'rgba(255,190,92,.08)';c.fillRect(0,0,W,H);c.fillStyle=`rgba(255,222,140,${.025+introP*.045})`;for(let i=0;i<5;i++){c.beginPath();c.moveTo(W*.5,H*.08);c.lineTo(W*(.1+i*.2),H);c.lineTo(W*(.22+i*.16),H);c.closePath();c.fill()}break;
            case 'dragonBoat':c.strokeStyle=`rgba(150,230,213,${.08+introP*.17})`;c.lineWidth=2.5;for(let j=0;j<3;j++){c.beginPath();for(let i=0;i<=20;i++){const x=i/20*W,y=H*(.79+j*.035)+Math.sin(i*.9-t*2+j)*4;if(i===0)c.moveTo(x,y);else c.lineTo(x,y)}c.stroke()}break;
            case 'qixi':c.strokeStyle=`rgba(185,179,255,${.08+introP*.2})`;c.lineWidth=2;c.beginPath();c.moveTo(W*.08,H*.22);c.quadraticCurveTo(W*.5,H*.09,W*.92,H*.22);c.stroke();for(let i=0;i<18;i++){const x=W*(.12+i*.045),y=H*(.215-.12*Math.sin(i/17*Math.PI));c.fillStyle=`rgba(220,230,255,${.1+.12*Math.sin(t+i)})`;c.fillRect(x,y,1.2,1.2)}break;
            case 'zhongyuan':c.fillStyle=this.paint.mist||'rgba(38,61,120,.09)';c.fillRect(0,H*.48,W,H*.52);c.strokeStyle='rgba(255,196,110,.09)';for(let i=0;i<3;i++){const x=W*(.2+i*.3),y=H*.8;c.beginPath();c.ellipse(x,y,34,7,0,0,TAU);c.stroke()}break;
            case 'midAutumn':{let moon=null;try{moon=this.options.getMoonScreenPoint?.()}catch(e){}const x=Number.isFinite(moon?.x)?moon.x:W*.8,y=Number.isFinite(moon?.y)?moon.y:H*.2,visible=moon?.visible!==false;c.globalCompositeOperation='lighter';if(visible){c.strokeStyle=`rgba(255,237,185,${.1+.04*Math.sin(t*.65)})`;for(let i=1;i<=3;i++){c.lineWidth=4-i;c.beginPath();c.arc(x,y,28+i*14,0,TAU);c.stroke()}}c.globalCompositeOperation='source-over';c.strokeStyle='rgba(218,226,245,.08)';c.lineWidth=7;for(const side of[-1,1]){c.beginPath();c.moveTo(side<0?0:W,H*.28);c.bezierCurveTo(W*(side<0?.12:.88),H*.23,W*(side<0?.22:.78),H*.35,W*(side<0?.34:.66),H*.3);c.stroke()}break}
            case 'doubleNinth':c.strokeStyle='rgba(86,79,75,.11)';c.lineWidth=2;for(const side of[-1,1]){c.beginPath();c.moveTo(side<0?0:W,H*.82);for(let i=0;i<5;i++){const x=side<0?i*W*.08:W-i*W*.08,y=H*(.76-(i%2)*.08);c.lineTo(x,y)}c.stroke()}break;
            case 'national':{const wind=clamp(Number(this._safeCall('getWindX',0)),-1,1),sway=Math.sin(t*.65)*12+wind*18;c.lineCap='round';for(const side of[-1,1]){for(const stroke of[{width:25,color:`rgba(255,126,70,${.17+introP*.08})`},{width:14,color:`rgba(222,41,16,${.76+introP*.16})`},{width:2.4,color:`rgba(255,196,138,${.34+introP*.16})`}]){c.strokeStyle=stroke.color;c.lineWidth=stroke.width;c.beginPath();c.moveTo(side<0?-10:W+10,H*.78);c.bezierCurveTo(W*(side<0?.12:.88),H*.64,W*(side<0?.19:.81)+sway,H*.93,W*(side<0?.36:.64),H*.82);c.stroke()}}c.fillStyle=`rgba(255,215,90,${.2+introP*.36})`;for(let i=0;i<5;i++){c.save();c.translate(34+i*22,32+(i%2)*12);drawStar(c,4+i*.3);c.fill();c.restore()}break}
            case 'laba':c.strokeStyle='rgba(231,202,161,.13)';c.lineWidth=4;for(const x of[W*.13,W*.87]){c.beginPath();c.arc(x,H*.83,50,0,Math.PI);c.stroke();for(let i=0;i<2;i++){c.beginPath();c.moveTo(x-16+i*22,H*.74);c.bezierCurveTo(x-28+i*22,H*.67,x+5+i*22,H*.61,x-4+i*22,H*.54);c.stroke()}}break;
            case 'xiaonian':c.strokeStyle=`rgba(255,196,76,${.08+introP*.28})`;c.lineWidth=4;if(intro>=0&&intro<2){const p=smoothstep(0,1.5,intro),x=lerp(W*.5,W*.08,p);c.beginPath();c.moveTo(W*.5,H*.8);c.quadraticCurveTo(x,H*.62,W*.04,H*.72);c.stroke();c.beginPath();c.moveTo(W*.5,H*.8);c.quadraticCurveTo(W-x,H*.62,W*.96,H*.72);c.stroke()}break;
        }
        c.restore();
    }
    _drawParticle(c,p){
        const mode=this.theme.mode,avoid=this._softAlpha(p.x,p.y,p.size),base=p.alpha*avoid*(this.reducedMotion?.55:1);if(base<.02)return;
        c.save();c.translate(p.x,p.y);c.rotate(p.rot);c.globalAlpha=base;c.lineWidth=1;const palette=this.theme.palette,color=palette[p.color%palette.length];
        switch(mode){
            case 'snow':c.strokeStyle=color;c.fillStyle=color;if(p.variant)drawSnowflake(c,p.size);else{c.beginPath();c.arc(0,0,p.size,0,TAU);c.fill()}break;
            case 'eve':if(p.variant){c.globalCompositeOperation='lighter';c.fillStyle=color;c.beginPath();c.arc(0,0,p.size*2.1,0,TAU);c.fill();c.globalAlpha*=1.6;c.beginPath();c.arc(0,0,p.size*.7,0,TAU);c.fill()}else{c.fillStyle=color;c.fillRect(-p.size*.7,-p.size,p.size*1.4,p.size*2)}break;
            case 'spring':{const life=Math.max(0,1-p.t/p.life);c.globalAlpha*=life;if(p.variant){c.fillStyle='#d92927';c.fillRect(-p.size*.5,-p.size,p.size,p.size*2)}else{c.globalCompositeOperation='lighter';c.fillStyle=color;c.beginPath();c.arc(0,0,p.size*(.5+life),0,TAU);c.fill()}break}
            case 'lantern':c.shadowColor='#ffb75e';c.shadowBlur=this.quality==='low'?0:9;c.fillStyle='rgba(210,54,45,.6)';c.strokeStyle='#ffd899';drawLantern(c,p.size);c.shadowBlur=0;c.globalAlpha*=.26;c.scale(1,-.28);c.translate(0,-p.size*7);drawLantern(c,p.size*.75);break;
            case 'dragon':if(p.variant){c.strokeStyle='#d8b45c';c.beginPath();c.moveTo(-p.size*2,0);c.quadraticCurveTo(0,-p.size,p.size*2,0);c.stroke()}else{c.fillStyle=color;c.beginPath();c.arc(0,0,p.size,Math.PI*.15,Math.PI*1.85);c.lineTo(0,0);c.fill()}break;
            case 'qingming':if(p.variant){c.fillStyle=color;c.strokeStyle='rgba(40,85,72,.5)';drawLeaf(c,p.size,.55)}else{c.strokeStyle='rgba(190,218,226,.65)';c.beginPath();c.moveTo(0,-p.size*5);c.lineTo(-p.size*2,p.size*6);c.stroke()}break;
            case 'labor':if(p.variant){c.strokeStyle='rgba(230,178,62,.55)';c.lineWidth=1.5;drawGear(c,p.size,10)}else{c.globalCompositeOperation='lighter';c.fillStyle=color;c.beginPath();c.arc(0,0,p.size,0,TAU);c.fill()}break;
            case 'dragonBoat':if(p.variant===0){c.fillStyle='#4c9a61';c.strokeStyle='#d6efca';drawLeaf(c,p.size,.12)}else if(p.variant===1){c.strokeStyle=palette[p.color];c.lineWidth=1.5;c.beginPath();c.moveTo(-p.size*1.4,-p.size*.3);c.quadraticCurveTo(0,p.size,p.size*1.4,-p.size*.3);c.stroke()}else{c.fillStyle='rgba(199,241,248,.7)';c.beginPath();c.arc(0,0,p.size*.55,0,TAU);c.fill()}break;
            case 'qixi':if(p.variant===2){c.fillStyle='#ffb8da';drawHeart(c,p.size*.75);c.fill()}else if(p.variant===1){c.strokeStyle='#dce9ff';c.beginPath();c.moveTo(-p.size,0);c.quadraticCurveTo(0,-p.size*.6,p.size,0);c.quadraticCurveTo(0,p.size*.18,-p.size,0);c.stroke()}else{c.globalCompositeOperation='lighter';c.fillStyle=color;drawStar(c,p.size*.75,.35,4);c.fill()}break;
            case 'zhongyuan':if(p.variant){c.fillStyle='rgba(118,143,232,.55)';c.beginPath();c.arc(0,0,p.size*.6,0,TAU);c.fill()}else{c.shadowColor='#ffbd72';c.shadowBlur=this.quality==='low'?0:8;c.fillStyle='#ffb56d';drawLotus(c,p.size);c.fill();c.shadowBlur=0}break;
            case 'midAutumn':if(p.variant){c.strokeStyle='rgba(220,228,245,.18)';c.lineWidth=5;c.beginPath();c.moveTo(-p.size,0);c.bezierCurveTo(-p.size*.2,-p.size*.4,p.size*.2,p.size*.4,p.size,0);c.stroke()}else{c.fillStyle=color;c.beginPath();for(let i=0;i<4;i++){c.ellipse(Math.cos(i*Math.PI/2)*p.size*.45,Math.sin(i*Math.PI/2)*p.size*.45,p.size*.5,p.size*.22,i*Math.PI/2,0,TAU)}c.fill()}break;
            case 'doubleNinth':if(p.variant){c.fillStyle='#a34b3e';c.beginPath();c.arc(0,0,p.size,0,TAU);c.fill();c.beginPath();c.arc(p.size*.8,p.size*.2,p.size*.65,0,TAU);c.fill()}else{c.fillStyle=color;c.beginPath();c.ellipse(0,0,p.size,p.size*.38,0,0,TAU);c.fill()}break;
            case 'national':if(p.variant){c.globalCompositeOperation='lighter';c.fillStyle='#ffdc72';drawStar(c,p.size);c.fill()}else{c.fillStyle=color;c.fillRect(-p.size*.55,-p.size,p.size*1.1,p.size*2)}break;
            case 'winter':if(p.variant){c.strokeStyle='#e9f7ff';drawSnowflake(c,p.size)}else{c.strokeStyle='rgba(255,235,203,.32)';c.lineWidth=Math.max(2,p.size*.16);c.beginPath();c.moveTo(0,p.size);c.bezierCurveTo(-p.size*.5,p.size*.3,p.size*.5,-p.size*.25,0,-p.size);c.stroke()}break;
            case 'laba':{const colors=['#f4e4ca','#a44f45','#d5aa70','#f0c985','#8c5d4b','#ead8b3','#c16c52','#e9c995'];c.fillStyle=colors[p.variant];if(p.variant%3===0){c.beginPath();c.ellipse(0,0,p.size*1.3,p.size*.62,0,0,TAU);c.fill()}else{c.beginPath();c.arc(0,0,p.size,0,TAU);c.fill()}break}
            case 'xiaonian':if(p.variant===1){c.fillStyle='#e84b32';c.fillRect(-p.size*.6,-p.size,p.size*1.2,p.size*2)}else if(p.variant===2){c.strokeStyle='rgba(255,214,126,.45)';c.beginPath();c.moveTo(-p.size*2,0);c.lineTo(p.size*2,0);c.stroke()}else{c.globalCompositeOperation='lighter';c.fillStyle=color;c.beginPath();c.arc(0,0,p.size,0,TAU);c.fill()}break;
        }
        c.restore();
    }
}

export function createFestivalScreenFx(options={}){return new FestivalScreenFx(options)}
