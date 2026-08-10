// 单局反馈纯逻辑回归：擦边状态机、残血策略、统计重置与唯一高光。
const fs=require('fs');
const assert=require('node:assert/strict');

(async()=>{
    const source=fs.readFileSync('js/core/run-feedback.js','utf8');
    const mainSource=fs.readFileSync('js/main.js','utf8');
    const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

    const a=mod.createRunStats(100),b=mod.createRunStats();
    assert.notStrictEqual(a,b,'每局统计必须是独立对象');
    assert.deepEqual({items:a.items,chain:a.collectChain,max:a.maxCollectChain,escapes:a.lowHealthEscapes,near:a.nearMisses},
        {items:0,chain:0,max:0,escapes:0,near:0});
    for(let i=0;i<4;i++)mod.recordCollection(a);
    assert.equal(a.items,4);assert.equal(a.collectChain,4);assert.equal(a.maxCollectChain,4);
    mod.resetCollectionChain(a);assert.equal(a.collectChain,0);assert.equal(a.maxCollectChain,4);
    mod.recordComboMultiplier(a,5);mod.recordComboMultiplier(a,10);mod.recordComboMultiplier(a,1);
    assert.equal(a.maxComboMultiplier,10);
    mod.beginLowHealth(a,8);mod.finishLowHealth(a,14.4,true);
    assert.equal(a.lowHealthEscapes,1);assert.ok(a.longestLowHealthSeconds>6.3&&a.longestLowHealthSeconds<6.5);
    mod.beginLowHealth(a,20);mod.finishLowHealth(a,40,false);
    assert.equal(a.lowHealthEscapes,1,'最终死亡不得计为成功逃生');
    assert.ok(a.longestLowHealthSeconds>6.3&&a.longestLowHealthSeconds<6.5,'死亡前残血时长不得覆盖“回血耗时”');

    const multiplier=mod.createRunStats();multiplier.maxComboMultiplier=10;multiplier.maxCollectChain=5;
    assert.equal(mod.selectRunHighlight(multiplier).kind,'multiplier');
    const collector=mod.createRunStats();collector.maxComboMultiplier=10;collector.maxCollectChain=12;
    assert.equal(mod.selectRunHighlight(collector).kind,'collection');
    const rescue=mod.createRunStats();rescue.maxCollectChain=6;rescue.lowHealthEscapes=1;rescue.longestLowHealthSeconds=4;
    assert.equal(mod.selectRunHighlight(rescue).kind,'rescue');
    const tie=mod.createRunStats();tie.maxComboMultiplier=10;tie.maxCollectChain=10;
    assert.equal(mod.selectRunHighlight(tie).kind,'multiplier','同分必须稳定地只选一项');
    const invalid=mod.createRunStats();invalid.maxComboMultiplier=NaN;invalid.maxCollectChain=-9;invalid.lowHealthEscapes=-2;
    assert.match(mod.selectRunHighlight(invalid).text,/×1$/);

    const sample=(overrides={})=>({distance:1.5,hitRadius:1,margin:.75,hysteresis:.35,eligible:true,now:.1,x:0,z:0,speed:2,minSpeed:1.2,minTravel:.8,maxDwell:2,...overrides});
    const near=mod.createNearMissState();
    assert.equal(mod.updateNearMissState(near,sample()),false,'进入窄环时只武装');
    assert.equal(mod.updateNearMissState(near,sample({distance:2.2,now:.7,x:1,z:0})),true,'安全驶离后才奖励');
    assert.equal(mod.updateNearMissState(near,sample({distance:1.4,now:1,x:2,z:0})),false,'同一危险物只能消费一次');
    const collision=mod.createNearMissState();
    assert.equal(mod.updateNearMissState(collision,sample({distance:.99})),false);assert.equal(collision.done,true,'实际碰撞必须永久作废候选');
    const dwell=mod.createNearMissState();mod.updateNearMissState(dwell,sample());
    assert.equal(mod.updateNearMissState(dwell,sample({distance:2.2,now:2.2,x:1,z:0})),false,'长时间绕圈停留不能刷分');
    const invincible=mod.createNearMissState();mod.updateNearMissState(invincible,sample({eligible:false}));
    assert.equal(mod.updateNearMissState(invincible,sample({eligible:true,now:.2})),false);assert.equal(invincible.armed,false,'无敌穿入后必须先离开再重进');
    const slow=mod.createNearMissState();mod.updateNearMissState(slow,sample({speed:.5}));
    assert.equal(mod.updateNearMissState(slow,sample({distance:2.2,now:.5,x:1,z:0})),false,'低速贴边不算惊险擦边');

    const normal=mod.criticalHeartPolicy(false),critical=mod.criticalHeartPolicy(true);
    assert.ok(critical.chance>normal.chance&&critical.cap>normal.cap&&critical.invincibility>normal.invincibility);
    assert.equal(mod.shouldSpawnHeart({needsHeart:true,present:0,roll:.6,critical:true}),true);
    assert.equal(mod.shouldSpawnHeart({needsHeart:true,present:0,roll:.6,critical:false}),false);
    assert.equal(mod.shouldSpawnHeart({needsHeart:true,present:critical.cap,roll:0,critical:true}),false);
    assert.equal(mod.shouldSpawnHeart({needsHeart:false,present:0,roll:0,critical:true}),false);
    assert.equal(mod.shouldSpawnHeart({needsHeart:true,present:0,roll:critical.chance,critical:true}),false,'概率边界使用严格小于');

    assert.equal(mod.isDownHostSceneCaretaker({gameActive:false,duoActive:true,role:'host',down:true,status:'running'}),true,'倒地房主必须继续看护权威场景');
    assert.equal(mod.isDownHostSceneCaretaker({gameActive:false,duoActive:true,role:'guest',down:true,status:'running'}),false,'客机不得接管场景权威');
    assert.equal(mod.isDownHostSceneCaretaker({gameActive:false,duoActive:true,role:'host',down:true,status:'finished'}),false,'结算后不得继续场景看护');
    assert.equal(mod.circleClearance(11.5,0,0,0,12),-.5,'漩涡完整吸力圈内必须判定为不安全');
    assert.ok(Math.abs(mod.circleClearance(12.6,0,0,0,12)-.6)<1e-9);
    assert.equal(mod.selectSafeHeartCandidate([{x:1,z:0,clearance:-.1},{x:2,z:0,clearance:.49}],.5),null,'所有候选不安全时不得强制生成');
    const safeCandidate=mod.selectSafeHeartCandidate([{x:1,z:0,clearance:.6},{x:2,z:0,clearance:2}],.5);
    assert.deepEqual({x:safeCandidate.x,z:safeCandidate.z},{x:2,z:0},'应选择净空最充足的安全候选');
    assert.equal(mod.selectSafeHeartCandidate([{x:3,z:4,clearance:Infinity}],.5).x,3,'无任何危险物时 Infinity 净空应视为安全');
    const separatedPlayers=[{x:0,z:0},{x:150,z:0}];
    assert.equal(mod.isOutsideAllPlayerRanges(156,0,separatedPlayers,100),false,'客机附近的救场血瓶不得按房主距离误回收');
    assert.equal(mod.isOutsideAllPlayerRanges(260,0,separatedPlayers,100),true,'离开双方维护范围后才允许回收');
    assert.equal(mod.isOutsideAllPlayerRanges(260,0,[],100),false,'玩家坐标瞬时缺失时不得清空权威道具');
    assert.match(mainSource,/if\(critical\)ensureCriticalHeart\(/,'残血定时刷新必须复用附近安全血瓶，不能直接叠加生成');

    console.log('Run feedback regression PASSED.');
})().catch(error=>{console.error(error);process.exit(1)});
