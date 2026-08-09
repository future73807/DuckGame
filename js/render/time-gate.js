// requestAnimationFrame 时间闸口：以真实时间控制昂贵更新，并在低显示帧率下切到逐 rAF。
// 纯状态机、无 DOM/Three.js 依赖，便于用注入时间戳做确定性回归测试。

/**
 * @param {{
 *   defaultHz?:number,
 *   fullRateEnabled?:boolean,
 *   emaAlpha?:number,
 *   fullRateEnterRatio?:number,
 *   fullRateExitRatio?:number,
 *   epsilonMs?:number,
 *   discontinuityMs?:number,
 *   initiallyForced?:boolean,
 * }} [options]
 */
export function createRafTimeGate(options={}){
    const defaultHz=positive(options.defaultHz,30);
    const fullRateEnabled=options.fullRateEnabled!==false;
    const emaAlpha=clamp(positive(options.emaAlpha,.25),.01,1);
    // 当显示频率低于约 2×目标频率时，固定 Hz 无法均匀映射到 rAF，必然产生一帧/两帧交替。
    // 进入阈值略高于半周期、退出阈值略低，配合 EMA 防止 57–60 FPS 边界反复切换。
    const enterRatio=positive(options.fullRateEnterRatio,.525);
    const exitRatio=Math.min(enterRatio,positive(options.fullRateExitRatio,.505));
    const epsilonMs=Math.max(0,finiteOr(options.epsilonMs,1.5));
    const discontinuityMs=positive(options.discontinuityMs,250);

    let forced=options.initiallyForced!==false;
    let lastAttemptMs=null,lastUpdateMs=null,nextDueMs=null,lastTargetHz=null;
    let emaFrameMs=null,fullRate=false;

    function forceNext(){forced=true}

    function reset(force=true){
        forced=!!force;
        lastAttemptMs=null;lastUpdateMs=null;nextDueMs=null;lastTargetHz=null;
        emaFrameMs=null;fullRate=false;
    }

    function updateFullRate(intervalMs){
        if(!fullRateEnabled||emaFrameMs===null){fullRate=false;return}
        if(fullRate){
            if(emaFrameMs<=intervalMs*exitRatio)fullRate=false;
        }else if(emaFrameMs>=intervalMs*enterRatio)fullRate=true;
    }

    function advanceDeadline(deadline,nowMs,intervalMs){
        if(!Number.isFinite(deadline))return nowMs+intervalMs;
        const steps=Math.max(1,Math.floor((nowMs-deadline)/intervalMs)+1);
        return deadline+steps*intervalMs;
    }

    /**
     * @param {number} nowMs 同一 rAF 应传入同一个 performance.now 时间戳
     * @param {number} [targetHz]
     * @returns {boolean} 本次是否应执行昂贵更新
     */
    function shouldUpdate(nowMs,targetHz=defaultHz){
        const now=Number(nowMs);
        if(!Number.isFinite(now))throw new TypeError('time gate nowMs must be finite');
        const hz=positive(targetHz,defaultHz),intervalMs=1000/hz;

        // 同一 rAF 重复调用不得消费 force，也不得污染帧间隔 EMA。
        if(lastAttemptMs!==null&&now===lastAttemptMs)return false;

        const frameGapMs=lastAttemptMs===null?null:now-lastAttemptMs;
        const discontinuity=frameGapMs!==null&&(frameGapMs<0||frameGapMs>discontinuityMs);
        if(discontinuity){
            // 后台挂起/时钟回退后只刷新一次，并从当前时刻重新排期；绝不补跑错过的周期。
            lastAttemptMs=now;lastUpdateMs=now;nextDueMs=now+intervalMs;lastTargetHz=hz;
            emaFrameMs=null;fullRate=false;forced=false;
            return true;
        }

        if(frameGapMs!==null&&frameGapMs>0){
            emaFrameMs=emaFrameMs===null?frameGapMs:emaFrameMs+(frameGapMs-emaFrameMs)*emaAlpha;
        }
        lastAttemptMs=now;

        const targetChanged=lastTargetHz!==null&&hz!==lastTargetHz;
        lastTargetHz=hz;
        updateFullRate(intervalMs);
        if(targetChanged&&lastUpdateMs!==null)nextDueMs=lastUpdateMs+intervalMs;

        const forcedNow=forced;
        const due=forcedNow||lastUpdateMs===null||fullRate||nextDueMs===null
            ||now+epsilonMs>=nextDueMs;
        if(!due)return false;

        forced=false;
        lastUpdateMs=now;
        nextDueMs=forcedNow||fullRate||targetChanged||nextDueMs===null
            ?now+intervalMs
            :advanceDeadline(nextDueMs,now,intervalMs);
        return true;
    }

    function getState(){
        return{forced,lastAttemptMs,lastUpdateMs,nextDueMs,targetHz:lastTargetHz,emaFrameMs,fullRate};
    }

    return{shouldUpdate,forceNext,reset,getState};
}

function positive(value,fallback){
    const number=Number(value);
    return Number.isFinite(number)&&number>0?number:fallback;
}
function finiteOr(value,fallback){
    const number=Number(value);
    return Number.isFinite(number)?number:fallback;
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
