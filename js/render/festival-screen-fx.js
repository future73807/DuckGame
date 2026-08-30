// 16 套节日屏幕粒子：单 Canvas、对象池、确定性分层采样与分档刷新；冬至为四角冰晶蕨循环绽放，腊八为四角水雾循环显隐。
// 粒子覆盖完整屏幕，不读取也不规避鸭子、名牌或 HUD；UI 仅按自身 z-index 自然叠放。

const TAU=Math.PI*2;
const QUALITY_PRESETS=Object.freeze({
    low:{hz:30,resolution:.75},
    mid:{hz:45,resolution:1},
    high:{hz:60,resolution:1}
});
const FLOW_MODES=new Set(['snow','eve','lantern','dragon','qingming','labor','dragonBoat','qixi','doubleNinth','xiaonian']);

function theme(id,themeName,label,palette,quality,introDuration,mode){
    return Object.freeze({id,theme:themeName,label,palette:Object.freeze(palette),quality:Object.freeze(quality),introDuration,mode});
}

export const FESTIVAL_SCREEN_FX_THEMES=Object.freeze({
    festival_new_year:theme('festival_new_year','ice-crystal-dawn','元旦 · 冰晶晨光',['#f7fbff','#9fd8ff','#78bde8'],{low:24,mid:56,high:96},2.2,'snow'),
    festival_eve:theme('festival_eve','golden-vigil-confetti','除夕 · 金纸守岁',['#ffe29a','#ffd166','#e9a83f'],{low:18,mid:32,high:48},2.2,'eve'),
    // 高档容纳旧版 42/56 粒爆发的重叠生命周期；中低档只缩并发预算，不改变火箭→爆发语义。
    festival_spring:theme('festival_spring','classic-spring-fireworks','春节 · 金红烟花',['#ffd166','#ffb84d','#fff3d6','#ff9f43','#ff5a4e','#ff8b69','#ffffff'],{low:72,mid:144,high:288},9,'spring'),
    festival_lantern:theme('festival_lantern','rising-lanterns','元宵 · 孔明灯升空',['#d94b31','#ef6a37','#ffd38a'],{low:12,mid:20,high:32},2.4,'lantern'),
    festival_dragon_heads:theme('festival_dragon_heads','jade-gold-particles','龙抬头 · 青金粒子',['#55c98f','#8be0a8','#e4c65a'],{low:20,mid:36,high:56},2,'dragon'),
    festival_qingming:theme('festival_qingming','even-willow-leaves','清明 · 青叶徐落',['#77a96b','#95bf79','#527f59'],{low:18,mid:32,high:48},2.2,'qingming'),
    festival_labor:theme('festival_labor','worklight-particles','劳动节 · 晨光粒子',['#ffe09a','#e9b84e','#8fd0d4'],{low:20,mid:36,high:56},2,'labor'),
    festival_dragon_boat:theme('festival_dragon_boat','green-gold-leaves','端午 · 绿金叶雨',['#4e9c62','#83bd69','#e1c653','#f1dc79'],{low:18,mid:32,high:48},2.2,'dragonBoat'),
    festival_qixi:theme('festival_qixi','classic-qixi-hearts','七夕 · 粉紫心雨',['#ff9ec7','#ba8eff','#ffd0e5'],{low:16,mid:28,high:44},2.2,'qixi'),
    festival_zhongyuan:theme('festival_zhongyuan','even-ghost-flames','中元 · 鬼火浮现',['#70d7d2','#8c9cff','#b8f3dc'],{low:12,mid:20,high:32},2.4,'zhongyuan'),
    festival_mid_autumn:theme('festival_mid_autumn','moon-stars','中秋 · 月下星光',['#fff7dc','#ffd66b','#f7fbff'],{low:18,mid:36,high:56},2.2,'midAutumn'),
    festival_double_ninth:theme('festival_double_ninth','golden-autumn-leaves','重阳 · 金叶徐落',['#e9b94f','#ffd46c','#c88b35'],{low:18,mid:32,high:48},2.2,'doubleNinth'),
    festival_national_day:theme('festival_national_day','fireworks-and-stars','国庆 · 礼花星光',['#ffdc72','#fff1cf','#ff6b54','#d92826'],{low:24,mid:48,high:72},2.5,'national'),
    festival_winter_solstice:theme('festival_winter_solstice','corner-window-frost','冬至 · 四角结冰',['#f3fbff','#bfe9ff','#d9f4ff'],{low:8,mid:12,high:16},2.2,'winter'),
    festival_laba:theme('festival_laba','corner-breath-mist','腊八 · 四角雾气',['#f7f4ee','#dcecf1','#fff7e5'],{low:8,mid:12,high:20},2.2,'laba'),
    festival_xiaonian:theme('festival_xiaonian','classic-golden-rise','小年 · 金粒升空',['#ffd166','#ffe29a','#ffb84d'],{low:16,mid:28,high:44},2,'xiaonian')
});

export const FESTIVAL_SCREEN_FX_IDS=Object.freeze(Object.keys(FESTIVAL_SCREEN_FX_THEMES));

function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function smoothstep(a,b,v){const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t)}
function normalizeQuality(value){return value==='high'?'high':value==='low'||value==='restricted'?'low':'mid'}
function hashText(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function seeded(seed){let x=seed>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296}
function wrapRange(value,min,max){const span=Math.max(1e-6,max-min);return((value-min)%span+span)%span+min}

function gridShape(count,width,height){
    const n=Math.max(1,Math.floor(count)||1),aspect=Math.max(.35,Number(width)||1)/Math.max(1,Number(height)||1);
    const cols=Math.max(1,Math.ceil(Math.sqrt(n*aspect))),rows=Math.max(1,Math.ceil(n/cols));
    return{cols,rows,cells:cols*rows};
}

// 每个粒子固定占用一个网格单元，只在单元内部抖动；横竖屏和重生后都不会聚成边带或挖出中央空洞。
export function stratifiedPoint(index,count,width,height,jitterX=.5,jitterY=.5){
    const W=Math.max(1,Number(width)||1),H=Math.max(1,Number(height)||1),n=Math.max(1,Math.floor(count)||1),shape=gridShape(n,W,H);
    const logicalIndex=((Math.floor(index)||0)%n+n)%n;
    // 网格单元数略大于粒子数时，先均匀抽取，再逐行错开列位；避免 12 粒/5×3 等组合把整条中央列挖空。
    const sampledCell=Math.min(shape.cells-1,Math.floor((logicalIndex+.5)*shape.cells/n)),row=Math.floor(sampledCell/shape.cols);
    const col=(sampledCell%shape.cols+row*2)%shape.cols,cell=row*shape.cols+col;
    // 分布凌乱感：X/Y 两轴都在网格单元内叠加按 cell 哈希的有机偏移，打散整齐的行列对齐；
    // 基础 inset 仍保留 .14/.05，哈希抖动幅度加大，把粒子从规则栅格中“搅乱”，不改变每格的唯一归属。
    const insetY=.14,insetX=.05,bx=clamp(Number(jitterX)||0,0,1),by=clamp(Number(jitterY)||0,0,1);
    const ox=(hashText('fx'+cell)/4294967296-.5)*.5;
    const oy=(hashText('fy'+cell)/4294967296-.5)*.46;
    const jx=clamp(insetX+bx*(1-insetX*2)+ox,0,1),jy=clamp(insetY+by*(1-insetY*2)+oy,0,1);
    return{x:(col+jx)/shape.cols*W,y:(row+jy)/shape.rows*H,cell,col,row,...shape};
}

// 保留 46×46 世界尺度，通过相机深度适配窄屏；返回值直接对应透视相机的 NDC 边界，便于自动回归。
export function computeFestivalMoonLayout(options={}){
    const aspect=clamp(Number(options.aspect)||16/9,.1,10),verticalFov=clamp(Number(options.verticalFov)||55,1,179),zoom=Math.max(.01,Number(options.zoom)||1);
    const scale=Math.max(0,Number(options.scale)||46),halfScale=scale*.5,tanHalfFov=Math.tan(verticalFov*Math.PI/360)/zoom;
    const baseDepth=Math.max(.01,Number(options.baseDepth)||70),maxRadiusX=clamp(Number(options.maxRadiusX)||.45,.05,.49),maxRadiusY=clamp(Number(options.maxRadiusY)||.88,.1,.94),margin=clamp(Number(options.margin)||.06,0,.2);
    const depth=Math.max(baseDepth,halfScale/(tanHalfFov*aspect*maxRadiusX),halfScale/(tanHalfFov*maxRadiusY)),halfHeight=depth*tanHalfFov;
    const radiusY=halfScale/halfHeight,radiusX=radiusY/aspect,minX=-1+radiusX+margin,maxX=1-radiusX-margin,minY=-1+radiusY+margin,maxY=1-radiusY-margin;
    const targetX=Number.isFinite(Number(options.targetX))?Number(options.targetX):.5,targetY=Number.isFinite(Number(options.targetY))?Number(options.targetY):.5;
    const centerX=clamp(targetX,minX,maxX),centerY=clamp(targetY,minY,maxY),offsetX=centerX*halfHeight*aspect,offsetY=centerY*halfHeight;
    return{aspect,verticalFov,zoom,scale,depth,halfHeight,radiusX,radiusY,centerX,centerY,offsetX,offsetY,
        bounds:{left:centerX-radiusX,right:centerX+radiusX,bottom:centerY-radiusY,top:centerY+radiusY}};
}

function flowingPoint(index,count,width,height,jitterX=.5){
    const n=Math.max(1,Math.floor(count)||1),W=Math.max(1,width||1),H=Math.max(1,height||1),bands=Math.min(n,n<=20?4:n<=40?5:n<=60?6:8);
    const col=index,row=index%bands,cycle=Math.floor(index/bands),xInset=.35+clamp(Number(jitterX)||0,0,1)*.3;
    // 初始即凌乱：纵向按黄金比低差异错相 + 每格哈希抖动，开局就是散点而非 4–8 条等距横带；横向在列槽内按 cell 哈希错开 ±.5 槽宽。
    const cell=row*n+col,h=(hashText('fyflow'+cell)/4294967296-.5);
    const phase=(((col*.61803398875)%1+h*.6)%1+1)%1,span=H+48;
    const slotW=W/n,flowOx=(hashText('fxflow'+cell)/4294967296-.5);
    const x=clamp((col+xInset)/n*W+flowOx*slotW,2,W-2);
    return{x,y:-24+phase*span,cols:n,rows:bands,col,row,cell};
}

function ghostPoint(index,count,width,height,jitterX=.5,jitterY=.5){
    const point=flowingPoint(index,count,width,height,jitterX),H=Math.max(1,height||1),n=Math.max(1,Math.floor(count)||1);
    const visualPhase=(hashText('fg'+point.cell)/4294967296)%1;
    return{...point,y:clamp((point.y+24)/(H+48),0,1)*H,phase:visualPhase*TAU,cell:point.row*n+point.col};
}

function roundedRect(ctx,x,y,w,h,r){
    const rr=Math.min(r,w*.5,h*.5);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
}
function drawStar(ctx,r,inner=.44,points=5){
    ctx.beginPath();for(let i=0;i<points*2;i++){const a=-Math.PI/2+i*Math.PI/points,rr=i%2?r:r*inner,x=Math.cos(a)*rr,y=Math.sin(a)*rr;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.closePath();
}
function drawHeart(ctx,s){
    ctx.beginPath();ctx.moveTo(0,s*.55);ctx.bezierCurveTo(-s,-s*.08,-s*.52,-s*.9,0,-s*.27);ctx.bezierCurveTo(s*.52,-s*.9,s,-s*.08,0,s*.55);ctx.closePath();
}
function drawLeaf(ctx,s){
    ctx.beginPath();ctx.moveTo(-s,0);ctx.quadraticCurveTo(-s*.25,-s*.48,s*.95,-s*.08);ctx.quadraticCurveTo(s*1.08,0,s*.95,s*.12);ctx.quadraticCurveTo(-s*.22,s*.44,-s,0);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(-s*.9,0);ctx.lineTo(s*.86,.01);ctx.stroke();
}
function drawSnowflake(ctx,r){
    ctx.beginPath();for(let i=0;i<3;i++){const a=i*Math.PI/3,dx=Math.cos(a)*r,dy=Math.sin(a)*r;ctx.moveTo(-dx,-dy);ctx.lineTo(dx,dy)}ctx.stroke();
}
function drawLantern(ctx,s,quality){
    ctx.shadowColor='#ffad55';ctx.shadowBlur=quality==='low'?0:7;
    ctx.fillStyle='#d94b31';ctx.strokeStyle='#ffd38a';ctx.lineWidth=1;
    roundedRect(ctx,-s*.62,-s*.72,s*1.24,s*1.44,s*.3);ctx.fill();ctx.stroke();
    ctx.shadowBlur=0;ctx.fillStyle='rgba(255,225,150,.28)';roundedRect(ctx,-s*.34,-s*.55,s*.68,s*1.1,s*.2);ctx.fill();
    ctx.fillStyle='#e9b75b';ctx.fillRect(-s*.48,-s*.84,s*.96,s*.13);ctx.fillRect(-s*.48,s*.71,s*.96,s*.13);
    ctx.strokeStyle='rgba(255,224,157,.6)';ctx.beginPath();ctx.moveTo(-s*.22,-s*.65);ctx.lineTo(-s*.22,s*.64);ctx.moveTo(s*.22,-s*.65);ctx.lineTo(s*.22,s*.64);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,s*.84);ctx.lineTo(0,s*1.16);ctx.moveTo(-s*.14,s*1.16);ctx.lineTo(s*.14,s*1.16);ctx.stroke();
}
function drawGhostFlame(ctx,s,quality){
    ctx.globalCompositeOperation='lighter';ctx.shadowColor='#72d9dc';ctx.shadowBlur=quality==='low'?0:9;
    ctx.beginPath();ctx.moveTo(0,-s);ctx.bezierCurveTo(s*.8,-s*.2,s*.62,s*.72,0,s);ctx.bezierCurveTo(-s*.7,s*.65,-s*.74,-s*.12,0,-s);ctx.fill();
    ctx.shadowBlur=0;ctx.globalAlpha*=.55;ctx.fillStyle='#d7fff2';ctx.beginPath();ctx.ellipse(0,s*.25,s*.23,s*.4,0,0,TAU);ctx.fill();
}

// 局部确定性 PRNG：种子固定则序列固定，用于一次性预生成分形/水珠结构（仅在 resize 时重建）。
function makeRng(seed){let x=(seed>>>0)||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296}}

// 四角冰窗花：对照实拍结霜窗（浓密羽状冰晶丛）重做 —— 三层结构：
//   1) 贴边冰针带：沿两条屏幕边密排细短冰针，越靠角落越密，营造「冻住窗框」的浓密亮边；
//   2) 羽状冰针丛：主茎从角落小范围丛生，几乎垂直的成对短羽枝向尖端渐细渐短，蓬松如羽毛；
//   3) 游离碎霜：冰丛前沿与缝隙间散落小冰粒，补出颗粒闪烁感。
// 每段仍带 grow（0=紧贴角落，1=最远端）：生长按它逐段点亮、消融按它从枝梢逐段退去。
function buildCornerFrost(rng,reach,detail){
    const segs=[],dots=[],low=detail<=1;
    // ---- 贴边冰针带 ----
    const edgeCount=low?16:34;
    for(let e=0;e<2;e++)for(let i=0;i<edgeCount;i++){
        const d=Math.pow(rng(),1.8)*reach*1.1,off=(rng()-.5)*5,bx=(e?d:off),by=(e?off:d),base=e?Math.PI/2:0;
        const a=base+(rng()-.5)*1.15,len=reach*(.04+rng()*.17)*(1-.45*d/(reach*1.2));
        const ex=bx+Math.cos(a)*len,ey=by+Math.sin(a)*len,g=clamp(d/(reach*1.08),0,1);
        segs.push({x1:bx,y1:by,x2:ex,y2:ey,w:.45+rng()*.55,tip:.04+g*.3,grow:g*.6});
        if(!low&&rng()<.65){const fa=a+(rng()<.5?1:-1)*(.9+rng()*.7),fl=len*(.3+rng()*.5);
            segs.push({x1:ex,y1:ey,x2:ex+Math.cos(fa)*fl,y2:ey+Math.sin(fa)*fl,w:.3+rng()*.3,tip:.08+g*.3,grow:g*.6+.05})}
    }
    // ---- 羽状冰针丛 ----
    const plumes=low?8:15+Math.floor(rng()*3),steps=low?9:13;
    for(let f=0;f<plumes;f++){
        const angle=.05+1.14*(plumes>1?f/(plumes-1):.5)+(rng()-.5)*.13;
        const len=reach*(.4+Math.pow(rng(),1.15)*.52),curve=(rng()-.5)*.45,spine=[];
        let x=rng()*reach*.05,y=rng()*reach*.05,a=angle;
        for(let s=0;s<steps;s++){
            const sl=len/steps;a+=curve*(1-s/steps)*.6;
            const nx=x+Math.cos(a)*sl,ny=y+Math.sin(a)*sl;spine.push([x,y,nx,ny,a]);x=nx;y=ny;
        }
        spine.forEach(([px,py,nx,ny,sa],i)=>{
            const t=i/spine.length,g=t*.92;
            segs.push({x1:px,y1:py,x2:nx,y2:ny,w:1.2*(1-t*.82)+.18,tip:t,grow:g});
            if(t<.03||(low&&i%2))return;
            const br=(1-t)*reach*.15*(.4+rng()*.7),bw=.46*(1-t)+.13;
            for(const dir of[1,-1]){
                if(rng()<.08)continue; // 偶尔缺一根羽枝，打破鱼骨般的规律感
                // 羽枝向前掠扫（约 40–65°）而非严格垂直，长度随机拉开，蓬松接近实拍羽毛霜
                const fa=sa+dir*(.7+rng()*.45),ex=nx+Math.cos(fa)*br,ey=ny+Math.sin(fa)*br;
                segs.push({x1:nx,y1:ny,x2:ex,y2:ey,w:bw,tip:t+.03,grow:g+.045});
                if(!low&&t<.72&&rng()<.55){const fa2=fa+dir*(.12+rng()*.32),bl=br*(.3+rng()*.35);
                    segs.push({x1:ex,y1:ey,x2:ex+Math.cos(fa2)*bl,y2:ey+Math.sin(fa2)*bl,w:bw*.42,tip:t+.08,grow:g+.09})}
                // 内半段再加一对更短的贴茎绒羽，堆出实拍霜羽的厚度
                if(!low&&t<.5&&rng()<.6){const fb=sa-dir*(.85+rng()*.3),bl=br*(.4+rng()*.35);
                    segs.push({x1:nx,y1:ny,x2:nx+Math.cos(fb)*bl,y2:ny+Math.sin(fb)*bl,w:bw*.7,tip:t+.04,grow:g+.06})}
            }
        });
        spine.forEach(([px,py],i)=>{if(rng()>.45)return;dots.push({x:px+(rng()-.5)*3,y:py+(rng()-.5)*3,r:.35+rng()*.75,phase:rng()*TAU,grow:(i/spine.length)*.92+.03})});
    }
    // ---- 游离碎霜 ----
    const loose=low?16:48;
    for(let i=0;i<loose;i++){
        const ang=rng()*Math.PI*.5,dist=Math.pow(rng(),1.3)*reach;
        dots.push({x:Math.cos(ang)*dist,y:Math.sin(ang)*dist,r:.3+rng()*.9,phase:rng()*TAU,grow:dist/reach*.92});
    }
    return{segs,dots};
}

// 冰窗花绽放周期：整簇一轮约 14 秒，出现与消失各约 3.1 秒，节奏更舒缓。
const FROST_BLOOM_PERIOD=14;
// 冰窗花绽放包络（约 14 秒一轮）：0→.22 从角落向外生长出现、.22→.5 完整绽放、.5→.72 逐渐消散、
// .72→1 完全消失 —— 每簇冰花都清晰经历「出现→消失→再出现→再消失」的完整循环。
export function frostBloomEnvelope(age,phase,period){
    const t=((age/Math.max(1e-6,Number(period)||FROST_BLOOM_PERIOD)+(Number(phase)||0))%1+1)%1;
    if(t<.22)return smoothstep(0,.22,t);
    if(t<.5)return 1;
    if(t<.72)return 1-smoothstep(.5,.72,t);
    return 0;
}

// 腊八水雾包络：整团雾气约 6 秒一个「出现→消失→再出现」循环（出现 .96s、停留 2.4s、消散 1.08s、隐藏 1.56s）。
export function labaMistEnvelope(age,phase){
    const t=((age/6+(Number(phase)||0))%1+1)%1;
    if(t<.16)return smoothstep(0,.16,t);
    if(t<.56)return 1;
    if(t<.74)return 1-smoothstep(.56,.74,t);
    return 0;
}

// 角落凝结的水珠（对照实拍雾窗重做）：细密微珠铺满近整角形成雾面颗粒感，
// 中大水珠带高光与微偏移的底部阴影，部分挂微微摆弯的下淌尾痕。
// 返回 {micro,falls}：micro 按两种明暗分组批量绘制，falls 逐颗绘制。
function buildCornerDrops(rng,reach,streakDir,detail){
    const micro=[],falls=[],low=detail<=1;
    const mCount=low?120:320;
    for(let i=0;i<mCount;i++){
        const dist=Math.sqrt(rng())*reach*1.02,ang=rng()*Math.PI*.5;
        micro.push({x:Math.cos(ang)*dist,y:Math.sin(ang)*dist,r:.4+rng()*.95,el:1+rng()*.6,shade:rng()<.55?0:1});
    }
    const fCount=low?10:18;
    for(let i=0;i<fCount;i++){
        const dist=Math.sqrt(Math.pow(rng(),1.35))*reach,ang=rng()*Math.PI*.5;
        const big=rng()<.16,r=(big?2.2:1.1)+rng()*(big?2.2:1.5),el=1+rng()*(big?.45:.85);
        falls.push({x:Math.cos(ang)*dist,y:Math.sin(ang)*dist,r,el,streak:rng()<.32?4+rng()*11:0,dir:streakDir,wob:(rng()-.5)*4});
    }
    return{micro,falls};
}

// 四角通用变换：把角落局部坐标(0,0=角，+x,+y 朝中心)映射到屏幕。
function cornerTransform(c,corner,W,H){c.translate(corner%2?W:0,corner>1?H:0);c.scale(corner%2?-1:1,corner>1?-1:1)}

class FestivalScreenFx{
    constructor(options={}){
        this.options=options;this.document=options.document||globalThis.document||null;this.window=options.window||globalThis.window||globalThis;
        this.canvas=null;this.ctx=null;this.activeId=null;this.theme=null;this.width=0;this.height=0;this.dpr=1;this.resolution=1;
        this.quality=normalizeQuality(typeof options.quality==='function'?options.quality():options.quality);
        this.reducedMotion=!!(typeof options.reducedMotion==='function'?options.reducedMotion():options.reducedMotion);
        this.motionScale=this.reducedMotion?0:1;this.flashEnabled=!this.reducedMotion;this.pool=[];this.activeCount=0;
        this.age=0;this.introAge=-1;this.introPending=false;this.accumulator=0;this.drawCount=0;this.startCount=0;this.stopCount=0;this.resizeCount=0;this.seed=1;
        this.springNextLaunch=0;this.springSequence=0;this.springPoolCursor=0;this.springLaunchTimes=[];this.springBurstSizes=[];
        this.springBursts=0;this.springGoldenBursts=0;this.springDroppedSparks=0;this.springDroppedRockets=0;this.springMaxVisible=0;
        this._lastQuality=this.quality;this._lastReduced=this.reducedMotion;this.paint={};
    }
    start(id,options={}){
        const next=FESTIVAL_SCREEN_FX_THEMES[id];if(!next){this.stop();return false}
        const deferIntro=!!options.deferIntro;if(this.activeId===id&&this.canvas){if(!deferIntro)this.playIntro();return true}
        const reuseSurface=!!this.canvas&&!!this.ctx;this.activeId=id;this.theme=next;this.seed=hashText(id);this.age=0;this.accumulator=0;
        this.introPending=deferIntro;this.introAge=deferIntro?-1:0;this.drawCount=0;
        this._resetThemeRuntime();
        if(!reuseSurface)this._createCanvas();if(!this.canvas||!this.ctx){this.activeId=null;this.theme=null;return false}
        if(this.canvas.dataset)this.canvas.dataset.festival=id;
        // 新主题必须彻底初始化对象池；只有同一主题运行中的真实 resize/画质切换才允许迁移在途春节烟花。
        this.startCount++;this._syncPreferences(true);this.resize(undefined,undefined,undefined,false);this._draw();return true;
    }
    playIntro(){if(!this.activeId||this.reducedMotion)return false;this.introPending=false;this.introAge=0;this.age=0;this._resetThemeRuntime();this._resetAll(true);return true}
    stop(){
        const wasRunning=!!this.canvas;if(this.canvas?.remove)this.canvas.remove();else if(this.canvas?.parentNode?.removeChild)this.canvas.parentNode.removeChild(this.canvas);
        this.canvas=null;this.ctx=null;this.activeId=null;this.theme=null;this.activeCount=0;this.age=0;this.introAge=-1;this.introPending=false;this.accumulator=0;if(wasRunning)this.stopCount++;
    }
    setQuality(level){const next=normalizeQuality(level);if(next===this.quality)return;this.quality=next;this._lastQuality=next;this.accumulator=0;if(this.canvas){this.resize();this._draw()}}
    setReducedMotion(value){const next=!!value;if(next===this.reducedMotion)return;this._applyReducedMotion(next,true)}
    resize(width,height,dpr,preserveSpring=true){
        if(!this.canvas||!this.ctx)return false;const win=this.window||{},nextW=Math.max(1,Math.round(Number(width)||Number(win.innerWidth)||1)),nextH=Math.max(1,Math.round(Number(height)||Number(win.innerHeight)||1));
        const oldW=this.width||nextW,oldH=this.height||nextH;
        this.dpr=Math.max(1,Number(dpr)||Number(win.devicePixelRatio)||1);this.resolution=QUALITY_PRESETS[this.quality].resolution;this.width=nextW;this.height=nextH;
        this.canvas.width=Math.max(1,Math.round(nextW*this.resolution));this.canvas.height=Math.max(1,Math.round(nextH*this.resolution));
        if(this.canvas.style){this.canvas.style.width=nextW+'px';this.canvas.style.height=nextH+'px'}this.ctx.setTransform(this.resolution,0,0,this.resolution,0,0);this.resizeCount++;this._buildPaints();
        if(this.activeCount){
            if(preserveSpring&&this.theme?.mode==='spring'&&!this.reducedMotion&&this._springActiveCount()>0)this._resizeSpringParticles(oldW,oldH,nextW,nextH);
            else this._resetAll(true);
        }
        return true;
    }
    update(dt){
        if(!this.canvas||!this.ctx||!this.theme)return;this._syncPreferences(false);const frameDt=clamp(Number(dt)||0,0,.1);
        const dimmed=this._safeCall('isDimmed',false),paused=this._safeCall('isPaused',false)||this._safeCall('isHidden',false);if(this.canvas.style)this.canvas.style.opacity=dimmed?'0.18':'1';if(paused)return;
        const updateHz=this.reducedMotion?5:QUALITY_PRESETS[this.quality].hz,step=1/updateHz;this.accumulator+=frameDt;const steps=Math.floor((this.accumulator+1e-9)/step);if(steps<1)return;
        this.accumulator-=steps*step;const elapsed=Math.min(.1,steps*step);
        // 减动效不仅冻结粒子坐标，也冻结所有直接读取 age 的背景/闪烁（冬至冰花、小年金粒等）。
        if(!this.reducedMotion){this.age+=elapsed;if(this.introAge>=0)this.introAge+=elapsed;this._advance(elapsed)}
        this._draw();
    }
    getDebugState(){
        const spring=this.theme?.mode==='spring'?{launches:this.springLaunchTimes.length,bursts:this.springBursts,goldenBursts:this.springGoldenBursts,
            launchTimes:[...this.springLaunchTimes],burstSizes:[...this.springBurstSizes],droppedSparks:this.springDroppedSparks,droppedRockets:this.springDroppedRockets,
            visible:this._springVisibleCount(),maxVisible:this.springMaxVisible}:null;
        return{running:!!this.canvas,activeId:this.activeId,theme:this.theme?.theme||null,themeId:this.theme?.theme||null,label:this.theme?.label||null,mode:this.theme?.mode||null,
            width:this.width,height:this.height,dpr:this.dpr,resolution:this.resolution,quality:this.quality,reducedMotion:this.reducedMotion,motionScale:this.motionScale,flashEnabled:this.flashEnabled,
            particleCount:this.activeCount,poolSize:this.pool.length,particleBudget:this.theme?this.theme.quality[this.quality]:0,surfaceCount:this.canvas?1:0,updateHz:this.reducedMotion?5:QUALITY_PRESETS[this.quality].hz,
            introPending:this.introPending,introActive:this.introAge>=0&&this.introAge<(this.theme?.introDuration||0),introAge:this.introAge,avoidRectCount:0,coverage:this._coverageStats(),
            spring,drawCount:this.drawCount,startCount:this.startCount,stopCount:this.stopCount,resizeCount:this.resizeCount};
    }
    getParticleSnapshot(){return this.pool.slice(0,this.activeCount).map(p=>({index:p.index,mode:this.theme?.mode,kind:p.kind||null,x:p.x,y:p.y,homeX:p.homeX,homeY:p.homeY,size:p.size,alpha:p.alpha,drawAlpha:p.drawAlpha,rot:p.rot,vr:p.vr,vx:p.vx,vy:p.vy,life:p.life,t:p.t,angle:p.angle,speed:p.speed,variant:p.variant,golden:!!p.golden,cell:p.cell,col:p.col,row:p.row,color:p.color}))}
    _coverageStats(){
        if(!this.activeCount)return{cols:0,rows:0,occupied:0,min:0,max:0};const cols=Math.max(1,this.pool[0]?.gridCols||1),rows=Math.max(1,this.pool[0]?.gridRows||1),counts=new Array(cols*rows).fill(0);
        for(let i=0;i<this.activeCount;i++){const cell=Number(this.pool[i].cell);if(Number.isInteger(cell)&&cell>=0&&cell<counts.length)counts[cell]++}
        const used=counts.filter(n=>n>0);return{cols,rows,occupied:used.length,min:used.length?Math.min(...used):0,max:used.length?Math.max(...used):0};
    }
    _createCanvas(){
        if(!this.document?.createElement)return;const canvas=this.document.createElement('canvas');canvas.className='festival-fx-cv';if(canvas.dataset)canvas.dataset.festival=this.activeId;
        const ctx=canvas.getContext?.('2d',{alpha:true});if(!ctx)return;this.canvas=canvas;this.ctx=ctx;this.document.body?.appendChild?.(canvas);
    }
    _safeCall(name,fallback){try{const fn=this.options[name];return typeof fn==='function'?fn():fallback}catch(e){return fallback}}
    _applyReducedMotion(next,redraw){
        this.reducedMotion=!!next;this._lastReduced=this.reducedMotion;this.motionScale=this.reducedMotion?0:1;this.flashEnabled=!this.reducedMotion;this.accumulator=0;
        if(this.reducedMotion){
            this.introPending=false;this.introAge=-1;
            // 中途打开减动效表示主动取消本轮春节烟花；清空对象的同时也清空事件统计，避免留下 launches > bursts 的伪运行态。
            if(this.theme?.mode==='spring')this._resetThemeRuntime();
        }
        if(redraw&&this.canvas){this._resetAll(true);this._draw()}
    }
    _syncPreferences(force){
        const qualitySource=typeof this.options.getQuality==='function'?this.options.getQuality():typeof this.options.quality==='function'?this.options.quality():this.quality;
        const reducedSource=typeof this.options.getReducedMotion==='function'?this.options.getReducedMotion():typeof this.options.reducedMotion==='function'?this.options.reducedMotion():this.reducedMotion;
        const nextQuality=normalizeQuality(qualitySource),nextReduced=!!reducedSource,qualityChanged=nextQuality!==this._lastQuality,reducedChanged=nextReduced!==this._lastReduced;
        if(force||qualityChanged){this.quality=nextQuality;this._lastQuality=nextQuality;if(!force&&qualityChanged&&this.canvas){this.accumulator=0;this.resize()}}
        if(force||reducedChanged)this._applyReducedMotion(nextReduced,!force&&reducedChanged);
        if(this.theme)this._setBudget();
    }
    _setBudget(){
        if(!this.theme)return;const full=this.theme.quality[this.quality],target=this.reducedMotion?Math.max(2,Math.floor(full*.3)):full;
        // 春节降档时先保留装着在途火箭/火花的旧池；全部回收后，下一帧自然收缩到目标预算。
        const keepSpringPool=!this.reducedMotion&&this.theme.mode==='spring'&&this._springActiveCount()>0;
        const next=keepSpringPool?Math.max(target,this.activeCount):target;
        while(this.pool.length<next)this.pool.push({cycle:0});this.activeCount=next;
    }
    _resetThemeRuntime(){
        this.springNextLaunch=0;this.springSequence=0;this.springPoolCursor=0;this.springLaunchTimes=[];this.springBurstSizes=[];
        this.springBursts=0;this.springGoldenBursts=0;this.springDroppedSparks=0;this.springDroppedRockets=0;this.springMaxVisible=0;
    }
    _springVisibleCount(){
        let count=0;for(let i=0;i<this.activeCount;i++)if(this.pool[i].kind!=='inactive'&&(this.pool[i].drawAlpha||0)>.015)count++;return count;
    }
    _springActiveCount(){
        let count=0;for(let i=0;i<this.activeCount;i++){const kind=this.pool[i]?.kind;if(kind==='rocket'||kind==='spark')count++}return count;
    }
    _resizeSpringParticles(oldW,oldH,nextW,nextH){
        const oldCount=this.activeCount,sx=nextW/Math.max(1,oldW),sy=nextH/Math.max(1,oldH),active=new Set();
        for(let i=0;i<oldCount;i++){
            const p=this.pool[i];if(p?.kind!=='rocket'&&p?.kind!=='spark')continue;active.add(i);
            p.x*=sx;p.y*=sy;p.homeX*=sx;p.homeY*=sy;p.vx*=sx;p.vy*=sy;
        }
        this._setBudget();
        for(let i=0;i<this.activeCount;i++){
            const p=this.pool[i];
            if(active.has(i)){
                const r=salt=>this._rand(i,salt,p.cycle||0),point=stratifiedPoint(i,this.activeCount,nextW,nextH,r(9),r(10));
                p.cell=point.cell;p.col=point.col;p.row=point.row;p.gridCols=point.cols;p.gridRows=point.rows;
            }else{
                p.cycle=0;this._resetParticle(p,i,true);
            }
        }
    }
    _takeSpringParticle(){
        for(let offset=0;offset<this.activeCount;offset++){
            const index=(this.springPoolCursor+offset)%this.activeCount,p=this.pool[index];
            if(p.kind!=='inactive')continue;this.springPoolCursor=(index+1)%this.activeCount;return p;
        }
        return null;
    }
    _spawnSpringRocket(launchTime){
        const sequence=this.springSequence++,p=this._takeSpringParticle();
        if(!p){this.springDroppedRockets++;return}
        const r=salt=>this._rand(sequence,80+salt,0),W=this.width,H=this.height;
        p.kind='rocket';p.variant=1;p.golden=sequence%2===0;p.eventIndex=sequence;p.t=0;p.alpha=1;p.drawAlpha=1;p.rot=0;p.vr=0;p.size=2;
        p.x=W*(.12+r(1)*.76);p.y=H+8;p.vx=(r(2)-.5)*80;p.vy=-(H*.55+r(3)*H*.32);p.springColor='rgba(255,220,140,.9)';
        this.springLaunchTimes.push(+launchTime.toFixed(4));
    }
    _burstSpring(rocket){
        const golden=!!rocket.golden,eventIndex=rocket.eventIndex||0,fullCount=golden?56:42;
        // 中低档按对象池可承受的重叠峰值缩放单次爆发，保证每枚火箭都完整爆开，绝不静默截断尾部火花。
        const scale=this.quality==='high'?1:this.quality==='mid'?.62:.3,count=Math.max(12,Math.round(fullCount*scale));
        const originX=rocket.x,originY=rocket.y;
        rocket.kind='inactive';rocket.drawAlpha=0;
        this.springBursts++;if(golden)this.springGoldenBursts++;this.springBurstSizes.push(count);
        const colors=golden?['#ffd166','#ffb84d','#fff3d6','#ff9f43']:['#ff5a4e','#ffd166','#ff8b69','#ffffff'];
        for(let i=0;i<count;i++){
            const p=this._takeSpringParticle();if(!p){this.springDroppedSparks++;continue}
            const key=(eventIndex+1)*313+i,r=salt=>this._rand(key,100+salt,eventIndex),a=r(1)*TAU,sp=50+r(2)*(golden?250:200);
            p.kind='spark';p.variant=0;p.golden=golden;p.t=0;p.alpha=1;p.drawAlpha=1;p.rot=0;p.vr=0;p.x=originX;p.y=originY;
            p.vx=Math.cos(a)*sp;p.vy=Math.sin(a)*sp;p.life=1.15+r(3)*.85;p.size=golden?2+r(4)*1.6:1.6+r(4)*1.5;p.grav=170+r(5)*80;p.springColor=colors[i%colors.length];
        }
    }
    _advanceSpring(dt){
        const effectTime=this.introAge;if(effectTime<0||this.reducedMotion)return;
        let guard=0;
        while(this.springNextLaunch<=9&&effectTime+1e-8>=this.springNextLaunch&&guard++<32){
            const launchTime=this.springNextLaunch,sequence=this.springSequence;
            this._spawnSpringRocket(launchTime);
            this.springNextLaunch=launchTime+.42+this._rand(sequence,89,0)*.4;
        }
        const bursting=[];
        for(let i=0;i<this.activeCount;i++){
            const p=this.pool[i];
            if(p.kind==='rocket'){
                p.t+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=260*dt;p.drawAlpha=1;
                if(p.vy>-40)bursting.push(p);
            }else if(p.kind==='spark'){
                p.t+=dt;
                if(p.t>=p.life){p.kind='inactive';p.drawAlpha=0;continue}
                p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=(p.grav||200)*dt;p.vx*=Math.max(0,1-dt*.6);p.drawAlpha=Math.max(0,1-p.t/p.life);
            }else p.drawAlpha=0;
        }
        for(const rocket of bursting)this._burstSpring(rocket);
        this.springMaxVisible=Math.max(this.springMaxVisible,this._springVisibleCount());
    }
    _resetAll(initial){
        this._setBudget();for(let i=0;i<this.activeCount;i++){this.pool[i].cycle=0;this._resetParticle(this.pool[i],i,initial)}
        if(this.theme?.mode==='zhongyuan')this._balanceGhostPhases();
        this._advance(0);
    }
    _balanceGhostPhases(){
        const groups=[[],[],[],[]];
        for(let i=0;i<this.activeCount;i++){
            const p=this.pool[i],quadrant=(p.homeY>=this.height*.5?2:0)+(p.homeX>=this.width*.5?1:0);groups[quadrant].push(p);
        }
        // 每个象限内部等距错峰：每盏仍会完整出现/消失，低档也不会整块熄灭或全屏同时全亮。
        for(let quadrant=0;quadrant<groups.length;quadrant++){
            const group=groups[quadrant];
            for(let rank=0;rank<group.length;rank++)group[rank].phase=((rank/group.length+quadrant*.173)%1)*TAU;
        }
    }
    _rand(index,salt,cycle=0){
        const base=(this.seed+Math.imul(index+1,0x9e3779b1)+Math.imul(salt+1,0x85ebca6b)+Math.imul(cycle+1,0xc2b2ae35))>>>0;
        const injected=this.options.random;if(typeof injected==='function'){const value=Number(injected(base,index,salt,cycle));if(Number.isFinite(value))return value-Math.floor(value)}return seeded(base);
    }
    _resetParticle(p,index,initial=false){
        const W=this.width||1,H=this.height||1,r=salt=>this._rand(index,salt,p.cycle||0),point=stratifiedPoint(index,this.activeCount,W,H,r(9),r(10)),mode=this.theme?.mode;
        p.index=index;p.cell=point.cell;p.col=point.col;p.row=point.row;p.gridCols=point.cols;p.gridRows=point.rows;p.x=point.x;p.y=point.y;p.homeX=p.x;p.homeY=p.y;p.variant=0;p.color=index%this.theme.palette.length;
        if(FLOW_MODES.has(mode)){const flow=flowingPoint(index,this.activeCount,W,H,r(9));p.cell=flow.cell;p.col=flow.col;p.row=flow.row;p.gridCols=flow.cols;p.gridRows=flow.rows;p.x=flow.x;p.y=flow.y;p.homeX=p.x;p.homeY=p.y}
        p.kind=null;p.golden=false;p.springColor=null;p.t=0;
        p.alpha=.48+r(1)*.34;p.drawAlpha=1;p.size=2+r(2)*4;p.phase=r(3)*TAU;p.rot=(r(4)-.5)*.22;p.vr=(r(5)-.5)*1.5;p.vx=(r(6)-.5)*12;p.vy=18+r(7)*28;p.life=1.1+r(8)*.8;
        // 凌乱感公共参数：每粒子的速度倍率/摆幅倍率/摆动频率/漂移半径/漂移频率/闪烁频率各随机拉开差异。
        p.speedK=1;p.swayK=1;p.swayRate=1;p.driftR=1;p.driftRate=1;
        if(mode==='zhongyuan'){const ghost=ghostPoint(index,this.activeCount,W,H,r(9),r(10));p.cell=ghost.cell;p.col=ghost.col;p.row=ghost.row;p.gridCols=ghost.cols;p.gridRows=ghost.rows;p.x=ghost.x;p.y=ghost.y;p.homeX=p.x;p.homeY=p.y;p.phase=ghost.phase}
        switch(mode){
            case'snow':p.variant=r(11)<.24?1:0;p.size=p.variant?2.6+r(11)*8.5:.7+r(11)*3.8;p.vy=14+r(12)*48;p.vx=(r(13)-.5)*26;p.rot=(r(14)-.5)*.9;p.vr=(r(15)-.5)*1.6;p.speedK=.45+r(16)*1.5;p.swayK=.35+r(17)*1.6;p.swayRate=.35+r(18)*1.7;break;
            case'eve':p.size=1.3+r(11)*8;p.vy=10+r(12)*38;p.vx=(r(13)-.5)*30;p.rot=(r(14)-.5)*1.2;p.vr=(r(15)-.5)*3.4;p.speedK=.5+r(16)*1.4;p.swayK=.3+r(17)*1.8;p.swayRate=.35+r(18)*1.8;break;
            case'spring':p.kind='inactive';p.variant=0;p.golden=false;p.drawAlpha=0;p.alpha=1;p.rot=0;p.vr=0;p.t=0;p.springColor=null;break;
            case'lantern':p.size=4.5+r(11)*7;p.vy=-(10+r(12)*26);p.vx=(r(13)-.5)*12;p.tilt=(r(14)-.5)*.2;p.rot=p.tilt;p.speedK=.55+r(16)*1.2;p.swayK=.3+r(17)*1.5;p.swayRate=.3+r(18)*1.5;break;
            case'dragon':p.variant=r(11)<.5?1:0;p.size=1+r(11)*4.8;p.vy=-(8+r(12)*28);p.vx=(r(13)-.5)*22;p.speedK=.45+r(16)*1.5;p.swayK=.3+r(17)*1.8;p.swayRate=.35+r(18)*1.8;break;
            case'qingming':p.size=3.4+r(11)*11;p.vy=12+r(12)*44;p.vx=(r(13)-.5)*32;p.rot=r(14)*TAU;p.vr=(r(15)-.5)*3.4;p.speedK=.5+r(16)*1.3;p.swayK=.3+r(17)*1.6;p.swayRate=.35+r(18)*1.7;break;
            case'labor':p.variant=r(11)<.22?1:0;p.size=.9+r(11)*4.4;p.vy=-(5+r(12)*18);p.vx=(r(13)-.5)*14;p.speedK=.45+r(16)*1.4;p.swayK=.3+r(17)*1.7;p.swayRate=.35+r(18)*1.7;break;
            case'dragonBoat':p.variant=r(11)<.5?1:0;p.size=3.4+r(11)*11;p.vy=12+r(12)*44;p.vx=(r(13)-.5)*32;p.rot=r(14)*TAU;p.vr=(r(15)-.5)*3.4;p.speedK=.5+r(16)*1.3;p.swayK=.3+r(17)*1.6;p.swayRate=.35+r(18)*1.7;break;
            case'qixi':p.variant=r(11)<.45?1:0;p.size=3+r(12)*10;p.vy=12+r(13)*32;p.vx=(r(14)-.5)*28;p.rot=(r(15)-.5)*.16;p.vr=0;p.speedK=.5+r(16)*1.3;p.swayK=.3+r(17)*1.6;p.swayRate=.35+r(18)*1.7;break;
            case'zhongyuan':p.size=5+r(11)*6;p.alpha=.4+r(13)*.35;p.vx=(r(14)-.5)*3;p.rot=(r(15)-.5)*.08;p.vr=0;p.driftR=8+r(16)*22;p.driftRate=.25+r(17)*.9;break;
            case'midAutumn':p.variant=r(11)<.3?1:0;p.size=1.2+r(11)*6.6;p.phase=r(12)*TAU;p.alpha=.3+r(13)*.36;p.driftR=4+r(14)*20;p.driftRate=.1+r(17)*.4;break;
            case'doubleNinth':p.size=3.4+r(11)*11;p.vy=12+r(12)*44;p.vx=(r(13)-.5)*32;p.rot=r(14)*TAU;p.vr=(r(15)-.5)*3.4;p.speedK=.5+r(16)*1.3;p.swayK=.3+r(17)*1.6;p.swayRate=.35+r(18)*1.7;break;
            case'national':{const starCount=Math.floor(this.activeCount*.5);p.variant=index<starCount?0:1;
                if(p.variant===0){const starPoint=stratifiedPoint(index,starCount,W,H,r(11),r(12));p.homeX=starPoint.x;p.homeY=starPoint.y;p.x=p.homeX;p.y=p.homeY;p.phase=r(13)*TAU;p.size=1.6+r(14)*4;p.rot=r(15)*TAU;p.vr=(r(16)-.5)*1.6;p.spin=r(17)*TAU;p.driftR=3+r(18)*14;p.driftRate=.14+r(19)*.5}
                else{const sparkIndex=index-starCount,sparkCount=this.activeCount-starCount;p.sparkIndex=sparkIndex;p.angle=sparkIndex/Math.max(1,sparkCount)*TAU+(r(11)-.5)*.12;p.speed=65+r(12)*145;p.life=1.15+r(13)*.7;p.size=1.6+r(14)*2.2;p.rot=0;p.vr=0}break}
            case'winter':{const corner=index%4,rank=Math.floor(index/4)+1,span=.11+rank/(Math.ceil(this.activeCount/4)+1)*.18;p.corner=corner;p.size=1.4+r(11)*2.8;p.phase=corner*.7+r(12)*TAU;p.homeX=(corner%2?1-span:span)*W;p.homeY=(corner>1?1-span:span)*H;p.x=p.homeX;p.y=p.homeY;p.alpha=.5+r(13)*.34;break}
            case'laba':{const corner=index%4,rank=Math.floor(index/4);p.corner=corner;p.size=1.8+r(11)*3.6;p.phase=r(12)*TAU+corner*.8;
                p.homeX=(corner%2?W-(18+rank*13+(r(13)-.5)*30):18+rank*13+(r(13)-.5)*30);
                p.homeY=(corner>1?H-(18+rank*12+(r(14)-.5)*26):18+rank*12+(r(14)-.5)*26);
                p.x=p.homeX;p.y=p.homeY;p.alpha=.5+r(15)*.3;p.driftR=5+r(16)*13;p.driftRate=.12+r(17)*.4;break}
            case'xiaonian':p.size=1.2+r(11)*3.4;p.vy=-(40+r(12)*40);p.vx=(r(13)-.5)*18;p.phase=r(14)*TAU;p.speedK=.6+r(16)*1.1;p.swayK=.4+r(17)*1.3;p.swayRate=.5+r(18)*1.3;break;
        }
    }
    _moveFullHeight(p,dy){p.y=wrapRange(p.y+dy,-24,this.height+24)}
    _swayInsideColumn(p,amount,rate){
        // 摆幅上限放宽到列宽一半（且不低于 8px），配合每粒子的 swayK/swayRate，让漂落不再整齐划一。
        const cols=Math.max(1,p.gridCols||1),cellW=this.width/cols,maxSway=Math.min(Math.max(0,amount),Math.max(cellW*.75,10));
        p.x=p.homeX+Math.sin(this.age*(rate||1)*(p.swayRate||1)+p.phase)*maxSway*(p.swayK||1);
    }
    _advance(dt){
        const W=this.width,H=this.height,mode=this.theme.mode;
        if(mode==='spring'){this._advanceSpring(dt);return}
        for(let i=0;i<this.activeCount;i++){
            const p=this.pool[i];p.rot+=p.vr*dt;p.drawAlpha=1;
            switch(mode){
                case'snow':this._swayInsideColumn(p,22,.7);this._moveFullHeight(p,p.vy*(p.speedK||1)*dt);break;
                case'eve':this._swayInsideColumn(p,20,.9);this._moveFullHeight(p,p.vy*(p.speedK||1)*dt);break;
                case'lantern':this._swayInsideColumn(p,16,.7);this._moveFullHeight(p,p.vy*(p.speedK||1)*dt);p.rot=p.tilt+Math.sin(this.age*.55+p.phase)*.045;break;
                case'dragon':this._swayInsideColumn(p,20,.9);this._moveFullHeight(p,p.vy*(p.speedK||1)*dt);break;
                case'qingming':case'dragonBoat':case'qixi':case'doubleNinth':this._swayInsideColumn(p,26,.8);this._moveFullHeight(p,p.vy*(p.speedK||1)*dt);break;
                case'labor':this._swayInsideColumn(p,20,.7);this._moveFullHeight(p,p.vy*(p.speedK||1)*dt);break;
                case'zhongyuan':{p.x=p.homeX+Math.sin(this.age*p.driftRate+p.phase)*p.driftR;p.y=p.homeY+Math.cos(this.age*p.driftRate*.85+p.phase)*p.driftR*.75;
                    const u=((this.age/6+p.phase/TAU)%1+1)%1;
                    p.drawAlpha=u<.16?smoothstep(0,.16,u):u<.48?1:u<.66?1-smoothstep(.48,.66,u):0;break}
                case'midAutumn':p.x=p.homeX+Math.sin(this.age*p.driftRate+p.phase)*p.driftR;p.y=p.homeY+Math.cos(this.age*p.driftRate*.9+p.phase)*p.driftR*.8;p.drawAlpha=.35+.65*(.5+.5*Math.sin(this.age*1.15+p.phase));break;
                case'national':if(p.variant===0){p.x=p.homeX+Math.sin(this.age*p.driftRate+p.phase)*p.driftR;p.y=p.homeY+Math.cos(this.age*p.driftRate*.85+p.phase)*p.driftR*.8;p.drawAlpha=.5+.5*(.5+.5*Math.sin(this.age*1.2+p.phase))}else{
                    const cycleLength=3.4,cycle=Math.floor(this.age/cycleLength),t=this.age-cycle*cycleLength,
                        round=Math.floor(cycle/6),slot=cycle%6,order=[0,1,2,3,4,5];
                    // 每轮（6 次×3.4s≈20 秒）用轮次种子做确定性洗牌，6 个燃点全部轮到且顺序随机：
                    // 保留凌乱感，又不会像纯随机那样连续多轮挤在同一处燃点、让其余点位长时间空着。
                    for(let i=5;i>0;i--){const j=Math.floor(this._rand(round,230+i,0)*(i+1)),g=order[i];order[i]=order[j];order[j]=g}
                    const group=order[slot];
                    const originX=((group%3)+.5)/3*W+(this._rand(cycle,201,0)-.5)*W*.07,originY=(Math.floor(group/3)*.38+.2)*H+(this._rand(cycle,202,0)-.5)*H*.07;
                    p.drawAlpha=t<=p.life?1-t/p.life:0;p.x=originX+Math.cos(p.angle)*p.speed*t;p.y=originY+Math.sin(p.angle)*p.speed*t+65*t*t}break;
                case'winter':p.drawAlpha=Math.pow(.5+.5*Math.sin(this.age*.48+p.phase),1.3);break;
                case'laba':p.x=p.homeX+Math.sin(this.age*p.driftRate+p.phase)*p.driftR;p.y=p.homeY+Math.cos(this.age*p.driftRate*.9+p.phase)*p.driftR*.8;p.drawAlpha=Math.pow(.5+.5*Math.sin(this.age*.42+p.phase),1.35);break;
                case'xiaonian':this._swayInsideColumn(p,22,.9);this._moveFullHeight(p,p.vy*(p.speedK||1)*dt);break;
            }
        }
    }
    _buildPaints(){
        const c=this.ctx,W=this.width,H=this.height;if(!c?.createRadialGradient){return}
        const ice=c.createRadialGradient(0,0,0,0,0,Math.max(W,H)*.42);ice.addColorStop(0,'rgba(210,242,255,.16)');ice.addColorStop(1,'rgba(210,242,255,0)');this.paint={ice};
        const mode=this.theme?.mode,reach=Math.max(40,Math.min(W,H)*.46),detail=this.quality==='low'?1:2;
        // 冬至的冰窗花/腊八的水珠雾气结构都在 resize 时一次性预生成；
        // 渐变缓存避免每帧重复 createRadialGradient/addColorStop 造成 GC 卡顿（掉帧根因之一）。
        if(mode==='winter'){
            // 冬至冰花范围更收敛：只从角落向内蔓延短边约 30%，不再铺满整块屏角。
            const wreach=Math.max(28,Math.min(W,H)*.3);
            this.paint.frost=[0,1,2,3].map(corner=>buildCornerFrost(makeRng((this.seed+corner*2654435761)>>>0),wreach,detail));
            // 霜雾渐变改为角落局部坐标，绘制时套用 cornerTransform 与生长缩放，随整簇冰花一起明灭。
            this.paint.wash=[0,1,2,3].map(()=>{const g=c.createRadialGradient(0,0,0,0,0,wreach);g.addColorStop(0,'rgba(226,247,255,.38)');g.addColorStop(.55,'rgba(208,238,255,.15)');g.addColorStop(1,'rgba(208,238,255,0)');return g});
            // 角部核心辉光 + 贴边亮带：对应参考实拍中窗框处浓密发光的冰晶带。
            this.paint.core=[0,1,2,3].map(()=>{const g=c.createRadialGradient(0,0,0,0,0,wreach*.58);g.addColorStop(0,'rgba(242,251,255,.5)');g.addColorStop(.6,'rgba(224,244,255,.2)');g.addColorStop(1,'rgba(224,244,255,0)');return g});
            // 贴边亮带用径向渐变在绘制时沿边压扁成椭圆：沿边可延伸 1.15×reach、向内衰减到 .3×reach，双向都无硬边。
            this.paint.rim=[0,1,2,3].map(()=>{const g=c.createRadialGradient(0,0,0,0,0,wreach*1.15);g.addColorStop(0,'rgba(240,251,255,.55)');g.addColorStop(.45,'rgba(224,244,255,.22)');g.addColorStop(1,'rgba(222,242,255,0)');return g});
        }else if(mode==='laba'){
            this.paint.drops=[0,1,2,3].map(corner=>buildCornerDrops(makeRng((this.seed+corner*40503+7)>>>0),reach,corner>1?-1:1,detail));
            // 角部核心浓雾 + 4 团错落薄雾：叠加出参考实拍那种整面磨砂、明暗不均的雾层。
            this.paint.mist=[0,1,2,3].map(corner=>{
                const rng=makeRng((this.seed+corner*999983+13)>>>0),blobs=[];
                const core=c.createRadialGradient(0,0,0,0,0,reach*.62);
                core.addColorStop(0,'rgba(230,238,246,.48)');core.addColorStop(.6,'rgba(224,233,243,.22)');core.addColorStop(1,'rgba(226,236,246,0)');
                blobs.push({x:0,y:0,r:reach*.62,g:core});
                for(let b=0;b<4;b++){
                    const ang=((b+.35+rng()*.5)/4.7)*Math.PI*.5,dist=reach*(.2+rng()*.55),r=reach*(.42+rng()*.4);
                    const g=c.createRadialGradient(dist*Math.cos(ang),dist*Math.sin(ang),0,dist*Math.cos(ang),dist*Math.sin(ang),r);
                    g.addColorStop(0,`rgba(226,234,242,${(.2+rng()*.22).toFixed(3)})`);g.addColorStop(.55,'rgba(222,232,242,.1)');g.addColorStop(1,'rgba(226,236,246,0)');
                    blobs.push({x:dist*Math.cos(ang),y:dist*Math.sin(ang),r,g});
                }
                return blobs;
            });
        }
    }
    _draw(){
        const c=this.ctx,W=this.width,H=this.height;if(!c)return;c.setTransform(this.resolution,0,0,this.resolution,0,0);c.clearRect(0,0,W,H);c.save();this._drawBackdrop(c,W,H);
        for(let i=0;i<this.activeCount;i++)this._drawParticle(c,this.pool[i]);c.restore();c.globalAlpha=1;c.globalCompositeOperation='source-over';this.drawCount++;
    }
    _drawBackdrop(c,W,H){
        const mode=this.theme.mode;
        if(mode==='snow'){
            c.fillStyle=this.paint.ice||'rgba(210,242,255,.08)';c.fillRect(0,0,W,H);c.save();c.translate(W,H);c.scale(-1,-1);c.fillStyle=this.paint.ice||'rgba(210,242,255,.08)';c.fillRect(0,0,W,H);c.restore();
        }else if(mode==='winter'){
            // 四角冰窗花：整簇冰晶随 frostBloomEnvelope 完整「生长出现→绽放→消散→消失」，四角相位错开；
            // 出现与消失都按每段的 grow 顺序逐段推进——出现时从角落沿冰针一点一点长出来，
            // 消失时从针梢向角落一点一点退去。实拍参照：贴边亮带打底 + 角部核心辉光，
            // 大量羽状冰针以柔光/冰晶/高亮三层描边堆出蓬松发光感，冰粒在缝隙间闪烁。
            const reach=Math.max(28,Math.min(W,H)*.3),edge=.07;
            c.lineCap='round';
            // 逐段生长/消融描边：已长成的段落合并一次 stroke，前沿的一段段单独渐显（生长）或渐隐（消融），
            // 枝头随 reveal 缓缓蔓延/退却，而不是整簇缩放或整体明暗变化。
            const strokeGrown=(buckets,reveal,strokeStyle,alphaByBucket,widthByBucket)=>{
                c.strokeStyle=strokeStyle;
                for(let b=0;b<4;b++){
                    const list=buckets[b];if(!list.length)continue;
                    const full=[],front=[];
                    for(const sg of list){if(sg.grow<=reveal-edge)full.push(sg);else if(sg.grow<reveal)front.push(sg)}
                    if(full.length){c.globalAlpha=alphaByBucket[b];c.lineWidth=widthByBucket[b];c.beginPath();for(const sg of full){c.moveTo(sg.x1,sg.y1);c.lineTo(sg.x2,sg.y2)}c.stroke()}
                    for(const sg of front){const k=clamp((reveal-sg.grow)/edge,0,1);if(k<=0)continue;c.globalAlpha=alphaByBucket[b]*k;c.lineWidth=widthByBucket[b];c.beginPath();c.moveTo(sg.x1,sg.y1);c.lineTo(sg.x2,sg.y2);c.stroke()}
                }
            };
            for(let corner=0;corner<4;corner++){
                const phase=corner*.27,env=frostBloomEnvelope(this.age,phase,FROST_BLOOM_PERIOD);
                if(env<=.004)continue;
                const t=((this.age/FROST_BLOOM_PERIOD+phase)%1+1)%1;
                const reveal=t<.22?smoothstep(0,.22,t):(t<.5?1:(t<.72?1-smoothstep(.5,.72,t):0));
                c.save();cornerTransform(c,corner,W,H);
                c.globalAlpha=env*.5;c.fillStyle=this.paint.wash?.[corner]||'rgba(226,247,255,.34)';c.fillRect(0,0,reach,reach);
                c.globalAlpha=env*.55;c.fillStyle=this.paint.core?.[corner]||'rgba(242,251,255,.4)';c.fillRect(0,0,reach*.62,reach*.62);
                if(this.paint.rim?.[corner]){
                    c.save();c.scale(1,.3);c.globalAlpha=env*.48;c.fillStyle=this.paint.rim[corner];c.fillRect(0,0,reach*1.15,reach*1.15);c.restore();
                    c.save();c.scale(.3,1);c.globalAlpha=env*.48;c.fillStyle=this.paint.rim[corner];c.fillRect(0,0,reach*1.15,reach*1.15);c.restore();
                }
                const frost=this.paint.frost?.[corner];
                if(frost){
                    const buckets=[[],[],[],[]];
                    for(const sg of frost.segs){const b=sg.w<.4?0:sg.w<.75?1:sg.w<1.15?2:3;buckets[b].push(sg)}
                    // 柔光层：宽幅淡青，把成百根冰针晕成整片发光冰晶带
                    strokeGrown(buckets,reveal,'#b8e0fc',[.07,.1,.13,.17],[3.4,4.4,5.6,6.8]);
                    // 冰晶层：中宽冰蓝主体
                    strokeGrown(buckets,reveal,'#d8f1ff',[.24,.34,.44,.54],[.55,.85,1.2,1.6]);
                    // 高亮层：纤细亮白结晶线
                    strokeGrown(buckets,reveal,'#ffffff',[.4,.5,.6,.68],[.26,.4,.55,.72]);
                    // 冰粒：细碎霜花点，独立相位微闪，随生长前沿逐粒点亮、随消融前沿逐粒隐去
                    c.fillStyle='#ffffff';
                    for(const d of frost.dots){
                        const k=clamp((reveal-d.grow)/edge,0,1);if(k<=0)continue;
                        c.globalAlpha=(.3+.4*(.5+.5*Math.sin(this.age*1.3+d.phase)))*k;
                        c.beginPath();c.arc(d.x,d.y,d.r,0,TAU);c.fill();
                    }
                }
                c.restore();
            }
            c.globalAlpha=1;
        }else if(mode==='laba'){
            // 角落磨砂水雾（对照实拍雾窗重做）：角部核心浓雾 + 4 团错落薄雾叠成整面磨砂，
            // 细密微珠分两种明暗批量铺底，中大水珠带底部微影、左上高光与微弯下淌尾痕；
            // 每个角按 labaMistEnvelope 缓慢「出现→消失→再出现」，四角相位错开，呼吸微动叠加其上。
            const breath=.72+.16*Math.sin(this.age*.24),reach=Math.max(40,Math.min(W,H)*.46);
            for(let corner=0;corner<4;corner++){
                const env=labaMistEnvelope(this.age,corner*.17);
                if(env<=.004)continue;
                c.save();cornerTransform(c,corner,W,H);
                for(const bl of this.paint.mist?.[corner]||[]){c.globalAlpha=breath*env;c.fillStyle=bl.g;c.fillRect(bl.x-bl.r,bl.y-bl.r,bl.r*2,bl.r*2)}
                const paint=this.paint.drops?.[corner];
                if(paint){
                    // 细密微珠：两种明暗各合并成一次填充，铺出雾面凝结颗粒感
                    for(let shade=0;shade<2;shade++){
                        c.globalAlpha=breath*env*(shade?.66:.36);c.fillStyle='rgba(244,248,253,.9)';
                        c.beginPath();
                        for(const m of paint.micro){if(m.shade!==shade)continue;c.moveTo(m.x+m.r*m.el,m.y);c.ellipse(m.x,m.y,m.r*m.el,m.r,0,0,TAU)}
                        c.fill();
                    }
                    // 中大水珠：底部微影增加立体感 + 主体 + 左上高光；挂尾痕的先画渐细水线
                    for(const d of paint.falls){
                        if(d.streak>0){
                            c.globalAlpha=breath*env*.3;c.strokeStyle='rgba(238,245,251,.8)';c.lineWidth=Math.max(.6,d.r*.42);
                            c.beginPath();c.moveTo(d.x+d.wob,d.y+d.r*.4);c.lineTo(d.x+d.wob*2,d.y+d.dir*d.streak);c.stroke();
                            c.globalAlpha=breath*env*.16;c.lineWidth=Math.max(.4,d.r*.2);
                            c.beginPath();c.moveTo(d.x+d.wob*2,d.y+d.dir*d.streak*.5);c.lineTo(d.x+d.wob*2.6,d.y+d.dir*d.streak);c.stroke();
                        }
                        c.globalAlpha=breath*env*.2;c.fillStyle='rgba(186,201,214,.8)';
                        c.beginPath();c.ellipse(d.x+d.r*.16,d.y+d.r*.2,d.r,d.r*d.el,0,0,TAU);c.fill();
                        c.globalAlpha=breath*env*.62;c.fillStyle='rgba(240,246,252,.95)';
                        c.beginPath();c.ellipse(d.x,d.y,d.r,d.r*d.el,0,0,TAU);c.fill();
                        c.globalAlpha=breath*env*.34;c.fillStyle='#fff';
                        c.beginPath();c.ellipse(d.x-d.r*.32,d.y-d.r*.3*d.el,d.r*.38,d.r*.38*d.el,0,0,TAU);c.fill();
                    }
                }
                c.globalAlpha=1;c.restore();
            }
        }
    }
    _drawParticle(c,p){
        const mode=this.theme.mode,base=p.alpha*(p.drawAlpha??1)*(this.reducedMotion?.62:1);if(base<.015)return;c.save();c.translate(p.x,p.y);c.rotate(p.rot||0);c.globalAlpha=base;c.lineWidth=1;
        const palette=this.theme.palette,color=palette[p.color%palette.length];
        switch(mode){
            case'snow':c.strokeStyle=color;c.fillStyle=color;if(p.variant)drawSnowflake(c,p.size);else{c.beginPath();c.arc(0,0,p.size,0,TAU);c.fill()}break;
            case'eve':c.fillStyle=color;c.fillRect(-p.size*.72,-p.size,p.size*1.44,p.size*2);break;
            case'spring':if(p.kind==='rocket'){c.strokeStyle='rgba(255,220,140,.9)';c.lineWidth=2;c.beginPath();c.moveTo(-p.vx*.03,-p.vy*.03);c.lineTo(0,0);c.stroke()}else if(p.kind==='spark'){c.globalCompositeOperation='lighter';c.fillStyle=p.springColor||color;c.beginPath();c.arc(0,0,p.size*(p.drawAlpha||0)+.6,0,TAU);c.fill()}break;
            case'lantern':drawLantern(c,p.size,this.quality);break;
            case'dragon':c.globalCompositeOperation='lighter';c.fillStyle=color;c.beginPath();if(p.variant)drawStar(c,p.size,.42,4);else c.arc(0,0,p.size,0,TAU);c.fill();break;
            case'qingming':case'dragonBoat':case'doubleNinth':c.fillStyle=color;c.strokeStyle=mode==='doubleNinth'?'rgba(115,70,25,.52)':'rgba(35,82,49,.5)';drawLeaf(c,p.size);break;
            case'labor':c.globalCompositeOperation='lighter';c.fillStyle=color;if(p.variant){drawStar(c,p.size,.45,4);c.fill()}else{c.beginPath();c.arc(0,0,p.size,0,TAU);c.fill()}break;
            case'qixi':c.fillStyle=p.variant?'#ba8eff':'#ff9ec7';c.shadowColor=c.fillStyle;c.shadowBlur=this.quality==='low'?0:4;drawHeart(c,p.size);c.fill();c.shadowBlur=0;c.globalAlpha*=.38;c.fillStyle='#fff';c.beginPath();c.ellipse(-p.size*.2,-p.size*.25,p.size*.12,p.size*.2,-.45,0,TAU);c.fill();break;
            case'zhongyuan':c.fillStyle=color;drawGhostFlame(c,p.size,this.quality);break;
            case'midAutumn':c.fillStyle=color;drawStar(c,p.size,p.variant?.4:.5,p.variant?4:5);c.fill();break;
            case'national':if(p.variant===0){
                // 常驻星星：缓慢自转 + 脉冲辉光 + 随相位亮起的十字星芒，呈现真实星光闪烁的动效。
                const pulse=.5+.5*Math.sin(this.age*1.6+p.phase);
                const glint=Math.max(0,Math.sin(this.age*2.2+p.spin));
                c.globalCompositeOperation='lighter';c.fillStyle=color;c.globalAlpha=base*.4*pulse;
                c.beginPath();c.arc(0,0,p.size*1.9,0,TAU);c.fill();
                if(glint>.25){c.globalAlpha=base*.75*glint;c.fillStyle='#fff';
                    c.beginPath();c.moveTo(0,-p.size*2.7);c.lineTo(p.size*.32,0);c.lineTo(0,p.size*2.7);c.lineTo(-p.size*.32,0);c.closePath();c.fill();
                    c.beginPath();c.moveTo(-p.size*2.7,0);c.lineTo(0,p.size*.32);c.lineTo(p.size*2.7,0);c.lineTo(0,-p.size*.32);c.closePath();c.fill()}
                c.globalCompositeOperation='source-over';c.globalAlpha=base;c.fillStyle=color;
                drawStar(c,p.size*(1+pulse*.22),.44,5);c.fill()
            }else{c.globalCompositeOperation='lighter';c.fillStyle=color;c.beginPath();c.arc(0,0,p.size*(.65+(p.drawAlpha||0)),0,TAU);c.fill()}break;
            case'winter':{const glint=.5+.5*Math.sin(this.age*1.7+p.phase);c.globalCompositeOperation='lighter';c.fillStyle='#fff';c.globalAlpha=base*(.3+.7*glint);c.save();c.rotate(p.phase);c.beginPath();c.moveTo(0,-p.size);c.lineTo(p.size*.18,0);c.lineTo(0,p.size);c.lineTo(-p.size*.18,0);c.closePath();c.fill();c.beginPath();c.moveTo(-p.size,0);c.lineTo(0,p.size*.18);c.lineTo(p.size,0);c.lineTo(0,-p.size*.18);c.closePath();c.fill();c.restore();break}
            case'laba':{c.fillStyle='rgba(242,247,252,.95)';c.beginPath();c.ellipse(0,0,p.size*.42,p.size*.5,0,0,TAU);c.fill();c.globalAlpha=base*.6;c.fillStyle='#fff';c.beginPath();c.ellipse(-p.size*.12,-p.size*.14,p.size*.16,p.size*.2,0,0,TAU);c.fill();break}
            case'xiaonian':{const tw=.55+Math.abs(Math.sin(this.age*3.2+p.phase))*.45;c.globalCompositeOperation='lighter';c.fillStyle=color;c.globalAlpha*=tw*.28;c.beginPath();c.arc(0,0,p.size*2.4,0,TAU);c.fill();c.globalAlpha=base*tw;c.beginPath();c.arc(0,0,p.size,0,TAU);c.fill();break}
        }
        c.restore();
    }
}

export function createFestivalScreenFx(options={}){return new FestivalScreenFx(options)}
