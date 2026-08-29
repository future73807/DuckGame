// ===== 双人模式场景同步（房主权威）——自 js/main.js 阶段 7 迁入 =====
// 依赖注入：initDuoSceneSync(ctx) 由 main.js 在依赖就绪后调用。
// 注意：duoSameSerializedItem / duoBuildHostSceneUpload / duoAcceptHostSceneAck
// 必须保持顶层纯 FunctionDeclaration，scripts/check-duo-delta.js 会按函数名
// 从本文件源码切片注入 vm 做协议回归，函数体只允许引用模块级状态与自身参数。
import * as THREE from 'three';
import {isDownHostSceneCaretaker} from '../core/run-feedback.js';

let ctx=null;
export function initDuoSceneSync(c){ctx=c}

export let duoItemsHash=null;
let duoNextItemId=1,duoLastSceneSeq=-1;
let duoHostSceneBase=null,duoHostSceneBaseRev=null,duoHostSceneDeltaCapable=false;
let duoClockTarget=null,duoClockTargetAt=0;
export const duoSceneStats={packets:0,hashSkips:0,fullPackets:0,deltaPackets:0,reconciles:0,totalCreated:0,totalRemoved:0,totalReused:0,lastApplyMs:0,maxApplyMs:0,totalApplyMs:0,last:null};
const duoLocalCollected=new Map();
const duoCollectedPending=new Map();
export function resetDuoHostSceneBase(){duoHostSceneBase=null;duoHostSceneBaseRev=null}
export function setDuoNextItemId(v){duoNextItemId=v}
export function duoMarkCollected(x,z){duoLocalCollected.set(Math.round(x*2)+','+Math.round(z*2),performance.now()+5000)}
export function duoIsCollected(x,z){const k=Math.round(x*2)+','+Math.round(z*2);const e=duoLocalCollected.get(k);if(e===undefined)return false;if(performance.now()>e){duoLocalCollected.delete(k);return false}return true}
export function duoIsGuest(){return typeof Duo!=='undefined'&&Duo.active&&Duo.role==='guest'}
export function duoIsDownHostCaretaker(){return typeof Duo!=='undefined'&&isDownHostSceneCaretaker({gameActive:ctx.gameActive(),duoActive:Duo.active,role:Duo.role,down:Duo._down,status:Duo.room?.status})}
export function duoQueueCollectedItem(item){
    if(!duoIsGuest()||!Number.isInteger(item?.duoId)||item.duoId<=0)return;
    // 在房主场景确认隐藏/移除前重复携带数个状态包，抵抗单包丢失；确认后由 duoApplyScene 删除。
    // 单次请求会依次尝试两个地址，最坏可到 7 秒；30 秒窗口覆盖超时/短暂断网且仍保持有界。
    duoCollectedPending.set(item.duoId,{generation:Number.isSafeInteger(item.duoGen)&&item.duoGen>=0?item.duoGen:0,expires:performance.now()+30000});
}
export function duoPendingCollectionIds(){
    const now=performance.now();for(const[id,claim]of duoCollectedPending)if(claim.expires<=now)duoCollectedPending.delete(id);
    return Array.from(duoCollectedPending,([id,claim])=>[id,claim.generation]).slice(0,64);
}
export function duoApplyGuestCollections(claims){
    if(typeof Duo==='undefined'||!Duo.active||Duo.role!=='host'||!Array.isArray(claims)||!claims.length)return;
    const wanted=new Map();
    for(const raw of claims.slice(0,64)){
        const id=Array.isArray(raw)?Number(raw[0]):Number(raw);
        const generation=Array.isArray(raw)?Number(raw[1]):null;
        if(Number.isSafeInteger(id)&&id>0&&(generation===null||Number.isSafeInteger(generation)&&generation>=0))wanted.set(id,generation);
    }
    for(const item of ctx.items){
        if(item.coll||!wanted.has(item.duoId))continue;
        const claimedGeneration=wanted.get(item.duoId);
        const itemGeneration=Number.isSafeInteger(item.duoGen)&&item.duoGen>=0?item.duoGen:0;
        // 旧代号只能确认旧生命周期，绝不能在同一 stable ID 已复活后再次收集。
        if(claimedGeneration!==null&&claimedGeneration!==itemGeneration)continue;
        if(ctx.RESPAWNING_ITEM_TYPES.has(item.type))ctx.scheduleItemRespawn(item,item.type==='lily'?3000:2000,item.type==='flower'?-.02:item.type==='lily'?.01:0);
        else{item.coll=true;ctx.scene.remove(item.mesh)}
    }
}
export function resetDuoSceneSync(resetItemIds=false){
    duoItemsHash=null;duoLastSceneSeq=-1;duoClockTarget=null;duoClockTargetAt=0;duoHostSceneBase=null;duoHostSceneBaseRev=null;duoHostSceneDeltaCapable=false;duoLocalCollected.clear();duoCollectedPending.clear();
    if(resetItemIds){duoNextItemId=1;for(const it of ctx.items){delete it.duoId;delete it.duoGen;delete it.duoHX;delete it.duoHZ;delete it.duoTargetX;delete it.duoTargetZ}}
}
export function updateDuoClock(dt){
    if(!duoIsGuest()||duoClockTarget===null)return;
    const expected=duoClockTarget+(performance.now()-duoClockTargetAt)/1000;
    const diff=expected-ctx.gameClock();
    // 以略快/略慢的单调时钟逐帧追赶房主，避免网络回调直接改时间导致全屏动画前后跳。
    ctx.addGameClock(THREE.MathUtils.clamp(diff*dt*1.25,-dt*.35,dt*.5));
}
export function duoSerializeScene(){
    const its=[];
    for(const it of ctx.items){
        if(it.coll&&!it.respawning)continue;
        // 稳定 id 让客机在道具被磁铁/漩涡推动时原位更新，不再按坐标误判为新物体反复重建。
        if(!Number.isInteger(it.duoId)||it.duoId<=0)it.duoId=duoNextItemId++;
        if(!Number.isSafeInteger(it.duoGen)||it.duoGen<0)it.duoGen=0;
        const fallY=it.falling!==undefined&&it.falling>0&&it.mesh.position.y>1?Math.round(it.mesh.position.y*100)/100:null;
        its.push([it.type,it.mesh.position.x,it.mesh.position.z,it.mesh.scale.y,fallY,it.duoId,it.respawning?1:0,it.duoGen]);
    }
    // 漩涡：房主权威同步（位置 + 缩放）
    const ws=[];
    for(const w of ctx.whirlpools){ws.push([w.x,w.z,w.scale])}
    let h=its.length;
    for(let i=0;i<its.length;i++)h=(h*31+its[i][5]+its[i][6]*17+its[i][7]*23+Math.round(its[i][1]*10)+Math.round(its[i][2]*10)+Math.round(its[i][3]*100))|0;
    for(let i=0;i<ws.length;i++)h=(h*31+Math.round(ws[i][0]*10)+Math.round(ws[i][1]*10))|0;
    // 鲨鱼位置同步（房主权威）：[x, z, rotationY] 或 null
    let sharkData=null;
    if(ctx.getShark()){const p=ctx.getShark().g.position;sharkData=[Math.round(p.x*100)/100,Math.round(p.z*100)/100,ctx.getShark().g.rotation.y]}
    // 事件状态同步：wind/storm/rainbow 布尔值 + 风向 evWindDir（随机量必须房主权威同步）
    return{clk:ctx.gameClock(),evT:ctx.globalEventTimer(),evN:ctx.activeEvent(),evTm:ctx.activeEventTime(),wS:ctx.syncState.waveSpeed,wST:ctx.syncState.waveSpeedTarget,eWT:ctx.syncState.eventWaveTarget,ih:h,items:its,whirls:ws,
        waveDir:[ctx.syncState.waveEventDir.x,ctx.syncState.waveEventDir.z],waveStr:ctx.syncState.waveEventStrength,waveActive:ctx.syncState.waveEventActive?1:0,waveDur:ctx.syncState.waveEventDuration,
        shark:sharkData,
        windAct:ctx.syncState.windActive?1:0,windMul:ctx.syncState.windSpeedMul,evWindDir:[ctx.syncState.evWindDir.x,ctx.syncState.evWindDir.z],
        stormAct:ctx.syncState.stormActive?1:0,stormBolt:ctx.getStormSync(),rbAct:ctx.syncState.rainbowActive?1:0};
}
function duoSameSerializedItem(left,right){
    if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length)return false;
    for(let i=0;i<left.length;i++)if(left[i]!==right[i])return false;
    return true;
}
function duoBuildHostSceneUpload(fullScene){
    const fullUpload=()=>({...fullScene,uploadProtocol:2});
    if(!duoHostSceneDeltaCapable||!duoHostSceneBase||!Number.isSafeInteger(duoHostSceneBaseRev)||duoHostSceneBaseRev<=0||!Array.isArray(fullScene?.items)||!Array.isArray(duoHostSceneBase.items))return fullUpload();
    const before=new Map();
    for(const item of duoHostSceneBase.items){const id=Array.isArray(item)?item[5]:null;if(!Number.isSafeInteger(id)||id<=0||before.has(id))return fullUpload();before.set(id,item)}
    const currentIds=new Set(),upserts=[];
    for(const item of fullScene.items){
        const id=Array.isArray(item)?item[5]:null;
        if(!Number.isSafeInteger(id)||id<=0||currentIds.has(id))return fullUpload();
        currentIds.add(id);if(!duoSameSerializedItem(before.get(id),item))upserts.push(item);
    }
    const removed=[];for(const id of before.keys())if(!currentIds.has(id))removed.push(id);
    const upload={...fullScene,uploadProtocol:2,baseRev:duoHostSceneBaseRev};delete upload.items;
    // 纯 metadata 包不带任何道具数组；发生变化时才携带 stable-id upsert/remove。
    if(upserts.length||removed.length)upload.itemDelta={upserts,removed};
    return upload;
}
function duoAcceptHostSceneAck(fullScene,ack){
    if(ack?.protocol===2&&Number.isSafeInteger(Number(ack.rev))&&Number(ack.rev)>0){duoHostSceneDeltaCapable=true;duoHostSceneBase=fullScene;duoHostSceneBaseRev=Number(ack.rev);return true}
    // 旧服务端没有 sceneAck：持续发送全量，避免把它无法重建的增量当作空场景。
    duoHostSceneDeltaCapable=false;duoHostSceneBase=null;duoHostSceneBaseRev=null;return false;
}
export {duoSameSerializedItem,duoBuildHostSceneUpload,duoAcceptHostSceneAck};
const DUO_ITEM_BASE_RADIUS={rock:.6,flower:.4,grass:.4,lily:.4,magnet:.35,heart:.6};
export function duoParseItemSnapshot(raw){
    if(!Array.isArray(raw)||raw.length<4)return null;
    const[type,x,z,scale,fy,id,hidden,generation]=raw;
    if(!Object.prototype.hasOwnProperty.call(DUO_ITEM_BASE_RADIUS,type)||!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(scale))return null;
    return{type,x,z,scale,fy,id:Number.isInteger(id)&&id>0?id:null,hidden:!!hidden,generation:Number.isSafeInteger(generation)&&generation>=0?generation:0};
}
export function duoCreateItemFromSnapshot(snap){
    const{type,x,z,scale,fy,id,hidden}=snap;let mesh;
    switch(type){
        case'rock':{const rs=.5;mesh=ctx.isFestival('festival_national_day')?ctx.mkCake(new THREE.Vector3(x,-.1,z),rs):ctx.mkRock(new THREE.Vector3(x,-.1,z),rs);break}
        case'flower':mesh=ctx.mkFlower(x,z);break;
        case'grass':mesh=ctx.isFestival('festival_dragon_boat')?ctx.mkZongzi(x,z):ctx.mkGrass(x,z,7);break;
        case'lily':mesh=ctx.mkLily(x,z,.4);break;
        case'magnet':mesh=ctx.mkMagnet(x,z);break;
        case'heart':mesh=ctx.mkHeart(x,z);break;
    }
    if(!mesh)return null;
    mesh.scale.setScalar(scale);
    const isFalling=typeof fy==='number'&&fy>1;
    if(isFalling)mesh.position.y=fy;
    ctx.scene.add(mesh);
    const item={mesh,type,r:DUO_ITEM_BASE_RADIUS[type]*scale,coll:hidden,respawning:hidden,duoHidden:hidden,duoId:id,duoGen:snap.generation,duoHX:x,duoHZ:z,duoTargetX:x,duoTargetZ:z};
    mesh.visible=!hidden;
    if(isFalling){item.falling=10;item.fallVy=0}
    ctx.items.push(item);return item;
}
export function duoApplyItemSnapshot(item,snap,firstAuthority=false){
    const wasLocallyInactive=!!(item.duoHidden||item.coll||item.respawning);
    let claim=duoIsGuest()&&Number.isInteger(snap.id)?duoCollectedPending.get(snap.id):null;
    if(claim&&(snap.generation>claim.generation||snap.generation===claim.generation&&snap.hidden)){duoCollectedPending.delete(snap.id);claim=null}
    const collectionPending=!!claim;
    item.duoId=snap.id;item.duoGen=snap.generation;item.duoHX=snap.x;item.duoHZ=snap.z;item.duoTargetX=snap.x;item.duoTargetZ=snap.z;item.duoHidden=snap.hidden;
    if(duoIsGuest()&&Number.isInteger(snap.id)&&snap.hidden){
        if(item.respawnTimer){clearTimeout(item.respawnTimer);item.respawnTimer=null}
        item.coll=true;item.respawning=true;item.mesh.visible=false;
    }else if(duoIsGuest()&&Number.isInteger(snap.id)&&!collectionPending&&wasLocallyInactive){
        if(item.respawnTimer){clearTimeout(item.respawnTimer);item.respawnTimer=null}
        item.coll=false;item.respawning=false;item.mesh.visible=true;item.mesh.position.x=snap.x;item.mesh.position.z=snap.z;
    }else if(snap.hidden)item.mesh.visible=false;else if(!item.coll)item.mesh.visible=true;
    if(!item.coll){
        if(Math.abs(item.mesh.scale.y-snap.scale)>.02)item.mesh.scale.setScalar(snap.scale);
        item.r=DUO_ITEM_BASE_RADIUS[item.type]*snap.scale;
        const dx=snap.x-item.mesh.position.x,dz=snap.z-item.mesh.position.z;
        // 客机本地磁吸期间不让 10Hz 房主快照把同一道具硬拽回去；收集声明仍由 stable id 交给房主确认。
        const locallyAttracted=duoIsGuest()&&ctx.magnetFxActive()&&(item.magT||0)>.01;
        if(firstAuthority||!locallyAttracted&&dx*dx+dz*dz>16)item.mesh.position.set(snap.x,item.mesh.position.y,snap.z);
        if(typeof snap.fy==='number'&&snap.fy>1){item.mesh.position.y=snap.fy;item.falling=10;item.fallVy=0}
    }
}
export function duoReconcileWhirls(rawWhirls){
    const wkey=(x,z)=>Math.round(x*10)/10+'|'+Math.round(z*10)/10,want=new Map();
    if(Array.isArray(rawWhirls))for(const raw of rawWhirls)if(Array.isArray(raw)&&raw.length>=3)want.set(wkey(raw[0],raw[1]),{x:raw[0],z:raw[1],wm:raw[2]});
    for(let i=ctx.whirlpools.length-1;i>=0;i--){
        const whirl=ctx.whirlpools[i],key=wkey(whirl.x,whirl.z),snap=want.get(key);
        if(!snap){ctx.disposeWhirlpoolVisuals(whirl);const zi=ctx.whirlZones.indexOf(whirl.zone);if(zi>=0)ctx.whirlZones.splice(zi,1);ctx.whirlpools.splice(i,1);continue}
        want.delete(key);if(Math.abs((whirl.scale||1)-snap.wm)>.02){whirl.scale=snap.wm;whirl.group.scale.setScalar(snap.wm)}
    }
    for(const whirl of want.values())ctx.whirlpools.push(ctx.mkWhirlpool(whirl.x,whirl.z,whirl.wm));
}
export function duoApplySceneDelta(sc,sceneSeq){
    const delta=sc?.itemDelta;
    if(!delta||Number(delta.baseHash)!==Number(duoItemsHash)||!Array.isArray(delta.upserts)||!Array.isArray(delta.removed)||!Array.isArray(sc.whirls))return false;
    const byId=new Map();for(const item of ctx.items)if(Number.isInteger(item.duoId)&&item.duoId>0)byId.set(item.duoId,item);
    let removed=0,created=0,reused=0;
    for(const rawId of delta.removed){
        const id=Number(rawId),item=byId.get(id);duoCollectedPending.delete(id);if(!item)continue;
        const index=ctx.items.indexOf(item);if(index>=0){ctx.scene.remove(item.mesh);ctx.disposeItemVisual(item);ctx.items.splice(index,1);removed++}byId.delete(id);
    }
    for(const raw of delta.upserts){
        const snap=duoParseItemSnapshot(raw);if(!snap||snap.id===null)continue;
        let item=byId.get(snap.id);
        if(item&&item.type!==snap.type){const index=ctx.items.indexOf(item);if(index>=0){ctx.scene.remove(item.mesh);ctx.disposeItemVisual(item);ctx.items.splice(index,1);removed++}byId.delete(snap.id);item=null}
        if(item){duoApplyItemSnapshot(item,snap);reused++}
        else{item=duoCreateItemFromSnapshot(snap);if(item){byId.set(snap.id,item);created++}}
    }
    duoItemsHash=sc.ih;duoSceneStats.deltaPackets++;
    const reconcile={mode:'delta',seq:Number.isFinite(sceneSeq)?sceneSeq:null,hash:sc.ih,upserts:delta.upserts.length,removed,created,reused,after:ctx.items.length};
    duoSceneStats.reconciles++;duoSceneStats.totalCreated+=created;duoSceneStats.totalRemoved+=removed;duoSceneStats.totalReused+=reused;duoSceneStats.last=reconcile;
    return true;
}
export function duoApplyScene(sc,sceneSeq){
    if(!sc)return;
    if(Number.isFinite(sceneSeq)){
        if(sceneSeq<=duoLastSceneSeq)return;
        duoLastSceneSeq=sceneSeq;
    }
    const applyStarted=performance.now(),finishApply=()=>{const ms=performance.now()-applyStarted;duoSceneStats.lastApplyMs=ms;duoSceneStats.maxApplyMs=Math.max(duoSceneStats.maxApplyMs,ms);duoSceneStats.totalApplyMs+=ms};
    window.__duoApplyCalls=window.__duoApplyCalls||[];
    window.__duoApplyCalls.push({t:Date.now(),seq:Number.isFinite(sceneSeq)?sceneSeq:null,whirlsCount:Array.isArray(sc.whirls)?sc.whirls.length:null,itemsCount:Array.isArray(sc.items)?sc.items.length:null,ih:sc.ih});
    if(window.__duoApplyCalls.length>20)window.__duoApplyCalls.shift();
    // 只记录最新房主时钟目标，实际校准在渲染循环内按帧率无关的速度连续完成。
    if(typeof sc.clk==='number'){
        duoClockTarget=sc.clk;
        duoClockTargetAt=performance.now();
    }
    ctx.syncState.waveSpeed=sc.wS;ctx.syncState.waveSpeedTarget=sc.wST;ctx.syncState.eventWaveTarget=sc.eWT;
    ctx.syncState.globalEventTimer=sc.evT;ctx.syncState.activeEventTime=sc.evTm;
    if(ctx.syncState.activeEvent!==sc.evN){ctx.syncState.activeEvent=sc.evN;if(ctx.syncState.activeEvent){ctx.startEvent(ctx.syncState.activeEvent);ctx.syncState.activeEventTime=sc.evTm}else ctx.endEvent()}
    // 水流方向箭头事件同步（房主权威）：方向 / 强度 / 是否激活 / 剩余时长
    if(Array.isArray(sc.waveDir)){
        const newDir={x:sc.waveDir[0],z:sc.waveDir[1]};
        const dirChanged=Math.abs(newDir.x-ctx.syncState.waveEventDir.x)>.01||Math.abs(newDir.z-ctx.syncState.waveEventDir.z)>.01;
        ctx.syncState.waveEventDir=newDir;ctx.syncState.waveEventStrength=sc.waveStr||0;ctx.syncState.waveEventActive=!!sc.waveActive;ctx.syncState.waveEventDuration=sc.waveDur||0;
        // 方向变化时重绘箭头贴图（与房主一致）
        if(dirChanged&&ctx.syncState.waveEventActive){const ang=Math.atan2(newDir.z,newDir.x);ctx.drawArrowTexture(ang);ctx.arrowTex.needsUpdate=true}
        if(!ctx.syncState.waveEventActive){ctx.cur.x=0;ctx.cur.z=0;ctx.arrowPlane.material.opacity=0}
    }
    // 鲨鱼同步（房主权威）：客机端按房主数据创建/更新/销毁本地鲨鱼
    if(sc.shark){
        const[sx,sz,sry]=sc.shark;
        ctx.setDuoSharkTarget({x:sx,z:sz,ry:sry});
        if(!ctx.getShark()){ctx.spawnShark();if(ctx.getShark()){ctx.getShark().g.position.set(sx,0,sz);ctx.getShark().g.rotation.y=sry}}
    }else{ctx.setDuoSharkTarget(null);ctx.removeShark()}
    // 事件状态同步（房主权威）：wind/storm/rainbow 布尔值 + 风向 evWindDir
    // 必须在 startEvent/endEvent 之后执行，覆盖本地随机生成的 evWindDir，确保两端粒子方向一致
    if(sc.windAct!==undefined){
        ctx.syncState.windActive=!!sc.windAct;
        ctx.syncState.windSpeedMul=Number.isFinite(sc.windMul)?sc.windMul:1;
        if(Array.isArray(sc.evWindDir)&&sc.evWindDir.length>=2){
            ctx.syncState.evWindDir={x:sc.evWindDir[0],z:sc.evWindDir[1]};
        }
    }
    if(sc.stormAct!==undefined)ctx.syncState.stormActive=!!sc.stormAct;
    if(sc.stormBolt)ctx.applyStormSync(sc.stormBolt);
    if(sc.rbAct!==undefined){
        const newRb=!!sc.rbAct;
        if(newRb!==ctx.syncState.rainbowActive){
            ctx.syncState.rainbowActive=newRb;
            if(ctx.syncState.rainbowActive)document.getElementById('rainbow-overlay').classList.add('show');
            else document.getElementById('rainbow-overlay').classList.remove('show');
        }
    }
    duoSceneStats.packets++;
    // 漩涡生命周期独立于道具 hash；必须先应用，再决定是否跳过 items 调和。
    if(Array.isArray(sc.whirls))duoReconcileWhirls(sc.whirls);
    if(sc.ih===duoItemsHash){duoSceneStats.hashSkips++;finishApply();return}
    if(duoApplySceneDelta(sc,sceneSeq)){finishApply();return}
    // hash 不同却没有数组，说明服务端按请求发出后客户端已前进到更新快照；等待下一包，绝不拿空数组清场。
    if(!Array.isArray(sc.items)||!Array.isArray(sc.whirls)){finishApply();return}
    duoItemsHash=sc.ih;duoSceneStats.fullPackets++;
    // 道具增量调和：优先按房主稳定 id 匹配；旧服务端才退回坐标指纹。
    const r5=v=>Math.round(v*20)/20; // 0.05 精度网格对齐，容忍房主端浮点微差
    const keyOf=(type,x,z,id)=>Number.isInteger(id)&&id>0?'id|'+type+'|'+id:'pos|'+type+'|'+r5(x)+'|'+r5(z);
    const want=new Map();
    const wantByType=new Map();
    if(Array.isArray(sc.items)){
        for(const raw of sc.items){
            const snap=duoParseItemSnapshot(raw);if(!snap)continue;
            const{type,x,z}=snap;
            if(duoIsCollected(x,z))continue;
            snap.key=keyOf(type,x,z,snap.id);want.set(snap.key,snap);
            if(!wantByType.has(type))wantByType.set(type,[]);
            wantByType.get(type).push(snap);
        }
    }
    if(duoIsGuest()&&duoCollectedPending.size){
        const snapshotIds=new Set();for(const snap of want.values())if(Number.isInteger(snap.id)){
            snapshotIds.add(snap.id);
            const claim=duoCollectedPending.get(snap.id);
            // hidden=true 是同一生命周期的确认；generation 变大则说明即使错过隐藏帧，房主也已处理并完成复活。
            if(claim&&(snap.generation>claim.generation||snap.generation===claim.generation&&snap.hidden))duoCollectedPending.delete(snap.id);
        }
        for(const id of duoCollectedPending.keys())if(!snapshotIds.has(id))duoCollectedPending.delete(id);
    }
    const reconcile={seq:Number.isFinite(sceneSeq)?sceneSeq:null,hash:sc.ih,wanted:want.size,existing:ctx.items.length,withStableId:ctx.items.filter(it=>Number.isInteger(it.duoId)).length,reused:0,firstAuthority:0,removed:0,created:0};
    for(let i=ctx.items.length-1;i>=0;i--){
        const it=ctx.items[i];
        const k=keyOf(it.type,it.duoHX??it.mesh.position.x,it.duoHZ??it.mesh.position.z,it.duoId);
        let snap=want.get(k);
        // 首个客机快照到达前页面已有一批随机物品：按类型复用现有网格，避免同帧销毁并重建约 244 个复杂模型。
        if(!snap&&!Number.isInteger(it.duoId)){
            const pool=wantByType.get(it.type);
            while(pool?.length&&!want.has(pool[pool.length-1].key))pool.pop();
            if(pool?.length)snap=pool.pop();
        }
        if(!snap){ // 快照里没有了（被吃/消失/漂远）→ 移除
            ctx.scene.remove(it.mesh);ctx.disposeItemVisual(it);ctx.items.splice(i,1);reconcile.removed++;continue;
        }
        want.delete(snap.key); // 匹配成功：复用现有 mesh（动画相位/状态保留，无任何跳变）
        const firstAuthority=!Number.isInteger(it.duoId)&&Number.isInteger(snap.id);
        reconcile.reused++;if(firstAuthority)reconcile.firstAuthority++;
        duoApplyItemSnapshot(it,snap,firstAuthority);
    }
    // 快照中有而本地没有 → 新建（仅增量，通常每次 0~2 个）
    for(const it of want.values())if(duoCreateItemFromSnapshot(it))reconcile.created++;
    reconcile.after=ctx.items.length;duoSceneStats.reconciles++;duoSceneStats.totalCreated+=reconcile.created;duoSceneStats.totalRemoved+=reconcile.removed;duoSceneStats.totalReused+=reconcile.reused;duoSceneStats.last=reconcile;finishApply();
}
