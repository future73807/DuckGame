// ===== 双人远程鸭子渲染与航迹推算 ——自 js/main.js 阶段 7 迁入 =====
// 依赖注入：initDuoRemoteDuck(ctx) 由 main.js 在依赖就绪后调用。
// ctx 契约：
//   scene, applyDuckSkinToRoot, mkWaveRing, waveHeight, getRenderedWaveClock(),
//   getGameClock(), getDuckModel(), getDuo(), magnetDashTex, crownGroup, auraMat,
//   magnetPulse, glowTex, sparkTex, MAG_PARTICLES, getMagnetRange,
//   magnetVisualConfig, COMBO_MAGNET_RANGE
import * as THREE from 'three';

let ctx=null;
export function initDuoRemoteDuck(c){ctx=c}

export let duoRemoteDuck=null,duoRemoteTarget=null,duoLocalNameLabel=null,duoRemoteSkin=null,duoRemotePalette=null;
let duoRemoteShield=null,duoRemoteMagnetRing=null,duoRemoteCrown=null,duoRemoteAura=null,duoRemoteMagGlow=null,duoRemoteMagnetPulse=[],duoRemoteMagParticles=null,duoRemoteMagParticleGeo=null,duoRemoteMagParticleData=[],duoRemoteMagParticleMat=null,duoRemoteMagVisualAccumulator=0;
export const duoRemotePosition=new THREE.Vector3();
// 远程鸭子航迹推算（Dead Reckoning）：对端状态约 8.3Hz 到达，按速度外推 + 柔性收敛，消除橡皮筋抖动
let duoRemotePrevSnapT=0,duoRemotePrevTarget=null;
const duoRemoteVel=new THREE.Vector3();
export function setDuoRemoteIdentity(skin,palette){duoRemoteSkin=skin;duoRemotePalette=palette}
export function resetDuoRemoteMotion(){duoRemotePrevSnapT=0;duoRemotePrevTarget=null;duoRemoteVel.set(0,0,0);duoRemoteTarget=null}
export function acceptDuoRemoteSnapshot(state,down){
    if(!state)return;
    let x=Number(state.x)||0,z=Number(state.z)||0;
    if(x===0&&z===0&&typeof Duo!=='undefined'&&Duo.active){x=Duo.role==='host'?3.5:-3.5}
    const now=performance.now();
    if(duoRemotePrevTarget&&duoRemotePrevSnapT>0){
        const snapDt=(now-duoRemotePrevSnapT)/1000,dx=x-duoRemotePrevTarget.x,dz=z-duoRemotePrevTarget.z;
        if(snapDt>.05&&snapDt<1.5&&dx*dx+dz*dz<16){
            const ivx=dx/snapDt,ivz=dz/snapDt;
            duoRemoteVel.x+=(ivx-duoRemoteVel.x)*.5;duoRemoteVel.z+=(ivz-duoRemoteVel.z)*.5;
            const spd=Math.hypot(duoRemoteVel.x,duoRemoteVel.z);
            if(spd>6){duoRemoteVel.x*=6/spd;duoRemoteVel.z*=6/spd}
        }else if(dx*dx+dz*dz>=16)duoRemoteVel.set(0,0,0);
    }
    duoRemotePrevTarget={x,z,ry:state.ry||0};duoRemotePrevSnapT=now;
    duoRemoteTarget={...state,x,z,down:!!down};
}
export function duoOffsetXFor(role){return role==='guest'?3.5:role==='host'?-3.5:0}
export function createDuoNameLabel(name){
    const labelCanvas=document.createElement('canvas');labelCanvas.width=360;labelCanvas.height=96;
    const lctx=labelCanvas.getContext('2d');lctx.fillStyle='rgba(9,15,26,.76)';lctx.roundRect(8,8,344,80,38);lctx.fill();
    // 昵称最长 12 个汉字：字号按实测宽度收缩，避免超出画布被左右边缘硬切
    const txt=name||'鸭鸭';let fontSize=38;
    lctx.font=`600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    while(fontSize>20&&lctx.measureText(txt).width>328){fontSize-=2;lctx.font=`600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`}
    lctx.fillStyle='#fff';lctx.textAlign='center';lctx.textBaseline='middle';lctx.fillText(txt,180,49);
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(labelCanvas),transparent:true,depthTest:false,depthWrite:false}));label.userData.duoNameLabel=true;label.userData.duoName=name||'鸭鸭';
    // 漩涡是 renderOrder 4..8 的透明层；名字必须最后绘制，且不能污染深度缓冲。
    label.renderOrder=2000;label.position.set(0,2.7,0);label.scale.set(2.7,.72,1);return label;
}
export function disposeDuoNameLabel(label){
    if(!label)return;
    label.parent?.remove(label);
    const mats=Array.isArray(label.material)?label.material:[label.material];
    for(const mat of mats){if(!mat)continue;mat.map?.dispose();mat.dispose()}
}
export function removeDuoLocalNameLabel(){disposeDuoNameLabel(duoLocalNameLabel);duoLocalNameLabel=null}
function disposeDuoRemoteDuck(){
    if(!duoRemoteDuck)return;
    const labels=[],materials=new Set();
    duoRemoteDuck.traverse(node=>{
        if(node.userData?.duoNameLabel){labels.push(node);return}
        if(!node.isMesh||!node.material)return;
        const mats=Array.isArray(node.material)?node.material:[node.material];
        // createDuoRemoteDuck 为远端模型逐材质 clone；纹理与几何仍和本地模型共享，不能释放。
        for(const mat of mats)if(mat)materials.add(mat);
    });
    for(const label of labels)disposeDuoNameLabel(label);
    for(const mat of materials)mat.dispose();
}
export function setDuoRemoteNameLabel(name){
    if(!duoRemoteDuck)return;
    const nextName=name||'好友',current=duoRemoteDuck.children.find(node=>node.userData?.duoNameLabel);
    if(current?.userData?.duoName===nextName)return;
    if(current)disposeDuoNameLabel(current);
    duoRemoteDuck.add(createDuoNameLabel(nextName));
}
export function setDuoLocalNameLabel(name){
    removeDuoLocalNameLabel();
    const duckModel=ctx.getDuckModel();
    if(!duckModel)return;
    duoLocalNameLabel=createDuoNameLabel(name);duckModel.add(duoLocalNameLabel);
}
export function removeDuoRemoteDuck(preserveMotion=false){
    if(duoRemoteDuck){ctx.scene.remove(duoRemoteDuck);disposeDuoRemoteDuck()}
    if(duoRemoteShield){ctx.scene.remove(duoRemoteShield);duoRemoteShield.geometry.dispose();duoRemoteShield.material.dispose();duoRemoteShield=null}
    if(duoRemoteMagnetRing){ctx.scene.remove(duoRemoteMagnetRing);duoRemoteMagnetRing.geometry.dispose();duoRemoteMagnetRing.material.dispose();duoRemoteMagnetRing=null}
    if(duoRemoteCrown){ctx.scene.remove(duoRemoteCrown);duoRemoteCrown=null}
    if(duoRemoteAura){ctx.scene.remove(duoRemoteAura);duoRemoteAura.geometry.dispose();duoRemoteAura.material.dispose();duoRemoteAura=null}
    if(duoRemoteMagGlow){ctx.scene.remove(duoRemoteMagGlow);duoRemoteMagGlow.material.dispose();duoRemoteMagGlow=null}
    if(duoRemoteMagnetPulse.length){duoRemoteMagnetPulse.forEach(r=>{ctx.scene.remove(r);r.geometry.dispose();r.material.dispose()});duoRemoteMagnetPulse=[]}
    if(duoRemoteMagParticles){ctx.scene.remove(duoRemoteMagParticles);duoRemoteMagParticleGeo.dispose();duoRemoteMagParticleMat.dispose();duoRemoteMagParticles=null;duoRemoteMagParticleGeo=null;duoRemoteMagParticleMat=null;duoRemoteMagParticleData=[]}
    duoRemoteDuck=null;duoRemoteSkin=null;duoRemotePalette=null;duoRemoteMagVisualAccumulator=0;
    if(!preserveMotion)resetDuoRemoteMotion();
}
export function createDuoRemoteDuck(name,state){
    removeDuoRemoteDuck(true);
    const duckModel=ctx.getDuckModel();
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
    ctx.applyDuckSkinToRoot(duoRemoteDuck,duoRemoteSkin,duoRemotePalette);
    duoRemoteDuck.add(createDuoNameLabel(name||'好友'));
    if(state){
        // 初始状态（房主/客机刚加入，state.x/z 均为 0）时，把对端鸭子放在本地鸭子对面，避免重叠
        // 优先使用 Duo.role 决定对端所在侧（房主端看到客机在 +3.5，客机端看到房主在 -3.5）
        let rx=state.x,rz=state.z;
        if(rx===0&&rz===0&&typeof Duo!=='undefined'&&Duo.active){
            rx=Duo.role==='host'?3.5:-3.5;
            rz=0;
        }
        const y=ctx.waveHeight(rx,rz,ctx.getRenderedWaveClock())-.08;
        duoRemoteDuck.position.set(rx,y,rz);duoRemoteDuck.rotation.y=state.ry||0;
    }
    duoRemoteDuck.visible=!!state&&!state.down;ctx.scene.add(duoRemoteDuck);
    // 远程鸭子的盾/磁铁光环/连胜皇冠/光环（与本地版本独立，避免互相覆盖可见性）
    if(!duoRemoteShield){
        duoRemoteShield=new THREE.Mesh(new THREE.SphereGeometry(1.8,32,24),new THREE.MeshPhysicalMaterial({color:0x44ddff,transparent:true,opacity:0,roughness:0,metalness:.3,clearcoat:1,side:THREE.DoubleSide,depthWrite:false}));
        duoRemoteShield.renderOrder=20;duoRemoteShield.visible=false;ctx.scene.add(duoRemoteShield);
    }
    if(!duoRemoteMagnetRing){
        duoRemoteMagnetRing=ctx.mkWaveRing(2,96,new THREE.MeshBasicMaterial({map:ctx.magnetDashTex,transparent:true,opacity:0,color:0x86d4ff,depthWrite:false,fog:false,side:THREE.DoubleSide}),6);
        duoRemoteMagnetRing.visible=false;ctx.scene.add(duoRemoteMagnetRing);
    }
    if(!duoRemoteCrown){
        duoRemoteCrown=ctx.crownGroup.clone(true);
        duoRemoteCrown.visible=false;ctx.scene.add(duoRemoteCrown);
    }
    if(!duoRemoteAura){
        duoRemoteAura=new THREE.Mesh(new THREE.SphereGeometry(2.5,24,16),ctx.auraMat.clone());
        duoRemoteAura.visible=false;duoRemoteAura.renderOrder=30;ctx.scene.add(duoRemoteAura);
    }
    // 远程鸭子磁铁吸引特效：普通磁铁读取 mt，小磁吸读取 cm，二者共用固定视觉池。
    if(duoRemoteMagnetPulse.length===0){
        for(let i=0;i<2;i++){
            const r=ctx.mkWaveRing(1,72,new THREE.MeshBasicMaterial({map:ctx.magnetPulse[i].material.map,transparent:true,opacity:0,color:0x9fe0ff,depthWrite:false,fog:false,side:THREE.DoubleSide}),8);
            r.visible=false;ctx.scene.add(r);duoRemoteMagnetPulse.push(r);
        }
    }
    if(!duoRemoteMagGlow){
        duoRemoteMagGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:ctx.glowTex,transparent:true,opacity:0,color:0x7fd4ff,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
        duoRemoteMagGlow.scale.set(2.6,2.6,1);duoRemoteMagGlow.visible=false;ctx.scene.add(duoRemoteMagGlow);
    }
    // 远程鸭子磁场粒子（与本地 magParticles 对应，按普通/小磁吸切换预算）
    if(!duoRemoteMagParticles){
        duoRemoteMagParticleGeo=new THREE.BufferGeometry();
        const pos=new Float32Array(ctx.MAG_PARTICLES*3),col=new Float32Array(ctx.MAG_PARTICLES*3);
        const initialRange=ctx.getMagnetRange();
        for(let i=0;i<ctx.MAG_PARTICLES;i++){
            duoRemoteMagParticleData.push({angle:Math.random()*Math.PI*2,radius:2+Math.random()*(initialRange-2),yOff:(Math.random()-.5)*1.2,speed:.6+Math.random()*.9});
        }
        duoRemoteMagParticleGeo.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
        duoRemoteMagParticleGeo.setAttribute('color',new THREE.BufferAttribute(col,3).setUsage(THREE.DynamicDrawUsage));
        duoRemoteMagParticleMat=new THREE.PointsMaterial({size:.32,transparent:true,opacity:0,vertexColors:true,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,map:ctx.sparkTex});
        duoRemoteMagParticles=new THREE.Points(duoRemoteMagParticleGeo,duoRemoteMagParticleMat);
        duoRemoteMagParticles.frustumCulled=false;duoRemoteMagParticles.visible=false;ctx.scene.add(duoRemoteMagParticles);
    }
}
export function hideDuoRemoteMagnetFx(){
    duoRemoteMagVisualAccumulator=0;
    if(duoRemoteMagnetRing){duoRemoteMagnetRing.visible=false;duoRemoteMagnetRing.material.opacity=0}
    for(const pulse of duoRemoteMagnetPulse){pulse.visible=false;pulse.material.opacity=0}
    if(duoRemoteMagGlow){duoRemoteMagGlow.visible=false;duoRemoteMagGlow.material.opacity=0}
    if(duoRemoteMagParticles){duoRemoteMagParticles.visible=false;duoRemoteMagParticleMat.opacity=0}
}
export function hideDuoRemoteStatusFx(){
    if(duoRemoteShield)duoRemoteShield.visible=false;
    hideDuoRemoteMagnetFx();
    if(duoRemoteCrown)duoRemoteCrown.visible=false;
    if(duoRemoteAura)duoRemoteAura.visible=false;
}
// 调试快照：供 main.js 调试面板读取远程特效可见性（模块私有状态只读暴露）
export function duoRemoteDebugFxSnapshot(){
    return {shield:duoRemoteShield,ring:duoRemoteMagnetRing,particles:duoRemoteMagParticles,crown:duoRemoteCrown,aura:duoRemoteAura};
}
export function updateDuoRemoteDuck(dt){
    if(!duoRemoteDuck||!duoRemoteTarget)return;
    const target=duoRemoteTarget;
    if(target.down){duoRemoteDuck.visible=false;hideDuoRemoteStatusFx();return}
    duoRemoteDuck.visible=true;
    // 对端鸭子初始 state.x/z 为 0 时，使用 Duo.role 决定对端所在侧，避免两只鸭子重叠
    let tx=target.x,tz=target.z;
    if(tx===0&&tz===0&&typeof Duo!=='undefined'&&Duo.active){
        tx=Duo.role==='host'?3.5:-3.5;
        tz=0;
    }
    const gameClock=ctx.getGameClock(),renderedWaveClock=ctx.getRenderedWaveClock();
    const y=ctx.waveHeight(tx,tz,renderedWaveClock)-.08+Math.sin(gameClock*1.8)*.035;
    // ---- 航迹推算：先按估计速度外推，再向最新快照柔性收敛 ----
    // 旧实现 dt*6 硬 lerp 追 8.3Hz 的离散目标点 → 每个新快照到达都"弹射"一下（橡皮筋抖动）
    const nowMs=performance.now();
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
        duoRemoteDuck.position.y=ctx.waveHeight(duoRemoteDuck.position.x,duoRemoteDuck.position.z,renderedWaveClock)-.08+Math.sin(gameClock*1.8)*.035;
    }
    // 朝向：由移动方向推算（连续平滑）+ 快照 ry 慢速校准（防漂移）
    if(Math.abs(duoRemoteVel.x)+Math.abs(duoRemoteVel.z)>.15){
        // 模型默认面朝 +X，与本地鸭子相同需补偿 -90°，否则速度朝向和快照朝向会互相拉扯。
        const moveRy=Math.atan2(duoRemoteVel.x,duoRemoteVel.z)-Math.PI/2;
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
    // 普通磁铁优先；伙伴的三连小磁吸固定 8 米并使用紧凑预算，避免增加双窗压力。
    const remoteFullMagnet=target.mt>0,remoteComboMagnet=target.cm>0;
    if((remoteFullMagnet||remoteComboMagnet)&&duoRemoteMagnetRing){
        if(!duoRemoteMagnetRing.visible)duoRemoteMagVisualAccumulator=1;
        duoRemoteMagnetRing.visible=true;if(duoRemoteMagGlow)duoRemoteMagGlow.visible=true;if(duoRemoteMagParticles)duoRemoteMagParticles.visible=true;
        const visual=ctx.magnetVisualConfig(true,!remoteFullMagnet);duoRemoteMagVisualAccumulator+=dt;
        for(let i=0;i<duoRemoteMagnetPulse.length;i++){const show=i<visual.pulses;duoRemoteMagnetPulse[i].visible=show;if(!show)duoRemoteMagnetPulse[i].material.opacity=0}
        if(duoRemoteMagParticles)duoRemoteMagParticleGeo.setDrawRange(0,visual.particles);
        if(duoRemoteMagVisualAccumulator>=1/visual.hz){
            const visualDt=Math.min(.1,duoRemoteMagVisualAccumulator);duoRemoteMagVisualAccumulator%=1/visual.hz;
            const mRange=remoteFullMagnet?ctx.getMagnetRange():ctx.COMBO_MAGNET_RANGE,rdx=duoRemoteDuck.position.x,rdz=duoRemoteDuck.position.z;
            if(typeof duoRemoteMagnetRing.userData.update==='function')duoRemoteMagnetRing.userData.update(rdx,rdz,mRange-1.2,mRange,.15);
            else duoRemoteMagnetRing.position.set(rdx,ctx.waveHeight(rdx,rdz,renderedWaveClock),rdz);
            duoRemoteMagnetRing.material.opacity=(remoteFullMagnet?.55:.38)+Math.sin(gameClock*4)*(remoteFullMagnet?.2:.12);
            // 脉冲环（两圈交替从外向内收缩，与本地 magnetPulse 一致）
            for(let i=0;i<visual.pulses;i++){
                const ph=(gameClock*.45+i*.5)%1,r=1+ph*(mRange-1),pr=duoRemoteMagnetPulse[i];
                if(typeof pr.userData.update==='function')pr.userData.update(rdx,rdz,Math.max(r-.5,.2),r,.12);
                pr.material.opacity=(1-ph)*(remoteFullMagnet?.4:.26);
            }
            // 鸭子周身磁场辉光（与本地 magGlow 一致）
            if(duoRemoteMagGlow){
                duoRemoteMagGlow.position.set(rdx,duoRemoteDuck.position.y+.7,rdz);
                duoRemoteMagGlow.material.opacity=(remoteFullMagnet?.3:.22)+Math.sin(gameClock*5)*(remoteFullMagnet?.15:.1);
                const gs=(remoteFullMagnet?2.4:1.9)+Math.sin(gameClock*5)*.25;duoRemoteMagGlow.scale.set(gs,gs,1);
            }
            // 磁场粒子：螺旋向内汇聚到鸭子（与本地 magParticles 一致）
            if(duoRemoteMagParticles){
                const pos=duoRemoteMagParticleGeo.attributes.position,col=duoRemoteMagParticleGeo.attributes.color;
                for(let i=0;i<visual.particles;i++){
                    const p=duoRemoteMagParticleData[i];
                    p.angle+=visualDt*p.speed*1.5;p.radius-=visualDt*p.speed*2.2;
                    if(p.radius<.6||p.radius>mRange){p.radius=Math.max(1,mRange-Math.random()*Math.min(2,mRange*.25));p.angle=Math.random()*Math.PI*2;p.yOff=(Math.random()-.5)*1.2}
                    const t=1-p.radius/mRange,y=duoRemoteDuck.position.y+.3+p.yOff*(1-t)+Math.sin(gameClock*3+p.angle*2)*.15+t*.6;
                    pos.setXYZ(i,rdx+Math.cos(p.angle)*p.radius,y,rdz+Math.sin(p.angle)*p.radius);col.setXYZ(i,.35+t*.65,.75+t*.25,1);
                }
                pos.needsUpdate=true;col.needsUpdate=true;duoRemoteMagParticleMat.opacity=(remoteFullMagnet?.85:.62)*(.5+Math.sin(gameClock*4)*.25);
            }
        }
    }else hideDuoRemoteMagnetFx();
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
