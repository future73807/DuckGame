// 单局即时反馈的纯逻辑：统计、高光选择与“惊险擦边”状态机。
// 本模块不依赖 DOM / Three.js / 随机数，便于在浏览器与 Node 回归测试中复用。

const finiteNonNegative=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;

export function createRunStats(startTime=0){
    return{
        items:0,
        distance:0,
        startTime:finiteNonNegative(startTime),
        maxComboMultiplier:1,
        collectChain:0,
        maxCollectChain:0,
        lowHealthSince:null,
        lowHealthEscapes:0,
        longestLowHealthSeconds:0,
        nearMisses:0,
        highlight:null
    };
}

export function recordCollection(stats){
    if(!stats)return 0;
    stats.items=finiteNonNegative(stats.items)+1;
    stats.collectChain=finiteNonNegative(stats.collectChain)+1;
    stats.maxCollectChain=Math.max(finiteNonNegative(stats.maxCollectChain),stats.collectChain);
    return stats.collectChain;
}

export function resetCollectionChain(stats){
    if(stats)stats.collectChain=0;
}

export function recordComboMultiplier(stats,multiplier){
    if(!stats)return 1;
    stats.maxComboMultiplier=Math.max(1,finiteNonNegative(stats.maxComboMultiplier),finiteNonNegative(multiplier));
    return stats.maxComboMultiplier;
}

export function beginLowHealth(stats,activeSeconds){
    if(!stats||stats.lowHealthSince!==null)return false;
    stats.lowHealthSince=finiteNonNegative(activeSeconds);
    return true;
}

export function finishLowHealth(stats,activeSeconds,escaped){
    if(!stats||stats.lowHealthSince===null)return 0;
    const duration=Math.max(0,finiteNonNegative(activeSeconds)-finiteNonNegative(stats.lowHealthSince));
    // 结算文案明确写“回血”，因此这里只统计真正从 1 心恢复的持续时间。
    // 若最终死亡也覆盖该值，会把死亡前的残血时长误报成“N 秒后回血”。
    if(escaped){
        stats.longestLowHealthSeconds=Math.max(finiteNonNegative(stats.longestLowHealthSeconds),duration);
        stats.lowHealthEscapes=finiteNonNegative(stats.lowHealthEscapes)+1;
    }
    stats.lowHealthSince=null;
    return duration;
}

export function selectRunHighlight(stats){
    const maxMultiplier=Math.max(1,finiteNonNegative(stats?.maxComboMultiplier));
    const maxChain=Math.floor(finiteNonNegative(stats?.maxCollectChain));
    const escapes=Math.floor(finiteNonNegative(stats?.lowHealthEscapes));
    const lowHealthSeconds=finiteNonNegative(stats?.longestLowHealthSeconds);
    const candidates=[];

    // ×10 与连续收集 10 件处在同一强度；同分时优先更清晰的连胜倍率。
    // icon 统一用 FontAwesome 名称（结算面板渲染 <i>），不在画布/面板里使用 emoji。
    if(maxMultiplier>=5)candidates.push({
        kind:'multiplier',icon:'fa-fire',text:`最高连胜倍率 ×${Math.round(maxMultiplier)}`,
        prominence:maxMultiplier*10,priority:2
    });
    if(maxChain>0)candidates.push({
        kind:'collection',icon:'fa-gem',text:`连续收集 ${maxChain} 件`,
        prominence:Math.min(150,maxChain*10),priority:1
    });
    // 从 1 心恢复是三类高光中最稀有的事件；坚持时间用于同类事件的细分。
    if(escapes>0)candidates.push({
        kind:'rescue',icon:'fa-life-ring',
        text:escapes===1?`1 心逃生 · ${Math.max(1,Math.round(lowHealthSeconds))} 秒后回血`:`1 心逃生 ${escapes} 次`,
        prominence:110+(escapes-1)*15+Math.min(10,lowHealthSeconds),priority:3
    });

    if(!candidates.length)return{kind:'multiplier',icon:'fa-star',text:'最高连胜倍率 ×1',prominence:0};
    candidates.sort((a,b)=>b.prominence-a.prominence||b.priority-a.priority);
    const {priority,...highlight}=candidates[0];
    return highlight;
}

export function createNearMissState(){
    return{prevDistance:Infinity,armed:false,done:false,minClearance:Infinity,enteredAt:0,startX:0,startZ:0};
}

/**
 * 推进单个危险物的擦边状态。
 * 返回 true 仅表示一次候选已完整“进入安全窄环并驶离”；全局冷却由调用方统一处理。
 */
export function updateNearMissState(state,sample){
    if(!state||state.done)return false;
    const distance=finiteNonNegative(sample?.distance);
    const hitRadius=finiteNonNegative(sample?.hitRadius);
    const margin=finiteNonNegative(sample?.margin);
    const hysteresis=finiteNonNegative(sample?.hysteresis);
    const now=finiteNonNegative(sample?.now);
    const x=Number.isFinite(Number(sample?.x))?Number(sample.x):0;
    const z=Number.isFinite(Number(sample?.z))?Number(sample.z):0;
    const speed=finiteNonNegative(sample?.speed);
    const minSpeed=finiteNonNegative(sample?.minSpeed);
    const minTravel=finiteNonNegative(sample?.minTravel);
    const maxDwell=finiteNonNegative(sample?.maxDwell);
    const nearRadius=hitRadius+margin;
    const exitRadius=nearRadius+hysteresis;

    // 无敌、节日替代物和免疫漩涡等不具备“冒险”语义；必须离开后重新进入才可武装。
    if(!sample?.eligible){state.armed=false;state.prevDistance=distance;return false}
    if(distance<=hitRadius){state.armed=false;state.done=true;state.prevDistance=distance;return false}

    if(!state.armed&&state.prevDistance>nearRadius&&distance<=nearRadius&&speed>=minSpeed){
        state.armed=true;state.minClearance=distance-hitRadius;state.enteredAt=now;state.startX=x;state.startZ=z;
    }
    if(state.armed){
        state.minClearance=Math.min(state.minClearance,distance-hitRadius);
        if(distance>=exitRadius){
            const travel=Math.hypot(x-state.startX,z-state.startZ);
            const dwell=Math.max(0,now-state.enteredAt);
            const qualified=state.minClearance>0&&state.minClearance<=margin&&travel>=minTravel&&dwell<=maxDwell;
            state.armed=false;state.done=true;state.prevDistance=distance;
            return qualified;
        }
    }
    state.prevDistance=distance;
    return false;
}

export function criticalHeartPolicy(critical){
    return critical
        ?{chance:.85,cap:3,nextMin:4,nextMax:7,invincibility:1.25}
        :{chance:.45,cap:2,nextMin:8,nextMax:15,invincibility:.6};
}

export function shouldSpawnHeart({needsHeart,present,roll,critical}){
    const policy=criticalHeartPolicy(!!critical);
    if(!needsHeart||finiteNonNegative(present)>=policy.cap)return false;
    return finiteNonNegative(roll)<policy.chance;
}

export function isDownHostSceneCaretaker({gameActive,duoActive,role,down,status}){
    return !gameActive&&!!duoActive&&role==='host'&&!!down&&status==='running';
}

export function circleClearance(x,z,hazardX,hazardZ,hazardRadius){
    const px=Number(x),pz=Number(z),hx=Number(hazardX),hz=Number(hazardZ),radius=Number(hazardRadius);
    if(!Number.isFinite(px)||!Number.isFinite(pz)||!Number.isFinite(hx)||!Number.isFinite(hz)||!Number.isFinite(radius))return-Infinity;
    return Math.hypot(px-hx,pz-hz)-Math.max(0,radius);
}

export function selectSafeHeartCandidate(candidates,minClearance=0){
    const required=finiteNonNegative(minClearance);
    let best=null,bestScore=-Infinity;
    for(const candidate of Array.isArray(candidates)?candidates:[]){
        const x=Number(candidate?.x),z=Number(candidate?.z),clearance=Number(candidate?.clearance),preference=Number(candidate?.preference)||0;
        if(!Number.isFinite(x)||!Number.isFinite(z)||Number.isNaN(clearance)||clearance<required)continue;
        const score=clearance+preference;
        if(score>bestScore){bestScore=score;best={x,z,clearance}}
    }
    return best;
}

/**
 * 仅当一个权威道具同时离开所有有效玩家的维护范围时才允许回收。
 * 没有有效玩家坐标时采取保守策略，避免瞬时联机状态缺失清空场景。
 */
export function isOutsideAllPlayerRanges(x,z,players,radius){
    const itemX=Number(x),itemZ=Number(z),range=finiteNonNegative(radius);
    if(!Number.isFinite(itemX)||!Number.isFinite(itemZ))return true;
    const rangeSq=range*range;
    let hasValidPlayer=false;
    for(const player of Array.isArray(players)?players:[]){
        const playerX=Number(player?.x),playerZ=Number(player?.z);
        if(!Number.isFinite(playerX)||!Number.isFinite(playerZ))continue;
        hasValidPlayer=true;
        const dx=itemX-playerX,dz=itemZ-playerZ;
        if(dx*dx+dz*dz<=rangeSq)return false;
    }
    return hasValidPlayer;
}
