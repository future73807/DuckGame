// 节日屏幕特效正式回归：主题契约、单画布生命周期、分层覆盖、运动方向与节能档位。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');
const EXPECTED_IDS=[
    'festival_new_year','festival_eve','festival_spring','festival_lantern',
    'festival_dragon_heads','festival_qingming','festival_labor','festival_dragon_boat',
    'festival_qixi','festival_zhongyuan','festival_mid_autumn','festival_double_ninth',
    'festival_national_day','festival_winter_solstice','festival_laba','festival_xiaonian'
];

async function loadFestivalFx(){
    // 项目服务端保持 CommonJS；data URL 直接执行浏览器 ESM 源码，不复制生产算法。
    const source=fs.readFileSync(path.join(ROOT,'js/render/festival-screen-fx.js'),'utf8');
    return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}

class MockGradient{
    constructor(kind,args){this.kind=kind;this.args=args;this.stops=[]}
    addColorStop(offset,color){this.stops.push([offset,color])}
}

class MockContext2D{
    constructor(){this.ops=[];this._globalAlpha=1}
    set globalAlpha(value){this._globalAlpha=value;this.record('globalAlpha',[value])}
    get globalAlpha(){return this._globalAlpha}
    record(type,args=[]){this.ops.push({type,args:Array.from(args)})}
    resetOps(){this.ops.length=0}
    count(type){return this.ops.filter(op=>op.type===type).length}
    setTransform(...args){this.record('setTransform',args)}
    clearRect(...args){this.record('clearRect',args)}
    fillRect(...args){this.record('fillRect',args)}
    strokeRect(...args){this.record('strokeRect',args)}
    beginPath(){this.record('beginPath')}
    closePath(){this.record('closePath')}
    moveTo(...args){this.record('moveTo',args)}
    lineTo(...args){this.record('lineTo',args)}
    arc(...args){this.record('arc',args)}
    ellipse(...args){this.record('ellipse',args)}
    arcTo(...args){this.record('arcTo',args)}
    bezierCurveTo(...args){this.record('bezierCurveTo',args)}
    quadraticCurveTo(...args){this.record('quadraticCurveTo',args)}
    fill(){this.record('fill')}
    stroke(){this.record('stroke')}
    save(){this.record('save')}
    restore(){this.record('restore')}
    translate(...args){this.record('translate',args)}
    rotate(...args){this.record('rotate',args)}
    scale(...args){this.record('scale',args)}
    createRadialGradient(...args){this.record('createRadialGradient',args);return new MockGradient('radial',args)}
    createLinearGradient(...args){this.record('createLinearGradient',args);return new MockGradient('linear',args)}
    drawImage(...args){this.record('drawImage',args)}
}

class MockDocument{
    constructor(){
        this.created=[];
        const children=[];
        this.body={
            children,
            appendChild:canvas=>{
                if(!children.includes(canvas))children.push(canvas);
                canvas.parentNode=this.body;
                return canvas;
            },
            removeChild:canvas=>{
                const index=children.indexOf(canvas);
                if(index>=0)children.splice(index,1);
                canvas.parentNode=null;
                return canvas;
            }
        };
    }
    createElement(tag){
        assert.equal(tag,'canvas','节日特效只能创建 Canvas surface');
        const ctx=new MockContext2D(),document=this;
        const canvas={
            className:'',dataset:{},style:{},width:0,height:0,parentNode:null,ctx,removeCount:0,
            getContext(type){assert.equal(type,'2d');return ctx},
            remove(){this.removeCount++;if(this.parentNode)document.body.removeChild(this)}
        };
        this.created.push(canvas);
        return canvas;
    }
}

function makeHarness(mod,options={}){
    const document=new MockDocument();
    const window={innerWidth:1280,innerHeight:720,devicePixelRatio:1};
    const fx=mod.createFestivalScreenFx({document,window,quality:'high',...options});
    return{document,window,fx};
}

function assertCoverage(fx,message){
    const state=fx.getDebugState(),coverage=state.coverage,snapshot=fx.getParticleSnapshot();
    assert.ok(coverage.max-coverage.min<=1,`${message}: coverage max-min=${coverage.max-coverage.min}`);
    assert.equal(coverage.occupied,state.particleCount,`${message}: 每个粒子必须占用独立分层单元`);
    assert.equal(new Set(snapshot.map(p=>p.cell)).size,state.particleCount,`${message}: cell 不得重复`);
}

function advanceFrames(fx,frames,onFrame){
    for(let frame=0;frame<frames;frame++){
        fx.update(1/60);
        if(onFrame)onFrame(frame,fx.getParticleSnapshot(),fx.getDebugState());
        fx.canvas?.ctx?.resetOps();
    }
}

function liveGridStats(fx,{filter=()=>true,alpha=.05,cols=4,rows=3}={}){
    const state=fx.getDebugState(),W=state.width,H=state.height,bins=new Array(cols*rows).fill(0),quadrants=[0,0,0,0];let center=0;
    const visible=fx.getParticleSnapshot().filter(p=>filter(p)&&(p.drawAlpha??1)>alpha&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<W&&p.y>=0&&p.y<H);
    for(const p of visible){
        const col=Math.min(cols-1,Math.floor(p.x/W*cols)),row=Math.min(rows-1,Math.floor(p.y/H*rows));bins[row*cols+col]++;
        quadrants[(p.y>=H/2?2:0)+(p.x>=W/2?1:0)]++;
        if(p.x>W*.33&&p.x<W*.67&&p.y>H*.3&&p.y<H*.62)center++;
    }
    return{visible:visible.length,bins,occupied:bins.filter(Boolean).length,quadrants,center};
}

function assertLiveCoverage(fx,message,{filter,minVisible,minOccupied=9,requireCenter=true}={}){
    const stats=liveGridStats(fx,{filter});
    assert.ok(stats.visible>=minVisible,`${message}: 屏内可见粒子仅 ${stats.visible}`);
    assert.ok(stats.occupied>=minOccupied,`${message}: 当前坐标只覆盖 ${stats.occupied}/12 个区域 (${stats.bins.join(',')})`);
    assert.ok(stats.quadrants.every(Boolean),`${message}: 四象限分布不完整 (${stats.quadrants.join(',')})`);
    if(requireCenter)assert.ok(stats.center>0,`${message}: 中央区域没有粒子`);
    return stats;
}

function assertCornerGroups(fx,id,width,height){
    assert.equal(fx.start(id,{deferIntro:true}),true);
    const groups=[0,0,0,0];
    for(const p of fx.pool.slice(0,fx.activeCount)){
        assert.ok(Number.isInteger(p.corner)&&p.corner>=0&&p.corner<4,`${id}: 缺少有效 corner 分组`);
        groups[p.corner]++;
        const expectedRight=p.corner%2===1,expectedBottom=p.corner>1;
        assert.equal(p.x>width/2,expectedRight,`${id}: 粒子未留在指定左右角`);
        assert.equal(p.y>height/2,expectedBottom,`${id}: 粒子未留在指定上下角`);
    }
    assert.deepEqual(new Set(groups).size,1,`${id}: 四角数量必须相等`);
    assert.ok(groups.every(count=>count>0),`${id}: 四角均须有粒子`);
}

function parseHex(hex){
    assert.match(hex,/^#[0-9a-f]{6}$/i,`非法主题颜色 ${hex}`);
    return[1,3,5].map(start=>Number.parseInt(hex.slice(start,start+2),16));
}

async function main(){
    const mod=await loadFestivalFx();
    const themes=mod.FESTIVAL_SCREEN_FX_THEMES,ids=mod.FESTIVAL_SCREEN_FX_IDS;

    // 16 套主题必须完整、顺序稳定，主题 id/name/mode 不能重复或串线。
    assert.deepEqual([...ids],EXPECTED_IDS,'节日主题 ID 集合或顺序发生遗漏');
    assert.equal(ids.length,16);
    assert.equal(new Set(ids).size,16,'节日主题 ID 必须唯一');
    assert.deepEqual(Object.keys(themes),EXPECTED_IDS);
    assert.equal(new Set(ids.map(id=>themes[id].id)).size,16,'主题内部 id 必须唯一');
    assert.equal(new Set(ids.map(id=>themes[id].theme)).size,16,'主题名称必须唯一');
    assert.equal(new Set(ids.map(id=>themes[id].mode)).size,16,'主题 mode 必须唯一');
    for(const id of ids){
        const theme=themes[id];
        assert.equal(theme.id,id,`${id}: 内部 id 不一致`);
        assert.ok(theme.label&&theme.palette.length>0,`${id}: 标签或调色板缺失`);
        for(const quality of['low','mid','high'])assert.ok(Number.isInteger(theme.quality[quality])&&theme.quality[quality]>0,`${id}: ${quality} 预算非法`);
    }

    // 连续切换 16 个主题必须复用同一个 surface；主题切换不得堆叠 Canvas。
    {
        const{document,fx}=makeHarness(mod);let firstCanvas=null;
        for(const id of ids){
            assert.equal(fx.start(id,{deferIntro:true}),true,`${id}: 启动失败`);
            firstCanvas??=fx.canvas;
            assert.strictEqual(fx.canvas,firstCanvas,`${id}: 切换主题时重新创建了 Canvas`);
            // 离屏烘焙画布不挂载 DOM，只统计真正挂载的 surface（保持"DOM 不堆叠画布"的契约本意）
            assert.equal(document.created.filter(cv=>cv.parentNode).length,1,`${id}: 创建了多份 surface`);
            assert.equal(document.body.children.length,1,`${id}: DOM 中存在多张节日 Canvas`);
            assert.equal(fx.getDebugState().surfaceCount,1);
            assert.equal(fx.canvas.dataset.festival,id);
        }
    }

    // 每档预算都须生效；减动效固定 5Hz、30% 粒子预算，并冻结粒子运动。
    {
        const{fx}=makeHarness(mod);
        for(const id of ids){
            fx.start(id,{deferIntro:true});
            for(const quality of['low','mid','high']){
                fx.setReducedMotion(false);fx.setQuality(quality);
                let state=fx.getDebugState();
                assert.equal(state.particleBudget,themes[id].quality[quality],`${id}/${quality}: 预算值错误`);
                assert.equal(state.particleCount,themes[id].quality[quality],`${id}/${quality}: 实际粒子数错误`);
                fx.setReducedMotion(true);state=fx.getDebugState();
                assert.equal(state.particleCount,Math.max(2,Math.floor(themes[id].quality[quality]*.3)),`${id}/${quality}: 减动效预算错误`);
                assert.equal(state.updateHz,5,`${id}/${quality}: 减动效必须为 5Hz`);
                assert.equal(state.motionScale,0,`${id}/${quality}: 减动效下粒子不得运动`);
            }
        }
        fx.start('festival_new_year',{deferIntro:true});fx.setQuality('high');fx.setReducedMotion(true);
        const beforeDraw=fx.getDebugState().drawCount,beforeParticles=fx.getParticleSnapshot();
        for(let i=0;i<4;i++)fx.update(.04);
        assert.equal(fx.getDebugState().drawCount,beforeDraw,'5Hz 到期前不应重绘');
        fx.update(.04);
        assert.equal(fx.getDebugState().drawCount,beforeDraw+1,'5Hz 到期时应恰好重绘一次');
        assert.deepEqual(fx.getParticleSnapshot(),beforeParticles,'减动效刷新不得推进粒子位置');
    }

    // 即使调用者传入旧避让回调，生产模块也不得读取它们，debug 始终报告 0。
    {
        let staticCalls=0,dynamicCalls=0;
        const{fx}=makeHarness(mod,{
            getAvoidRects:()=>{staticCalls++;return[{left:0,top:0,width:1280,height:720}]},
            getDynamicAvoidRects:()=>{dynamicCalls++;return[{left:0,top:0,width:1280,height:720}]}
        });
        for(const id of ids){fx.start(id,{deferIntro:true});fx.update(.1);assert.equal(fx.getDebugState().avoidRectCount,0,`${id}: 不得产生避让区域`)}
        assert.equal(staticCalls,0,'不得读取静态 UI 避让区域');
        assert.equal(dynamicCalls,0,'不得读取鸭子/名牌避让区域');
    }

    // 横屏和竖屏均须重新分层；每个已用 cell 的占用差不得超过 1。
    {
        const{fx}=makeHarness(mod);
        for(const[width,height]of[[1280,720],[720,1280]]){
            for(const id of ids){
                fx.start(id,{deferIntro:true});
                assert.equal(fx.resize(width,height,2),true);
                const state=fx.getDebugState();
                assert.equal(state.width,width);assert.equal(state.height,height);
                assertCoverage(fx,`${id}/${width}x${height}`);
                for(const p of fx.getParticleSnapshot()){
                    assert.ok(Number.isFinite(p.homeX)&&Number.isFinite(p.homeY),`${id}: resize 后坐标非法`);
                }
            }
        }
    }

    // 均匀性必须看粒子的当前坐标，而不是永远不变的 cell 标签；持续运动/重生 30 秒后也不能挖空中央或某个象限。
    {
        const fullScreenIds=[
            'festival_new_year','festival_eve','festival_lantern','festival_dragon_heads','festival_qingming','festival_labor',
            'festival_dragon_boat','festival_qixi','festival_mid_autumn','festival_double_ninth','festival_xiaonian'
        ];
        for(const id of fullScreenIds){
            const{fx}=makeHarness(mod);fx.start(id,{deferIntro:true});let elapsed=0;
            for(const target of[0,5,15,30]){
                advanceFrames(fx,Math.round((target-elapsed)*60));elapsed=target;
                const minVisible=Math.max(8,Math.floor(fx.getDebugState().particleCount*.7));
                assertLiveCoverage(fx,`${id}/${target}s`,{minVisible});
            }
        }
    }

    // 低/中档与竖屏同样是正式路径：连续 30 秒流动必须保持全屏覆盖，中央不能长期空缺。
    // 凌乱版速度差异会让粒子在 30 秒内充分错相，允许个别采样瞬间一个象限稀疏，但每帧至少覆盖两个象限，
    // 且绝大多数采样（≥46/61）四个象限齐全——既保证不挖空，也不再把粒子锁回整齐网格。
    {
        const fullScreenIds=[
            'festival_new_year','festival_eve','festival_lantern','festival_dragon_heads','festival_qingming','festival_labor',
            'festival_dragon_boat','festival_qixi','festival_zhongyuan','festival_mid_autumn','festival_double_ninth','festival_national_day','festival_xiaonian'
        ];
        const{fx}=makeHarness(mod);
        for(const quality of['low','mid'])for(const[width,height]of[[1280,720],[720,1280]])for(const id of fullScreenIds){
            fx.start(id,{deferIntro:true});fx.setQuality(quality);fx.resize(width,height,1);let centerSamples=0,fullQuadrantSamples=0;
            for(let sample=0;sample<=60;sample++){
                if(sample)advanceFrames(fx,30);
                const stats=liveGridStats(fx);
                const filled=stats.quadrants.filter(Boolean).length;
                assert.ok(filled>=2,`${id}/${quality}/${width}x${height}/${sample*.5}s 两个以上象限空缺 (${stats.quadrants.join(',')})`);
                if(filled===4)fullQuadrantSamples++;
                if(stats.center>0)centerSamples++;
            }
            // 稀疏低档（最少 12 粒）不应被强迫每帧占据中央；超过半数采样命中即可排除人为挖空，同时保留自然流动间隙。
            assert.ok(fullQuadrantSamples>=46,`${id}/${quality}/${width}x${height} 四象限齐全采样过少: ${fullQuadrantSamples}/61`);
            assert.ok(centerSamples>=31,`${id}/${quality}/${width}x${height} 中央区域长期空缺: ${centerSamples}/61`);
        }
    }

    // 除夕只允许黄色矩形纸片：无圆点 variant，实际绘制也只能走 fillRect。
    {
        const{fx}=makeHarness(mod);fx.start('festival_eve',{deferIntro:true});
        const snapshot=fx.getParticleSnapshot(),ctx=fx.canvas.ctx;
        assert.ok(snapshot.every(p=>p.mode==='eve'&&p.variant===0),'除夕粒子必须全部使用矩形模式数据');
        assert.equal(ctx.count('fillRect'),snapshot.length,'每个除夕粒子应绘制一个矩形');
        assert.equal(ctx.count('arc'),0,'除夕不得绘制圆点');
        assert.equal(ctx.count('ellipse'),0,'除夕不得绘制椭圆点');
    }

    // 春节高档忠实恢复旧版节奏：延迟开场前完全静默，随后 9 秒按 0.42–0.82s 发射并产生 42/56 粒爆发。
    {
        const{document,fx}=makeHarness(mod);fx.start('festival_spring',{deferIntro:true});
        advanceFrames(fx,180);
        let spring=fx.getDebugState().spring;
        assert.equal(spring.launches,0,'deferIntro 期间不得偷跑春节烟花');
        assert.equal(spring.visible,0,'deferIntro 期间不得残留春节粒子');
        assert.equal(fx.playIntro(),true,'春节开场应可显式启动');
        let minSustained=Infinity;
        advanceFrames(fx,15*60,(frame,_snapshot,state)=>{
            const seconds=(frame+1)/60;
            if(seconds>=2.5&&seconds<=9)minSustained=Math.min(minSustained,state.spring.visible);
        });
        spring=fx.getDebugState().spring;
        assert.ok(spring.launches>=12&&spring.launches<=22,`春节 9 秒发射次数异常: ${spring.launches}`);
        assert.equal(spring.bursts,spring.launches,'所有春节火箭最终都必须爆开');
        assert.ok(spring.goldenBursts>0&&spring.goldenBursts<spring.bursts,'春节必须同时包含金色和红色爆发');
        assert.ok(spring.burstSizes.every(size=>size===42||size===56),`高档爆发粒数必须为 42/56: ${spring.burstSizes.join(',')}`);
        assert.ok(spring.burstSizes.includes(42)&&spring.burstSizes.includes(56),'高档必须同时覆盖普通42粒与金色56粒');
        assert.equal(spring.droppedSparks,0,'高档对象池不得丢弃爆炸火花');
        assert.equal(spring.droppedRockets,0,'高档对象池不得丢弃火箭');
        assert.ok(spring.maxVisible>=100,`春节峰值密度不足: ${spring.maxVisible}`);
        assert.ok(minSustained>=42,`春节持续段出现明显空窗，最低仅 ${minSustained} 粒`);
        assert.equal(spring.launchTimes[0],0,'第一枚火箭应随开场立即升空');
        assert.ok(spring.launchTimes.at(-1)<=9,'9 秒后不得继续发射新火箭');
        for(let i=1;i<spring.launchTimes.length;i++){
            const interval=spring.launchTimes[i]-spring.launchTimes[i-1];
            assert.ok(interval>=.4199&&interval<=.8201,`春节火箭间隔越界: ${interval}`);
        }
        const launches=spring.launches;advanceFrames(fx,120);spring=fx.getDebugState().spring;
        assert.equal(spring.launches,launches,'春节约9秒后不得再次启动新一轮');
        assert.equal(spring.visible,0,'春节尾部粒子应自然回收到对象池');
        assert.equal(document.created.filter(cv=>cv.parentNode).length,1,"春节全程只能使用同一张 Canvas");
        assert.equal(fx.getDebugState().poolSize,themes.festival_spring.quality.high,'春节对象池大小必须受高档预算约束');
    }

    // 减动效必须拦住春节开场；恢复动效后显式播放仍能正常启动，且低档沿用同一生命周期但缩小预算。
    {
        const{fx}=makeHarness(mod);fx.start('festival_spring',{deferIntro:true});fx.setReducedMotion(true);
        assert.equal(fx.playIntro(),false,'减动效下不得启动春节爆发');advanceFrames(fx,120);assert.equal(fx.getDebugState().spring.launches,0);
        fx.setReducedMotion(false);fx.setQuality('low');assert.equal(fx.playIntro(),true);advanceFrames(fx,5*60);
        const state=fx.getDebugState();assert.equal(state.particleCount,themes.festival_spring.quality.low);assert.ok(state.spring.bursts>0);assert.equal(state.spring.droppedSparks,0);
        assert.ok(state.spring.burstSizes.every(size=>size<42),'低档必须缩小爆发预算');
    }

    // 春节播放中开启减动效属于主动取消：直接 setter 与动态 getter 都必须清空在途对象及整套事件统计，恢复后不得偷偷续播。
    {
        const assertCancelled=(fx,label)=>{
            const state=fx.getDebugState(),spring=state.spring;
            assert.equal(state.reducedMotion,true,`${label}: 未进入减动效`);
            assert.equal(state.particleCount,Math.floor(themes.festival_spring.quality.high*.3),`${label}: 减动效预算错误`);
            assert.equal(spring.launches,0,`${label}: 取消后仍保留 launch 统计`);
            assert.equal(spring.bursts,0,`${label}: 取消后仍保留 burst 统计`);
            assert.equal(spring.goldenBursts,0,`${label}: 取消后仍保留 golden burst 统计`);
            assert.equal(spring.visible,0,`${label}: 取消后仍有可见烟花`);
            assert.equal(spring.droppedRockets,0,`${label}: 取消不应记为丢火箭`);
            assert.equal(spring.droppedSparks,0,`${label}: 取消不应记为丢火花`);
        };
        {
            const{fx}=makeHarness(mod);fx.start('festival_spring');advanceFrames(fx,60);
            const before=fx.getDebugState().spring;assert.ok(before.launches>=2&&before.bursts<before.launches,'setter 切换前必须存在在途火箭');
            fx.setReducedMotion(true);assertCancelled(fx,'setReducedMotion(true)');advanceFrames(fx,120);assertCancelled(fx,'setReducedMotion(true)/冻结后');
            fx.setReducedMotion(false);advanceFrames(fx,120);assert.equal(fx.getDebugState().spring.launches,0,'setter 恢复动效后不得自动续播已取消烟花');
            assert.equal(fx.playIntro(),true,'setter 恢复动效后应允许显式重播');advanceFrames(fx,180);assert.ok(fx.getDebugState().spring.bursts>0,'setter 恢复后显式重播未生效');
        }
        {
            let effectiveReduced=false;const{fx}=makeHarness(mod,{getReducedMotion:()=>effectiveReduced});fx.start('festival_spring');advanceFrames(fx,60);
            const before=fx.getDebugState().spring;assert.ok(before.launches>=2&&before.bursts<before.launches,'getter 切换前必须存在在途火箭');
            effectiveReduced=true;fx.update(1/60);assertCancelled(fx,'getReducedMotion()=true');advanceFrames(fx,120);assertCancelled(fx,'getReducedMotion()=true/冻结后');
            effectiveReduced=false;fx.update(1/60);advanceFrames(fx,120);assert.equal(fx.getDebugState().spring.launches,0,'getter 恢复动效后不得自动续播已取消烟花');
        }
    }

    // 春节对象池高位不能跨主题泄漏：春节运行→低预算七夕→延迟春节，必须在 playIntro 前保持完全静默。
    {
        const{fx}=makeHarness(mod);fx.start('festival_spring');advanceFrames(fx,140);
        const lowBudget=themes.festival_qixi.quality.high,activeBefore=fx.getParticleSnapshot().filter(p=>p.kind==='rocket'||p.kind==='spark');
        assert.ok(activeBefore.some(p=>p.index>=lowBudget),'复现前提不足：春节高位对象池中没有在途粒子');
        fx.start('festival_qixi',{deferIntro:true});assert.equal(fx.getDebugState().particleCount,lowBudget,'七夕预算未缩小对象池活动范围');
        fx.start('festival_spring',{deferIntro:true});
        const state=fx.getDebugState(),snapshot=fx.getParticleSnapshot();
        assert.equal(state.introPending,true,'返回春节后应保持延迟开场');
        assert.equal(state.spring.launches,0,'返回春节后不得继承旧 launch 统计');
        assert.equal(state.spring.bursts,0,'返回春节后不得继承旧 burst 统计');
        assert.equal(state.spring.visible,0,'返回春节后不得显示旧烟花');
        assert.ok(snapshot.every(p=>p.kind==='inactive'),'返回春节后对象池仍残留旧 rocket/spark');
    }

    // 春节在途火箭遇到手动降档、自动 restricted 或 resize 时必须继续完成，不能被池重排静默吞掉。
    {
        const finishTransition=(fx,label)=>{
            advanceFrames(fx,22*60);const state=fx.getDebugState();
            assert.ok(state.spring.launches>2,`${label}: 切换后未继续发射`);
            assert.equal(state.spring.bursts,state.spring.launches,`${label}: 在途火箭没有全部爆开`);
            assert.equal(state.spring.droppedRockets,0,`${label}: 丢弃了火箭`);
            assert.equal(state.spring.droppedSparks,0,`${label}: 丢弃了爆炸火花`);
            assert.equal(state.spring.visible,0,`${label}: 尾部粒子未回收到对象池`);
        };
        {
            const{fx}=makeHarness(mod);fx.start('festival_spring');advanceFrames(fx,60);
            const before=fx.getDebugState().spring;assert.ok(before.launches>=2&&before.bursts<before.launches,'手动降档前必须存在在途火箭');
            fx.setQuality('low');finishTransition(fx,'high→low');assert.equal(fx.getDebugState().particleCount,themes.festival_spring.quality.low);
        }
        {
            const{fx}=makeHarness(mod);fx.start('festival_spring');advanceFrames(fx,60);
            const before=fx.getDebugState().spring;assert.ok(before.launches>=2&&before.bursts<before.launches,'resize 前必须存在在途火箭');
            fx.resize(720,1280,1);finishTransition(fx,'resize');
        }
        {
            let effective='high';const{fx}=makeHarness(mod,{getQuality:()=>effective});fx.start('festival_spring');advanceFrames(fx,60);
            const before=fx.getDebugState().spring;assert.ok(before.launches>=2&&before.bursts<before.launches,'restricted 前必须存在在途火箭');
            effective='restricted';fx.update(1/60);assert.equal(fx.getDebugState().quality,'low','restricted 必须映射到低档');finishTransition(fx,'automatic restricted');
        }
    }

    // 减动效需冻结统一时间源：冬至背景结冰与小年粒子亮度不得在 5Hz 重绘间继续变化。
    {
        for(const id of['festival_winter_solstice','festival_xiaonian']){
            const{fx}=makeHarness(mod);fx.start(id,{deferIntro:true});advanceFrames(fx,30);fx.setReducedMotion(true);
            const frozenAge=fx.age,ctx=fx.canvas.ctx,drawTrace=()=>{
                ctx.resetOps();for(let frame=0;frame<12;frame++)fx.update(1/60);
                return ctx.ops.filter(op=>op.type==='globalAlpha').map(op=>op.args[0]);
            };
            const first=drawTrace(),second=drawTrace();
            assert.equal(fx.age,frozenAge,`${id}: 减动效下 age 仍在推进`);
            assert.ok(first.length>0,`${id}: 未捕获到减动效重绘`);
            assert.deepEqual(second,first,`${id}: 减动效下背景或闪烁仍在变化`);
        }
    }

    // 元宵孔明灯只向上飞，摆角始终受限；不能持续累加自转。
    {
        const{fx}=makeHarness(mod);fx.start('festival_lantern',{deferIntro:true});
        for(let frame=0;frame<240;frame++){
            fx.update(1/60);
            for(const p of fx.getParticleSnapshot()){
                assert.ok(p.vy<0,'元宵孔明灯必须向上运动');
                assert.ok(Math.abs(p.rot)<=.2,`元宵孔明灯旋转过大: ${p.rot}`);
            }
        }
    }

    // 中元鬼火必须分批随机显隐：每一盏都有真正的全透明停顿，任一时刻仍保持均匀的屏幕覆盖。
    {
        const{fx}=makeHarness(mod);fx.start('festival_zhongyuan',{deferIntro:true});
        const count=fx.getDebugState().particleCount,seenHidden=new Set(),seenFull=new Set();let minVisible=Infinity,maxVisible=0;
        advanceFrames(fx,12*60,(frame,snapshot)=>{
            const visible=snapshot.filter(p=>p.drawAlpha>.05).length;minVisible=Math.min(minVisible,visible);maxVisible=Math.max(maxVisible,visible);
            for(const p of snapshot){
                assert.equal(p.vr,0,'中元鬼火不得持续自转');
                if(p.drawAlpha===0)seenHidden.add(p.index);
                if(p.drawAlpha>=.999)seenFull.add(p.index);
            }
            if((frame+1)%60===0)assertLiveCoverage(fx,`中元/${(frame+1)/60}s`,{minVisible:Math.floor(count*.5),minOccupied:8});
        });
        assert.equal(seenHidden.size,count,'每一盏中元鬼火都必须进入真正的零透明度停顿');
        assert.equal(seenFull.size,count,'每一盏中元鬼火都必须完整显现');
        assert.ok(minVisible>=Math.floor(count*.5),`中元鬼火同时可见数量过少: ${minVisible}/${count}`);
        assert.ok(maxVisible<=Math.ceil(count*.75),`中元鬼火同时可见数量过多，缺少随机消失层次: ${maxVisible}/${count}`);
    }

    // 七夕沿用粉紫心雨向下，小年沿用金粒向上。
    {
        const{fx}=makeHarness(mod);
        fx.start('festival_qixi',{deferIntro:true});let before=fx.getParticleSnapshot();fx.update(1/60);let after=fx.getParticleSnapshot();
        assert.ok(before.every(p=>p.vy>0),'七夕粒子速度必须向下');
        // 初始即凌乱的散点允许出生在底部环绕带内：首帧允许「越底环绕」之外的每颗粒子都必须向下推进。
        assert.ok(after.every((p,index)=>{const b=before[index];return p.y>b.y||(b.y>fx.height-1&&p.y<1)}),'七夕粒子实际位置必须向下推进');
        advanceFrames(fx,30*60,(_frame,snapshot)=>{
            assert.ok(snapshot.every(p=>p.vr===0),'七夕爱心不得持续自转');
            assert.ok(snapshot.every(p=>Math.abs(p.rot)<=.081),'七夕爱心倾角必须保持精致且克制');
        });
        fx.start('festival_xiaonian',{deferIntro:true});before=fx.getParticleSnapshot();fx.update(1/60);after=fx.getParticleSnapshot();
        assert.ok(before.every(p=>p.vy<0),'小年粒子速度必须向上');
        // 首帧允许「越顶环绕」；其余每颗粒子都必须向上推进。
        assert.ok(after.every((p,index)=>{const b=before[index];return p.y<b.y||(b.y<1&&p.y>fx.height-1)}),'小年粒子实际位置必须向上推进');
    }

    // 凌乱度契约：流动粒子不得整齐成列 —— 横向位置逐粒错开、纵向速度拉开差异（抽 10 套流动主题）。
    {
        const{fx}=makeHarness(mod);
        const flowIds=['festival_new_year','festival_eve','festival_lantern','festival_dragon_heads','festival_qingming','festival_labor','festival_dragon_boat','festival_qixi','festival_double_ninth','festival_xiaonian'];
        for(const id of flowIds){
            fx.start(id,{deferIntro:true});
            const snapshot=fx.getParticleSnapshot();
            assert.ok(new Set(snapshot.map(p=>p.vy.toFixed(2))).size>=Math.max(3,Math.floor(snapshot.length/3)),`${id}: 纵向速度过于整齐`);
            assert.ok(new Set(snapshot.map(p=>p.homeX.toFixed(1))).size>=Math.ceil(snapshot.length*.75),`${id}: 横向位置过于整齐`);
            assert.ok(new Set(snapshot.map(p=>p.homeY.toFixed(1))).size>=Math.ceil(snapshot.length*.8),`${id}: 初始纵向位置过于整齐`);
        }
    }

    // 冬至冰花与腊八雾气各自稳定分配到四个角，并真正经历消失→重新出现的完整周期；
    // 整簇冰花另按约 9 秒包络「生长出现→绽放→消散→消失」，腊八水雾按约 6 秒包络循环，四角相位均错开。
    {
        const{fx}=makeHarness(mod);
        for(const id of['festival_winter_solstice','festival_laba']){
            assertCornerGroups(fx,id,1280,720);
            const count=fx.getDebugState().particleCount,minAlpha=new Array(count).fill(1),maxAlpha=new Array(count).fill(0);
            advanceFrames(fx,20*60,(_frame,snapshot)=>{
                for(const p of snapshot){minAlpha[p.index]=Math.min(minAlpha[p.index],p.drawAlpha);maxAlpha[p.index]=Math.max(maxAlpha[p.index],p.drawAlpha)}
            });
            assert.ok(minAlpha.every(alpha=>alpha<.02),`${id}: 每个角落粒子都必须慢慢消失`);
            assert.ok(maxAlpha.every(alpha=>alpha>.98),`${id}: 每个角落粒子都必须重新完整出现`);
        }
        // 冬至冰花整簇：每个角在 45 秒内（约 3 个 14s 周期）都必须完整隐没、完整绽放，并保留真实隐藏停顿。
        for(const cornerPhase of[0,.27,.53,.8]){
            let min=1,max=0,hidden=0;
            for(let t=0;t<=45;t+=1/60){
                const env=mod.frostBloomEnvelope(t,cornerPhase);
                min=Math.min(min,env);max=Math.max(max,env);
                if(env<=.0001)hidden++;
            }
            assert.ok(min<=.0001,`冬至冰花(相位${cornerPhase})从未完全消失: ${min}`);
            assert.ok(max>=.999,`冬至冰花(相位${cornerPhase})从未完整出现: ${max}`);
            assert.ok(hidden>=90,`冬至冰花(相位${cornerPhase})隐藏停顿过短: ${hidden}帧`);
        }
        // 腊八水雾：每个角在 30 秒内（约 5 个 6s 周期）都必须完整隐没、完整出现，并保留隐藏停顿。
        for(const cornerPhase of[0,.17,.34,.51]){
            let min=1,max=0,hidden=0;
            for(let t=0;t<=30;t+=1/60){
                const env=mod.labaMistEnvelope(t,cornerPhase);
                min=Math.min(min,env);max=Math.max(max,env);
                if(env<=.0001)hidden++;
            }
            assert.ok(min<=.0001,`腊八水雾(相位${cornerPhase})从未完全消失: ${min}`);
            assert.ok(max>=.999,`腊八水雾(相位${cornerPhase})从未完整出现: ${max}`);
            assert.ok(hidden>=180,`腊八水雾(相位${cornerPhase})隐藏停顿过短: ${hidden}帧`);
        }
    }

    // 国庆礼花燃点：每 6 发（一轮约 20 秒）必须覆盖全部 6 个燃点各一次，不得连燃堆叠。
    // 抽样窗口取每发 t=1.2s（径向对称 + 重力垂直偏置不影响列/行均值分类）。
    {
        const{fx}=makeHarness(mod);fx.start('festival_national_day',{deferIntro:true});
        const spots=[];
        for(let cycle=0;cycle<30;cycle++){
            fx.age=cycle*3.4+1.2;fx._advance(0);
            const lit=fx.getParticleSnapshot().filter(p=>p.variant===1&&(p.drawAlpha??0)>0.3);
            if(lit.length){
                const xs=lit.map(p=>p.x),ys=lit.map(p=>p.y);
                spots.push(Math.round(xs.reduce((a,b)=>a+b)/xs.length/fx.width*3-0.5)+'-'+Math.round((ys.reduce((a,b)=>a+b)/ys.length/fx.height-0.2)/0.38));
            }
        }
        const detail=[];
        for(let r=0;r*6+6<=spots.length;r++){
            const win=spots.slice(r*6,r*6+6),set=new Set(win);
            if(set.size!==6)detail.push(`轮${r}(${win.join(' ')})只覆盖${set.size}个燃点`);
        }
        assert.ok(detail.length===0,'国庆礼花燃点连燃堆叠: '+detail.join(' | ')+' —— 全序列 '+spots.join(' '));
    }

    // 中秋仅使用半透明白/黄色星星调色板。
    {
        const{fx}=makeHarness(mod);fx.start('festival_mid_autumn',{deferIntro:true});
        const theme=themes.festival_mid_autumn,snapshot=fx.getParticleSnapshot();let whites=0,yellows=0;
        for(const color of theme.palette){
            const[r,g,b]=parseHex(color),white=Math.min(r,g,b)>=220&&Math.max(r,g,b)-Math.min(r,g,b)<=40,yellow=r>=230&&g>=180&&b<=180;
            assert.ok(white||yellow,`中秋出现非白黄颜色 ${color}`);if(white)whites++;if(yellow)yellows++;
        }
        assert.ok(whites>0&&yellows>0,'中秋调色板必须同时包含白色和黄色');
        assert.ok(snapshot.every(p=>p.mode==='midAutumn'&&(p.variant===0||p.variant===1)),'中秋粒子必须全部为星星 variant');
        assert.ok(snapshot.every(p=>p.alpha>0&&p.alpha<1),'中秋星星必须保持半透明');
    }

    // 中秋月亮保留 46×46 世界尺度，但横屏、竖屏和极窄双窗都必须完整落在 NDC 内；窄屏只能增加深度，不能删掉或缩放模型。
    {
        const viewports=[[1920,1080],[1280,720],[968,856],[720,1280],[320,1000]];
        for(const[width,height]of viewports){
            const layout=mod.computeFestivalMoonLayout({aspect:width/height,verticalFov:55,zoom:1,scale:46});
            assert.equal(layout.scale,46,`${width}x${height}: 中秋月亮世界尺度被修改`);
            assert.ok(layout.centerX>0&&layout.centerY>0,`${width}x${height}: 月亮中心不在右上区域`);
            for(const[edge,value]of Object.entries(layout.bounds))assert.ok(value>=-1-1e-9&&value<=1+1e-9,`${width}x${height}: 月亮 ${edge} 越出 NDC (${value})`);
            assert.ok(layout.bounds.right<=.941&&layout.bounds.top<=.941,`${width}x${height}: 月亮未保留右/上安全边距`);
            const projectedX=layout.offsetX/(layout.halfHeight*layout.aspect),projectedY=layout.offsetY/layout.halfHeight;
            assert.ok(Math.abs(projectedX-layout.centerX)<1e-9&&Math.abs(projectedY-layout.centerY)<1e-9,`${width}x${height}: 世界偏移与 NDC 中心不一致`);
        }
        const landscape=mod.computeFestivalMoonLayout({aspect:16/9,verticalFov:55,scale:46}),portrait=mod.computeFestivalMoonLayout({aspect:9/16,verticalFov:55,scale:46});
        assert.equal(landscape.depth,70,'16:9 不应改变旧版月亮基础深度');
        assert.ok(portrait.depth>landscape.depth,'竖屏应通过增加深度完整容纳月亮');
    }

    // 国庆每档都由一半均匀常驻星星和一半完整径向礼花组成；礼花不能退化成散乱的全屏噪点。
    {
        for(const quality of['low','mid','high']){
            const{fx}=makeHarness(mod,{quality});fx.start('festival_national_day',{deferIntro:true});
            const state=fx.getDebugState(),snapshot=fx.getParticleSnapshot(),expectedStars=Math.floor(state.particleCount*.5),expectedSparks=state.particleCount-expectedStars;
            const stars=snapshot.filter(p=>p.variant===0),sparks=snapshot.filter(p=>p.variant===1);
            assert.equal(stars.length,expectedStars,`国庆/${quality}: 常驻星星数量错误`);
            assert.equal(sparks.length,expectedSparks,`国庆/${quality}: 径向礼花数量错误`);
            assertLiveCoverage(fx,`国庆/${quality}/常驻星星`,{filter:p=>p.variant===0,minVisible:expectedStars,minOccupied:Math.min(10,expectedStars)});
            assert.ok(sparks.every(p=>p.vr===0&&Number.isFinite(p.angle)&&p.speed>0),`国庆/${quality}: 礼花方向数据不完整`);
            const angles=sparks.map(p=>((p.angle%(Math.PI*2))+Math.PI*2)%(Math.PI*2)).sort((a,b)=>a-b);
            const circularGaps=angles.map((angle,index)=>((angles[(index+1)%angles.length]+(index===angles.length-1?Math.PI*2:0))-angle));
            assert.ok(angles.at(-1)-angles[0]>Math.PI*1.7,`国庆/${quality}: 礼花角度没有覆盖完整圆周`);
            assert.ok(Math.max(...circularGaps)<Math.PI*.45,`国庆/${quality}: 礼花圆周出现明显缺口`);
            assert.equal(new Set(sparks.map(p=>`${p.x.toFixed(4)},${p.y.toFixed(4)}`)).size,1,`国庆/${quality}: 同轮礼花必须从同一个爆点放射`);
            advanceFrames(fx,24);
            const liveSparks=fx.getParticleSnapshot().filter(p=>p.variant===1&&p.drawAlpha>.05);
            assert.equal(liveSparks.length,expectedSparks,`国庆/${quality}: 礼花展开时不得丢失火花`);
        }
    }

    // stop 必须彻底移除 surface、上下文和活动粒子，且重复 stop 幂等。
    {
        const{document,fx}=makeHarness(mod);fx.start('festival_new_year',{deferIntro:true});const canvas=fx.canvas;
        fx.stop();let state=fx.getDebugState();
        assert.equal(document.body.children.length,0);assert.equal(canvas.removeCount,1);
        assert.equal(state.running,false);assert.equal(state.surfaceCount,0);assert.equal(state.particleCount,0);assert.equal(state.activeId,null);
        assert.equal(fx.canvas,null);assert.equal(fx.ctx,null);const stopCount=state.stopCount;
        fx.stop();state=fx.getDebugState();assert.equal(state.stopCount,stopCount,'重复 stop 不得重复清理');assert.equal(canvas.removeCount,1);
    }

    console.log('Festival screen FX regression PASSED: 16 themes / coverage / motion / lifecycle.');
}

main().catch(error=>{
    console.error(error.stack||error);
    process.exitCode=1;
});
