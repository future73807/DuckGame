// 水面时间闸口确定性回归：不启动浏览器，以注入的 rAF 时间戳验证真实 cadence。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');

async function loadTimeGate(){
    // 客户端源码是浏览器 ESM，而服务端保持 CommonJS；data URL 可直接执行同一份纯模块源码，
    // 无需复制调度算法或为整个项目切换 package type。
    const source=fs.readFileSync(path.join(ROOT,'js/render/time-gate.js'),'utf8');
    const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');
    return import(url);
}

function stableTrace(createRafTimeGate,fps,targetHz=30,durationMs=2000){
    const gate=createRafTimeGate({defaultHz:targetHz});
    const step=1000/fps,updates=[],attempts=[];
    const frameCount=Math.floor(durationMs/step+1e-8);
    for(let frame=0;frame<=frameCount;frame++){
        const now=frame*step;attempts.push(now);
        if(gate.shouldUpdate(now,targetHz))updates.push(now);
    }
    return{gate,step,updates,attempts,gaps:updates.slice(1).map((time,index)=>time-updates[index])};
}

function near(actual,expected,tolerance=.02){
    assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} is not within ${tolerance} of ${expected}`);
}

async function main(){
    const{createRafTimeGate}=await loadTimeGate();

    // 30–57 FPS：30 Hz 无法均匀落在整数 rAF，必须逐 rAF，不能再出现 19/38 或 29/59ms 交替。
    for(const fps of[30,34,40,52,57]){
        const trace=stableTrace(createRafTimeGate,fps);
        assert.equal(trace.updates.length,trace.attempts.length,`${fps} FPS 未逐 rAF 更新`);
        for(const gap of trace.gaps)near(gap,trace.step);
    }

    // 60/120 FPS 分别稳定每 2/4 帧更新；检查每个间隔，而不只检查平均频率。
    for(const[fps,framesPerUpdate]of[[60,2],[120,4]]){
        const trace=stableTrace(createRafTimeGate,fps);
        for(const gap of trace.gaps)near(gap,trace.step*framesPerUpdate);
        assert.ok(Math.abs(trace.updates.length-61)<=1,`${fps} FPS 的 2 秒更新数异常: ${trace.updates.length}`);
    }

    // 风暴 40 Hz 在 60 FPS 下同样处于非整数 cadence 区，逐 rAF 比 16/33ms 交替更平滑。
    const storm=stableTrace(createRafTimeGate,60,40);
    assert.equal(storm.updates.length,storm.attempts.length,'60 FPS 风暴未逐 rAF 更新');

    // 水面默认 60 Hz：60 FPS 显示逐帧重建浪面（消除鸭子相对浪面的阶梯抖动），
    // 120 FPS 显示稳定每 2 帧更新（配合逐帧推进的 renderedWaveClock，鸭子仍然平滑）。
    const hz60=stableTrace(createRafTimeGate,60,60);
    assert.equal(hz60.updates.length,hz60.attempts.length,'60 FPS / 60 Hz 未逐 rAF 更新');
    for(const gap of hz60.gaps)near(gap,hz60.step);
    const hz60fast=stableTrace(createRafTimeGate,120,60);
    for(const gap of hz60fast.gaps)near(gap,hz60fast.step*2);
    assert.ok(Math.abs(hz60fast.updates.length-121)<=1,`120 FPS / 60 Hz 的 2 秒更新数异常: ${hz60fast.updates.length}`);

    // EMA + 滞回：单个稍慢帧不能让稳定 60 FPS 误入全速；从 57 切到 60 也不能一帧内反复跳变。
    const boundary=createRafTimeGate({defaultHz:30});
    let now=0;boundary.shouldUpdate(now,30);
    for(let i=0;i<8;i++){now+=1000/60;boundary.shouldUpdate(now,30)}
    now+=18.2;boundary.shouldUpdate(now,30);
    assert.equal(boundary.getState().fullRate,false,'单个慢帧误触全速模式');
    const hysteresis=createRafTimeGate({defaultHz:30});
    now=0;hysteresis.shouldUpdate(now,30);
    for(let i=0;i<8;i++){now+=1000/57;hysteresis.shouldUpdate(now,30)}
    assert.equal(hysteresis.getState().fullRate,true,'稳定 57 FPS 未进入全速模式');
    now+=1000/60;hysteresis.shouldUpdate(now,30);
    assert.equal(hysteresis.getState().fullRate,true,'滞回不足：一个 60 FPS 帧立即退出全速');
    for(let i=0;i<20;i++){now+=1000/60;hysteresis.shouldUpdate(now,30)}
    assert.equal(hysteresis.getState().fullRate,false,'稳定 60 FPS 未退出全速模式');

    // >250ms 是后台/挂起断档：只在恢复点刷新一次，从当前时间重排，不补跑历史周期。
    const resumed=createRafTimeGate({defaultHz:30});
    assert.equal(resumed.shouldUpdate(0,30),true);
    assert.equal(resumed.shouldUpdate(16,30),false);
    assert.equal(resumed.shouldUpdate(1000,30),true);
    assert.equal(resumed.shouldUpdate(1000,30),false,'同 timestamp 重复更新');
    assert.equal(resumed.shouldUpdate(1016,30),false,'断档后发生 catch-up');
    assert.equal(resumed.shouldUpdate(1034,30),true,'断档后未从当前时间恢复排期');

    // force 在同一 timestamp 不得绕过“一 rAF 一次”，应保留到下一时间戳。
    const forced=createRafTimeGate({defaultHz:30});
    assert.equal(forced.shouldUpdate(0,30),true);
    forced.forceNext();
    assert.equal(forced.shouldUpdate(0,30),false);
    assert.equal(forced.shouldUpdate(1,30),true);

    console.log('OK: water scheduler cadence / EMA hysteresis / discontinuity / duplicate timestamp');
}

main().catch(error=>{
    console.error(error.stack||error);
    process.exitCode=1;
});
