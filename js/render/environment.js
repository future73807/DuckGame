// 环境渲染：天空 / 云朵 / 太阳月亮星星 / 灯光 / 暴风雨 / 昼夜 / 极光 / 流星 / 海鸥 / 彩虹 / 屏幕氛围
// 依赖通过 createEnvironment(ctx) 注入：
//   - scene, camera, renderer, quality: 来自 runtime
//   - waterMat, waterColDeep, waterColLight, waterColFoam: 来自 water（天空色影响水面色）
//   - getDuckModel, getGameClock: 主循环状态 getter
//   - duoRand, duoIsGuest: 双人工具
//   - isFestival: 节日判定
//   - getAudioCtx, getMusicOn: 音频状态 getter（雷声）
//   - state: 共享状态桥接对象，含 timeOfDay/evWindDir/envBright/stormFactor/lightningFlash/camShake 的 getter/setter
//            以及 timeFx 对象和 windActive/rainbowActive/stormActive/windSpeedMul 的 getter
// 返回：
//   - setCartoonSky(time): 昼夜推进（天空色/灯光/太阳月亮/云朵染色/水面色/雾/极光亮度）
//   - updateClouds(dt): 云朵漂移与动物云变形
//   - updateStormFx(dt): 暴风雨雨幕/闪电
//   - updateSkyFx(dt): 屏幕晨雾/刮风风线/中午镜头光晕
//   - updateSkyAmbience(dt): 极光/流星/海鸥/彩虹/动物云触发
//   - cycleTime(): 切换时段（调试）
//   - setTime(h): 直接设置时间（调试）
//   - resize(): 窗口尺寸变化时重置暴风雨/天空氛围画布
//   - sunLight: 太阳光（main.js 阴影系统可能引用）
//   - window.__skyTest: 调试钩子

import * as THREE from 'three';

/**
 * 创建环境渲染系统
 * @param {object} ctx 依赖上下文
 */
export function createEnvironment(ctx){
    const {
        scene,camera,renderer,quality,
        waterMat,waterColDeep,waterColLight,waterColFoam,
        getDuckModel,getGameClock,
        duoRand,duoIsGuest,
        isFestival,
        getAudioCtx,getMusicOn,
        state,
    }=ctx;

    // ===== Canvas 贴图工具 =====
    function mkTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);return new THREE.CanvasTexture(c)}

    // ===== 昼夜/天气共用颜色 =====
    const _cloudNight=new THREE.Color(0x334466),_cloudStorm=new THREE.Color(0x2e3640),_cloudDusk=new THREE.Color(0xffab7e);
    const _stormSky=new THREE.Color(0x2e3d4f),_stormHor=new THREE.Color(0x55677a),_stormWater=new THREE.Color(0x22303e);
    const _mistHor=new THREE.Color(0xece5d8); // 晨雾时地平线泛白
    const _windTop=new THREE.Color(0x9fc4d8),_windHor=new THREE.Color(0xd8e8ee); // 刮风时天空泛白偏冷
    const _wc=new THREE.Color(); // 环境系统临时色
    let _clockH=-1,_clockM=-1,_clockIcon=null; // 时钟 DOM 缓存：仅在显示内容变化时才写 DOM
    // 时段/事件特效强度因子（setCartoonSky 每帧重算，各特效系统读取）
    const timeFx={mist:0,aurora:0,meteor:0,gull:0,noon:0,wind:0,rainbow:0};
    state.timeFx=timeFx;

    // ===== 卡通天空（渐变球体） =====
    const skyGeo=new THREE.SphereGeometry(800,32,16);
    const skyMat=new THREE.ShaderMaterial({
        uniforms:{
            topColor:{value:new THREE.Color(0x3388cc)},
            midColor:{value:new THREE.Color(0x6fb2e4)},
            horizonColor:{value:new THREE.Color(0x88ccee)},
            botColor:{value:new THREE.Color(0xaaddff)},
            sunPos:{value:new THREE.Vector3(0,1,0)},
            sunColor:{value:new THREE.Color(0xffee88)},
        },
        vertexShader:`
            varying vec3 vWP;
            varying vec3 vN;
            void main(){
                vWP=(modelMatrix*vec4(position,1.0)).xyz;
                vN=normalize(normalMatrix*normal);
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
            }
        `,
        fragmentShader:`
            uniform vec3 topColor;
            uniform vec3 midColor;
            uniform vec3 horizonColor;
            uniform vec3 botColor;
            uniform vec3 sunPos;
            uniform vec3 sunColor;
            varying vec3 vWP;
            varying vec3 vN;
            void main(){
                vec3 dir=normalize(vWP);
                float y=dir.y;
                // 三段式天空渐变：低空暖色带（朝霞/晚霞只留在地平线附近）→ 中带 → 天顶
                vec3 col;
                if(y>0.0){
                    float yc=clamp(y,0.0,1.0);
                    float band=0.16; // 低空色带高度
                    if(yc<band)col=mix(horizonColor,midColor,yc/band);
                    else col=mix(midColor,topColor,pow((yc-band)/(1.0-band),0.65));
                } else {
                    col=horizonColor;
                }
                // 注意：太阳实体由精灵太阳渲染（sunGroup），着色器不再绘制第二个太阳
                gl_FragColor=vec4(col,1.0);
            }
        `,
        side:THREE.BackSide,
        depthWrite:false
    });
    scene.add(new THREE.Mesh(skyGeo,skyMat));

    // ===== 卡通云朵（柔和棉花糖积云：径向渐变 puff 叠加，边缘蓬软） =====
    function mkCloudTexture(v){
        return mkTex(512,320,(x)=>{
            // 积云隆起组合：三种形态变体（px,py,pr）
            const puffs=v===0?[[118,208,60],[205,168,86],[300,172,78],[392,208,56],[256,206,70]]
                :v===1?[[104,218,50],[185,178,70],[285,158,88],[378,182,66],[442,218,42],[330,214,48]]
                :[[92,222,46],[162,188,64],[252,168,80],[345,180,70],[422,210,50],[250,212,60]];
            // 柔和圆形渐变 puff：中心实、边缘渐隐 → 云朵蓬软无硬边
            const puff=(px,py,pr,c0,c1)=>{
                const g=x.createRadialGradient(px,py,pr*.06,px,py,pr);
                g.addColorStop(0,c0);g.addColorStop(.62,c1);g.addColorStop(1,'rgba(255,255,255,0)');
                x.fillStyle=g;x.beginPath();x.arc(px,py,pr,0,Math.PI*2);x.fill();
            };
            // 1) 云底淡蓝灰阴影层（向下偏移，低透明，增加体积感）
            for(const[px,py,pr]of puffs)puff(px,py+pr*.36,pr*1.02,'rgba(148,182,216,.5)','rgba(158,192,222,.3)');
            const gb=x.createLinearGradient(0,190,0,292);
            gb.addColorStop(0,'rgba(168,198,226,0)');gb.addColorStop(.62,'rgba(168,198,226,.32)');gb.addColorStop(1,'rgba(168,198,226,0)');
            x.fillStyle=gb;x.beginPath();x.ellipse(256,236,202,46,0,0,Math.PI*2);x.fill();
            // 2) 主体白色蓬松层
            for(const[px,py,pr]of puffs)puff(px,py,pr,'rgba(255,255,255,.98)','rgba(247,251,255,.88)');
            // 3) 顶部高光小 puff（更亮更小，棉花糖层次感）
            for(const[px,py,pr]of puffs)puff(px-pr*.14,py-pr*.3,pr*.52,'rgba(255,255,255,.92)','rgba(255,255,255,.4)');
        });
    }
    const cloudGroup=new THREE.Group();
    const cloudTexs=[mkCloudTexture(0),mkCloudTexture(1),mkCloudTexture(2)];
    const clouds=[];
    {
        const N=32;
        for(let i=0;i<N;i++){
            const mat=new THREE.SpriteMaterial({map:cloudTexs[i%3],transparent:true,opacity:.92,fog:false,depthWrite:false});
            const s=new THREE.Sprite(mat);
            const w=20+duoRand(i*3+1)*20;
            s.scale.set(w,w*.62,1);
            // 分层均匀：32 朵云按角度均分固定槽位 + 三个距离带（近/中/远）+ 确定性抖动
            // 双人模式：使用 duoRand 确保两端云朵初始位置一致
            const slot=i/N*Math.PI*2;
            const rad0=70+(i%3)*90+40;
            const ang=slot+(duoRand(i*5+3)-.5)*.5;
            const rad=rad0+(duoRand(i*7+5)-.5)*40;
            s.position.set(Math.cos(ang)*rad,24+duoRand(i*11+7)*48,Math.sin(ang)*rad);
            cloudGroup.add(s);
            // baseMap/baseW/baseH：中午动物云替换后恢复用
            // 所有云同一速度：相对位置恒定，快的不会追上慢的 → 分布长期保持均匀
            clouds.push({s,vx:0,vz:0,bob:duoRand(i*13+9)*6,spd:6.2,baseMap:mat.map,baseW:w,baseH:w*.62,creature:false,slot,rad0,morph:0,morphT:0,morphDelay:0,baseOp:.92});
        }
        // 统一风向缓慢漂移（速度提高，让缓慢移动更明显）
        const wa=duoRand(123.456)*Math.PI*2;
        for(const c of clouds){c.vx=Math.cos(wa)*c.spd;c.vz=Math.sin(wa)*c.spd}
    }
    scene.add(cloudGroup);
    function updateClouds(dt){
        const duckModel=getDuckModel();
        const cx=duckModel?duckModel.position.x:0,cz=duckModel?duckModel.position.z:0;
        const wb=timeFx.wind*11; // 刮风事件：云随风加速
        const evWindDir=state.evWindDir;
        const gameClock=getGameClock();
        for(let ci=0;ci<clouds.length;ci++){
            const c=clouds[ci];
            const p=c.s.position;
            p.x+=(c.vx+evWindDir.x*wb)*dt;p.z+=(c.vz+evWindDir.z*wb)*dt;
            p.y+=Math.sin(gameClock*.4+c.bob)*dt*.6;
            const dx=p.x-cx,dz=p.z-cz;
            if(dx*dx+dz*dz>430*430){
                // 回收：找当前云层环绕分布中的最大角度空隙，把云放到空隙中间（±小幅抖动）
                // 双人模式：抖动使用基于 gameClock 的确定性 PRNG，确保两端回收位置一致
                let bestA=duoRand(gameClock*10+ci*3.7+1)*Math.PI*2,bestGap=-1;
                const angs=[];
                for(const o of clouds)if(o!==c)angs.push(Math.atan2(o.s.position.z-cz,o.s.position.x-cx));
                angs.sort((a,b)=>a-b);
                for(let i=0;i<angs.length;i++){
                    const a0=angs[i],a1=i===angs.length-1?angs[0]+Math.PI*2:angs[i+1];
                    const gap=a1-a0;
                    if(gap>bestGap){bestGap=gap;bestA=a0+gap/2}
                }
                const ang2=bestA+(duoRand(gameClock*10+ci*7.3+2)-.5)*Math.min(.4,bestGap*.25);
                const rad=c.rad0+(duoRand(gameClock*10+ci*11.7+3)-.5)*40;
                p.x=cx+Math.cos(ang2)*rad;p.z=cz+Math.sin(ang2)*rad;
                p.y=24+duoRand(gameClock*10+ci*17.3+4)*48;
            }
            // 中午动物云缓慢变形：各朵云带随机错开延迟，先缓缓消散（淡出+缩小），
            // 在完全透明的中点换成鲸鱼贴图，再缓缓凝聚成形（淡入+放大），单朵约4秒、整批十几秒
            if(c.morphDelay>0)c.morphDelay-=dt;
            else if(c.morph!==c.morphT){
                const dir=c.morphT>c.morph?1:-1;
                c.morph=Math.min(1,Math.max(0,c.morph+dir*dt/4));
            }
            if(c.morph>0||c.morphT===1){
                const m=c.morph,whale=m>=.5;
                const vis=whale?(m-.5)*2:1-m*2; // 中点完全透明，此刻换贴图不可见
                const map=whale?creatureTexs[0]:c.baseMap;
                if(c.s.material.map!==map)c.s.material.map=map;
                const bw=whale?c.baseW*2.6:c.baseW,bh=whale?c.baseW*2.6*.56:c.baseH;
                const k=.55+.45*vis;
                c.s.scale.set(bw*k,bh*k,1);
                c.s.material.opacity=c.baseOp*vis;
            }
            if(c.morph===0&&c.morphT===0&&c.creature)c.creature=false; // 完全变回后清除鲸鱼标记
        }
    }

    // ===== 卡通太阳（唯一太阳：核心光盘 + 柔和光晕 + 旋转光芒） =====
    const sunCoreTex=mkTex(256,256,(x)=>{const g=x.createRadialGradient(128,128,10,128,128,128);
        g.addColorStop(0,'rgba(255,252,230,1)');g.addColorStop(.55,'rgba(255,236,150,1)');g.addColorStop(.8,'rgba(255,210,90,1)');g.addColorStop(.92,'rgba(255,196,80,.9)');g.addColorStop(1,'rgba(255,190,70,0)');
        x.fillStyle=g;x.fillRect(0,0,256,256)});
    const sunHaloTex=mkTex(256,256,(x)=>{const g=x.createRadialGradient(128,128,20,128,128,128);
        g.addColorStop(0,'rgba(255,240,180,.55)');g.addColorStop(.4,'rgba(255,225,140,.22)');g.addColorStop(1,'rgba(255,215,110,0)');
        x.fillStyle=g;x.fillRect(0,0,256,256)});
    const sunRaysTex=mkTex(512,512,(x)=>{x.translate(256,256);
        for(let i=0;i<12;i++){x.rotate(Math.PI/6);
            const g=x.createLinearGradient(0,-40,0,-240);g.addColorStop(0,'rgba(255,235,160,.85)');g.addColorStop(1,'rgba(255,225,130,0)');
            x.fillStyle=g;x.beginPath();x.moveTo(-14,-52);x.lineTo(14,-52);x.lineTo(4,-235);x.lineTo(-4,-235);x.closePath();x.fill()}});
    const sunGroup=new THREE.Group();
    function mkSunSprite(tex,size,opacity,additive){const m=new THREE.SpriteMaterial({map:tex,transparent:true,opacity,fog:false,depthWrite:false});if(additive)m.blending=THREE.AdditiveBlending;const s=new THREE.Sprite(m);s.scale.set(size,size,1);return s}
    const sunHalo=mkSunSprite(sunHaloTex,230,.35,true);
    const sunRays=mkSunSprite(sunRaysTex,300,.3,true);
    const sunDisc=mkSunSprite(sunCoreTex,112,.98);
    sunGroup.add(sunHalo,sunRays,sunDisc);
    scene.add(sunGroup);

    // 月亮
    const moonDisc=new THREE.Mesh(
        new THREE.CircleGeometry(7,32),
        new THREE.MeshBasicMaterial({color:0xeeeedd,side:THREE.DoubleSide,transparent:true,opacity:.9,fog:false})
    );
    scene.add(moonDisc);

    // 星星
    // 星星：圆形发光点贴图 + 加色混合，避免方块覆盖整个画布
    function mkStarTex(){
        const c=document.createElement('canvas');c.width=c.height=64;
        const ctx=c.getContext('2d');
        const g=ctx.createRadialGradient(32,32,0,32,32,32);
        g.addColorStop(0,'rgba(255,255,255,1)');
        g.addColorStop(.25,'rgba(255,255,255,.85)');
        g.addColorStop(.5,'rgba(220,230,255,.4)');
        g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
        const t=new THREE.CanvasTexture(c);t.needsUpdate=true;return t;
    }
    const starTex=mkStarTex();
    const starGeo=new THREE.BufferGeometry();const starPos=new Float32Array(800*3);
    for(let i=0;i<800;i++){const th=Math.random()*Math.PI*2,ph=Math.acos(Math.random()*2-1),r=300+Math.random()*200;starPos[i*3]=r*Math.sin(ph)*Math.cos(th);starPos[i*3+1]=Math.abs(r*Math.cos(ph))+30;starPos[i*3+2]=r*Math.sin(ph)*Math.sin(th)}
    starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3));
    const starMat=new THREE.PointsMaterial({map:starTex,color:0xffffff,size:6,sizeAttenuation:true,transparent:true,opacity:0,fog:false,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending});
    const starPoints=new THREE.Points(starGeo,starMat);starPoints.renderOrder=-1;scene.add(starPoints);

    // 灯光
    const ambLight=new THREE.AmbientLight(0xffeedd,.6);scene.add(ambLight);
    const hemiLight=new THREE.HemisphereLight(0xbfe3ff,0x2a5a8a,.55);scene.add(hemiLight); // 天光/水面反光，模型更通透
    const moonLight=new THREE.DirectionalLight(0x8899cc,.0);moonLight.position.set(-5,8,-3);scene.add(moonLight);
    const sunLight=new THREE.DirectionalLight(0xfff5e0,2.0);sunLight.position.set(5,8,4);sunLight.castShadow=true;
    // 1536 阴影图 + normalBias：足够细腻，同时避免鸭子曲面 shadow acne 闪烁
    sunLight.shadow.mapSize.set(1536,1536);const sc=sunLight.shadow.camera;sc.near=1;sc.far=50;sc.left=sc.bottom=-12;sc.right=sc.top=12;sunLight.shadow.bias=-.0003;sunLight.shadow.normalBias=.03;scene.add(sunLight);
    scene.add(new THREE.DirectionalLight(0x6688cc,.3).translateX(-4).translateY(2).translateZ(-3));
    // 夜间补光不投影：省掉一整张 1024 阴影 Pass（光斑柔和，阴影几乎不可见）
    const duckSpot=new THREE.SpotLight(0xffeecc,0,60,Math.PI*.45,.2,1);scene.add(duckSpot);scene.add(duckSpot.target);

    // ===== 暴风雨特效（雨幕/水雾/闪电，画布覆盖层） =====
    const stormCv=document.getElementById('storm-fx');
    const stormCtx=stormCv.getContext('2d');
    let stormW=0,stormH=0;
    function sizeStormCv(){const dpr=quality.renderPixelRatio;stormW=innerWidth;stormH=innerHeight;stormCv.width=stormW*dpr;stormCv.height=stormH*dpr;stormCtx.setTransform(dpr,0,0,dpr,0,0)}
    sizeStormCv();
    // 闪电调度使用绝对 gameClock。客机只消费房主下发的“下一次”时间，绝不补算历史闪电。
    let duoBoltSeq=-1,duoBoltNextTime=0,stormCycleActive=false;
    let hostBoltSyncSeq=-Infinity,hostBoltSyncNext=-Infinity;
    const stormDebug={updates:0,totalTriggers:0,lastTriggers:0,maxTriggersPerUpdate:0,thunderCalls:0,audioBuffersCreated:0,camShakeWrites:0,lastUpdateMs:0,maxUpdateMs:0,lastThunderBuildMs:0,maxThunderBuildMs:0,enteredAt:null,history:[]};
    const rainDrops=[];for(let i=0;i<190;i++)rainDrops.push({x:duoRand(i+1),y:duoRand(i*7+3),v:.7+duoRand(i*13+5)*.6,l:.02+duoRand(i*17+7)*.03,a:.15+duoRand(i*23+11)*.3});
    const mistBlobs=[];for(let i=0;i<8;i++)mistBlobs.push({x:duoRand(i*31+13),y:.55+duoRand(i*37+17)*.5,r:.18+duoRand(i*41+19)*.22,vx:(duoRand(i*43+23)-.5)*.02,ph:duoRand(i*47+29)*6});
    let boltLife=0,boltPts=[],boltBranches=[];
    function genBolt(seed){
        boltPts=[];boltBranches=[];
        let bx=.15+duoRand(seed+1)*.7;
        boltPts.push([bx,-.02]);
        const segs=9+Math.floor(duoRand(seed+2)*5);
        for(let i=1;i<=segs;i++){
            const ny=i/segs*(.5+duoRand(seed+i*3+100)*.25);
            bx+=(duoRand(seed+i*5+200)-.5)*.09;
            boltPts.push([bx,ny]);
            if(duoRand(seed+i*7+300)<.35){ // 分叉
                const br=[[bx,ny]];let cx2=bx,cy2=ny;const dir=duoRand(seed+i*11+400)<.5?-1:1;
                for(let k=0;k<3;k++){cx2+=dir*(.02+duoRand(seed+i*13+k*17+500)*.05);cy2+=.03+duoRand(seed+i*19+k*23+600)*.04;br.push([cx2,cy2])}
                boltBranches.push(br);
            }
        }
    }
    function playThunder(delay){
        stormDebug.thunderCalls++;
        const audioCtx=getAudioCtx();
        if(!audioCtx||!getMusicOn())return;
        try{
            const buildStarted=performance.now();
            const dur=1.2+Math.random()*.8;
            const buf=audioCtx.createBuffer(1,audioCtx.sampleRate*dur,audioCtx.sampleRate);
            stormDebug.audioBuffersCreated++;
            const ch=buf.getChannelData(0);let last=0;
            for(let i=0;i<ch.length;i++){const w=Math.random()*2-1;last=(last+.03*w)/1.03;const t=i/ch.length;ch[i]=last*4*Math.pow(1-t,1.5)*Math.min(1,t*20)}
            const src=audioCtx.createBufferSource();src.buffer=buf;
            const f=audioCtx.createBiquadFilter();f.type='lowpass';f.frequency.value=320;
            const g=audioCtx.createGain();g.gain.value=.5;
            src.connect(f);f.connect(g);g.connect(audioCtx.destination);
            src.start(audioCtx.currentTime+delay);
            stormDebug.lastThunderBuildMs=performance.now()-buildStarted;
            stormDebug.maxThunderBuildMs=Math.max(stormDebug.maxThunderBuildMs,stormDebug.lastThunderBuildMs);
        }catch(e){}
    }
    function nextBoltDelay(seed,useHostRandom=false){
        return 2.2+(useHostRandom?Math.random():duoRand(seed))*4.5;
    }
    function beginStormCycle(gameClock){
        stormCycleActive=true;hostBoltSyncSeq=-Infinity;hostBoltSyncNext=-Infinity;
        stormDebug.enteredAt=gameClock;
        // 即使客机在对局进行很久后才收到首次暴风雨快照，首个闪电也只会排在“现在”之后。
        duoBoltNextTime=gameClock+nextBoltDelay(Math.floor(gameClock*100)+17,!duoIsGuest());
    }
    function endStormCycle(){
        stormCycleActive=false;duoBoltNextTime=0;
        hostBoltSyncSeq=-Infinity;hostBoltSyncNext=-Infinity;stormDebug.enteredAt=null;
    }
    function triggerBolt(gameClock){
        const scheduledTime=duoBoltNextTime;
        duoBoltSeq++;
        genBolt(duoBoltSeq*1000+Math.floor(scheduledTime*100));
        boltLife=.28;state.lightningFlash=1;state.camShake=.6;stormDebug.camShakeWrites++;
        playThunder(.2+(duoIsGuest()?duoRand(duoBoltSeq*7+13):Math.random())*.7);
        // 从当前时刻重新排期。不能在旧时间上累加，否则掉帧/晚加入会形成 catch-up 循环。
        duoBoltNextTime=gameClock+nextBoltDelay(duoBoltSeq*11+Math.floor(gameClock*10)+17,!duoIsGuest());
        stormDebug.lastTriggers++;stormDebug.totalTriggers++;
    }
    function getStormSync(){return{a:state.stormActive?1:0,s:duoBoltSeq,n:duoBoltNextTime}}
    function applyStormSync(sync){
        if(!duoIsGuest()||!sync||typeof sync!=='object')return;
        if(!sync.a){if(stormCycleActive)endStormCycle();return}
        const seq=Number(sync.s),next=Number(sync.n);
        if(!Number.isFinite(seq)||!Number.isFinite(next)||next<=0)return;
        // 同一个旧快照不能反复把客机时间拨回过去，否则仍会重复触发同一道闪电。
        const newer=seq>hostBoltSyncSeq||(seq===hostBoltSyncSeq&&next>hostBoltSyncNext+.001);
        if(!newer)return;
        if(!stormCycleActive)stormDebug.enteredAt=getGameClock();
        stormCycleActive=true;hostBoltSyncSeq=seq;hostBoltSyncNext=next;
        duoBoltSeq=seq;duoBoltNextTime=next;
    }
    function getStormDebug(){return{
        active:stormCycleActive,seq:duoBoltSeq,nextTime:duoBoltNextTime,
        updates:stormDebug.updates,totalTriggers:stormDebug.totalTriggers,lastTriggers:stormDebug.lastTriggers,
        maxTriggersPerUpdate:stormDebug.maxTriggersPerUpdate,thunderCalls:stormDebug.thunderCalls,
        audioBuffersCreated:stormDebug.audioBuffersCreated,camShakeWrites:stormDebug.camShakeWrites,
        lastUpdateMs:stormDebug.lastUpdateMs,maxUpdateMs:stormDebug.maxUpdateMs,
        lastThunderBuildMs:stormDebug.lastThunderBuildMs,maxThunderBuildMs:stormDebug.maxThunderBuildMs,
        enteredAt:stormDebug.enteredAt,history:stormDebug.history.slice()
    }}
    function finishStormDebug(updateStarted){
        stormDebug.lastUpdateMs=performance.now()-updateStarted;
        stormDebug.maxUpdateMs=Math.max(stormDebug.maxUpdateMs,stormDebug.lastUpdateMs);
    }
    function updateStormFx(dt){
        const updateStarted=performance.now();
        const sf=state.stormFactor,x=stormCtx,W=stormW,H=stormH;
        const gameClock=getGameClock();
        stormDebug.updates++;stormDebug.lastTriggers=0;
        if(state.stormActive&&!stormCycleActive)beginStormCycle(gameClock);
        else if(!state.stormActive&&stormCycleActive)endStormCycle();
        stormCv.style.opacity=Math.min(1,sf*1.4+(boltLife>0?1:0));
        if(sf<=0.01&&boltLife<=0){x.clearRect(0,0,W,H);finishStormDebug(updateStarted);return}
        x.clearRect(0,0,W,H);
        if(sf>0.01){
            // 屏幕水雾（边缘漂移的薄雾团 + 底部雨雾带）
            for(const b of mistBlobs){
                b.x+=b.vx*dt;b.ph+=dt*.3;
                if(b.x<-.2)b.x=1.2;if(b.x>1.2)b.x=-.2;
                const bx=b.x*W,by=(b.y+Math.sin(b.ph)*.03)*H,br=b.r*Math.max(W,H);
                const g=x.createRadialGradient(bx,by,0,bx,by,br);
                g.addColorStop(0,'rgba(205,220,238,'+(.1*sf)+')');g.addColorStop(1,'rgba(205,220,238,0)');
                x.fillStyle=g;x.fillRect(bx-br,by-br,br*2,br*2);
            }
            const g2=x.createLinearGradient(0,H*.6,0,H);
            g2.addColorStop(0,'rgba(190,205,228,0)');g2.addColorStop(1,'rgba(190,205,228,'+(.16*sf)+')');
            x.fillStyle=g2;x.fillRect(0,H*.6,W,H*.4);
            // 雨幕（带风斜的随机雨丝）
            // 双人模式：雨滴重置位置使用基于 gameClock 的确定性 PRNG，确保两端雨滴轨迹一致
            x.lineCap='round';
            const n=Math.floor(rainDrops.length*sf),slant=.16+Math.sin(gameClock*.7)*.05;
            for(let i=0;i<n;i++){const d=rainDrops[i];
                d.y+=d.v*dt*1.4;d.x+=d.v*dt*slant*.5;
                if(d.y>1.05){d.y=-.05;d.x=duoRand(gameClock*10+i*3.7+1)}
                if(d.x>1.05)d.x-=1.1;
                const px=d.x*W,py=d.y*H,len=d.l*H;
                x.strokeStyle='rgba(190,215,245,'+(d.a*sf)+')';x.lineWidth=1.4;
                x.beginPath();x.moveTo(px,py);x.lineTo(px-len*slant,py-len);x.stroke();
            }
            // 每次环境更新至多触发一次；落后的绝对时间会在 triggerBolt 内直接重排到当前时间之后。
            if(stormCycleActive&&gameClock>=duoBoltNextTime&&sf>.4)triggerBolt(gameClock);
        }
        stormDebug.maxTriggersPerUpdate=Math.max(stormDebug.maxTriggersPerUpdate,stormDebug.lastTriggers);
        if(stormDebug.lastTriggers){
            stormDebug.history.push({update:stormDebug.updates,clock:gameClock,triggers:stormDebug.lastTriggers,nextTime:duoBoltNextTime});
            if(stormDebug.history.length>32)stormDebug.history.shift();
        }
        // 闪电绘制（全屏闪光 + 分叉闪电链）
        if(boltLife>0){
            boltLife-=dt;
            const bl=Math.max(0,boltLife/.28);
            x.fillStyle='rgba(210,225,255,'+(bl*.35)+')';x.fillRect(0,0,W,H);
            x.save();
            x.shadowColor='rgba(180,220,255,.9)';x.shadowBlur=18;
            x.strokeStyle='rgba(255,255,255,'+(.95*bl)+')';x.lineWidth=3;x.lineJoin='round';
            x.beginPath();boltPts.forEach((p,i)=>i?x.lineTo(p[0]*W,p[1]*H):x.moveTo(p[0]*W,p[1]*H));x.stroke();
            x.lineWidth=1.6;
            for(const br of boltBranches){x.beginPath();br.forEach((p,i)=>i?x.lineTo(p[0]*W,p[1]*H):x.moveTo(p[0]*W,p[1]*H));x.stroke()}
            x.restore();
        }
        finishStormDebug(updateStarted);
    }

    // ===== 24小时天空关键帧（天顶/中带/地平线三色，余弦平滑插值） =====
    // 凌晨深蓝 → 日出金橙 → 上午蔚蓝 → 中午亮蓝 → 下午暖蓝 → 日落橘红 → 晚霞粉紫 → 夜晚深蓝
    // 红色只压在地平线低空色带（晚霞），天顶保持紫蓝，不会整片发红
    const SKY_KEYS=[ // [小时, 天顶色, 中带色, 地平线色]
        [0,0x030308,0x060612,0x0a0a18],[2.5,0x03030c,0x060616,0x0a0a1a],
        [4.5,0x1c1c46,0x353058,0x55406e],
        [5.5,0x3a4a82,0x9a7a90,0xf2ab7e],[6.5,0x4472ac,0xe0a498,0xf2d6ac],
        [8,0x2f7fc8,0x6fb2e4,0x9adcf5],[11,0x2a7ed2,0x74b8ec,0xaae0f8],
        [13,0x2f84ce,0x72b4e8,0xa6d8f2],[15.5,0x3a7ec2,0x7ab0dc,0xaad2ec],
        [17,0x4a5c9e,0xa88ca6,0xeab898],[17.8,0x5a5a9e,0xac8aa6,0xe6a48c],
        [18.6,0x444070,0x8d7394,0xcc8ea0],[19.4,0x0e0e22,0x1c1a34,0x282338],
        [20.5,0x040410,0x080818,0x0c0c1e],[22,0x03030c,0x060614,0x0a0a18]
    ];
    const _skyKeyA=new THREE.Color(),_skyKeyB=new THREE.Color(),_skyKeyC=new THREE.Color();
    function sampleSky(h,topOut,midOut,horOut){
        let i=0;
        while(i<SKY_KEYS.length-1&&SKY_KEYS[i+1][0]<=h)i++;
        const a=SKY_KEYS[i],b=SKY_KEYS[(i+1)%SKY_KEYS.length];
        let span=b[0]-a[0];if(span<=0)span+=24;
        let t=h-a[0];if(t<0)t+=24;t=Math.min(1,Math.max(0,t/span));
        t=(1-Math.cos(t*Math.PI))/2; // 余弦 easing，过渡更柔和
        topOut.setHex(a[1]).lerp(_skyKeyA.setHex(b[1]),t);
        midOut.setHex(a[2]).lerp(_skyKeyB.setHex(b[2]),t);
        horOut.setHex(a[3]).lerp(_skyKeyC.setHex(b[3]),t);
    }

    // ===== 昼夜 =====
    function setCartoonSky(time){
        const duckModel=getDuckModel();
        const angle=(time/24)*Math.PI*2-Math.PI/2;
        const sy=Math.sin(angle),sx=Math.cos(angle);
        sunGroup.position.set(sx*700,sy*700,0);
        moonDisc.position.set(-sx*250,-sy*250,-50);
        sunLight.position.set(sx*12,Math.max(sy*12,.5),5);
        const dayF=Math.max(0,Math.min(1,sy*2.5+.3));
        const nightF=Math.max(0,Math.min(1,-sy*2.5+.3));
        const sunsetF=Math.max(0,1-dayF-nightF);
        // 时段特效因子（供极光/流星/海鸥/动物云/晨雾系统读取）
        const h24=((time%24)+24)%24;
        timeFx.mist=h24>=4.5&&h24<7.5?Math.max(0,1-Math.abs(h24-6)/1.5):0;   // 日出晨雾（6点最浓）
        timeFx.aurora=h24>=0&&h24<5?Math.min(h24,5-h24,1):0;                 // 凌晨极光
        timeFx.meteor=h24>=19?Math.min(h24-19,1):0;                          // 夜晚流星
        timeFx.gull=h24>=7&&h24<11?Math.min(h24-7,11-h24,1):h24>=13&&h24<17?Math.min(h24-13,17-h24,1):0; // 上午/下午海鸥
        timeFx.noon=h24>=11&&h24<13?Math.min(h24-11,13-h24,1):0;             // 中午动物云
        state.envBright=Math.min(1,.22+dayF*.78+sunsetF*.4);                 // 环境亮度（自发光贴图昼夜变暗用）
        // 卡通天空颜色：24小时关键帧插值（凌晨/日出/上午/中午/下午/日落/晚霞/夜晚各有氛围）
        sampleSky(h24,skyMat.uniforms.topColor.value,skyMat.uniforms.midColor.value,skyMat.uniforms.horizonColor.value);
        // 晨雾：地平线微微泛白（淡淡的清晨感）
        if(timeFx.mist>0.01){skyMat.uniforms.horizonColor.value.lerp(_mistHor,timeFx.mist*.3);skyMat.uniforms.midColor.value.lerp(_mistHor,timeFx.mist*.15)}
        skyMat.uniforms.sunPos.value.set(sx,sy,0).normalize();
        skyMat.uniforms.sunColor.value.setHex(sunsetF>.3?0xff6633:0xffee88);
        // 灯光
        sunLight.intensity=dayF*2.0+sunsetF*1.2;
        sunLight.color.lerpColors(new THREE.Color(0xfff5e0),new THREE.Color(0xff8844),sunsetF);
        ambLight.intensity=.2+dayF*.5+nightF*.35;
        hemiLight.intensity=.12+dayF*.55+nightF*.18;
        // 中秋：满月更亮更大，夜晚也能看到月光
        const isMidAutumn=isFestival('festival_mid_autumn');
        moonLight.intensity=nightF*(isMidAutumn?2.6:1.2);
        moonLight.position.set(-sx*12,Math.max(-sy*12,.5),-5);
        starMat.opacity=nightF*.9;
        // 太阳/月亮可见性
        sunGroup.visible=sy>-.1;
        sunDisc.material.color.setHex(sunsetF>.3?0xff7744:0xfff2b0);
        sunDisc.material.opacity=dayF*.98+sunsetF*.85;
        sunHalo.material.opacity=dayF*.35+sunsetF*.45;
        sunRays.material.opacity=dayF*.3+sunsetF*.4;
        // 太阳光芒持续旋转：基于 gameClock 确定性计算（双人模式两端一致，且不受更新节流影响）
        sunRays.material.rotation=getGameClock()*.04;
        moonDisc.visible=-sy>-.1;moonDisc.material.opacity=nightF*(isMidAutumn?1:.9);
        moonDisc.scale.setScalar(isMidAutumn?1.9:1); // 中秋满月当空
        // 日落/晚霞时太阳更大更壮观
        const sunScale=1+sunsetF*.4;sunGroup.scale.set(sunScale,sunScale,1);
        // 云朵颜色（夜晚变暗，暴风雨变黑压压，日落/晚霞染成粉橘色）
        const stormFactor=state.stormFactor;
        _wc.set(0xffffff).lerp(_cloudNight,nightF).lerp(_cloudStorm,Math.min(1,stormFactor*.88));
        if(sunsetF>0.02)_wc.lerp(_cloudDusk,sunsetF*.75);
        cloudGroup.children.forEach(s=>{s.material.color.copy(_wc);s.material.opacity=.92-nightF*.35});
        // 水面颜色
        const waterDay=new THREE.Color(0x1a6aa8),waterNight=new THREE.Color(0x081628),waterSunset=new THREE.Color(0x8a3a30);
        waterMat.color.copy(waterDay).lerp(waterNight,nightF);
        if(sunsetF>.2)waterMat.color.lerp(waterSunset,sunsetF*.4);
        // 波浪顶点色（深水/浅水/泡沫）随昼夜变化
        waterColDeep.set(0x0e5f9e).lerp(new THREE.Color(0x041222),nightF);if(sunsetF>.15)waterColDeep.lerp(new THREE.Color(0x5a2a3a),sunsetF*.5);
        waterColLight.set(0x49b6e4).lerp(new THREE.Color(0x0e2c4a),nightF);if(sunsetF>.15)waterColLight.lerp(new THREE.Color(0xd06a45),sunsetF*.5);
        waterColFoam.set(0xeafcff).lerp(new THREE.Color(0x3a5a78),nightF);if(sunsetF>.15)waterColFoam.lerp(new THREE.Color(0xffc9a0),sunsetF*.5);
        // 雾色与地平线颜色一致，远处水面自然融入天空
        scene.fog.color.copy(skyMat.uniforms.horizonColor.value);
        // 极光以彩虹级亮度照亮夜空与水面，而不是只在远处隐约可见。
        const auroraGlow=timeFx.aurora*.55; // 极光峰值亮度减半（凌晨不再过曝）
        renderer.toneMappingExposure=.68+dayF*.36+sunsetF*.15+auroraGlow*.62;
        if(auroraGlow>0){ambLight.intensity+=auroraGlow*.55;hemiLight.intensity+=auroraGlow*.3}
        // 暴风雨：天空压暗、雾气拉近、水面变灰、能见度降低
        if(stormFactor>0.001){
            const sf=stormFactor;
            skyMat.uniforms.topColor.value.lerp(_stormSky,sf*.65);
            skyMat.uniforms.midColor.value.lerp(_stormHor,sf*.6);
            skyMat.uniforms.horizonColor.value.lerp(_stormHor,sf*.6);
            scene.fog.color.copy(skyMat.uniforms.horizonColor.value);
            scene.fog.near=60-34*sf;scene.fog.far=190-100*sf;
            waterColDeep.lerp(_stormWater,sf*.5);waterColLight.lerp(_stormWater,sf*.45);
            renderer.toneMappingExposure*=1-sf*.25;
        }else{
            // 日出晨雾：雾气稍稍拉近（淡淡的即可，与暴风雨互斥，暴风雨优先）
            scene.fog.near=60-18*timeFx.mist;scene.fog.far=190-55*timeFx.mist;
        }
        // 刮风事件：天空泛白偏冷，有风过的通透感
        if(timeFx.wind>0.01){
            skyMat.uniforms.topColor.value.lerp(_windTop,timeFx.wind*.16);
            skyMat.uniforms.midColor.value.lerp(_windHor,timeFx.wind*.22);
            skyMat.uniforms.horizonColor.value.lerp(_windHor,timeFx.wind*.24);
            scene.fog.color.copy(skyMat.uniforms.horizonColor.value);
        }
        // 闪电瞬间照亮场景
        const lightningFlash=state.lightningFlash;
        renderer.toneMappingExposure+=lightningFlash*.9;
        ambLight.intensity+=lightningFlash*2;
        if(duckModel){
            duckSpot.intensity=nightF*15+3;
            duckSpot.position.copy(duckModel.position);duckSpot.position.y+=2;
            duckSpot.target.position.copy(duckModel.position);duckSpot.target.position.y=-1;
        }
        // 时钟：仅在显示内容真正变化时才写 DOM。setCartoonSky 每 2~3 帧就调用一次，
        // 若每次都重写 textContent/innerHTML，会持续触发样式重算与重绘，白白占用主线程。
        const h=Math.floor(time)%24,m=Math.floor((time%1)*60);let period,icon;
        if(h>=5&&h<7){period='日出';icon='sunrise'}else if(h>=7&&h<11){period='上午';icon='fa-cloud-sun'}else if(h>=11&&h<13){period='中午';icon='fa-sun'}else if(h>=13&&h<17){period='下午';icon='fa-mountain-sun'}else if(h>=17&&h<19){period='日落';icon='sunset'}else if(h>=19&&h<24){period='夜晚';icon='fa-moon'}else if(h>=0&&h<5){period='凌晨';icon='fa-star'}else{period='凌晨';icon='fa-star'}
        if(h!==_clockH||m!==_clockM){_clockH=h;_clockM=m;document.getElementById('clock-text').textContent=`${period} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`}
        if(icon!==_clockIcon){_clockIcon=icon;const clockIconEl=document.querySelector('#clock-icon');
            if(icon==='sunrise'){clockIconEl.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/></svg>'}
            else if(icon==='sunset'){clockIconEl.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="16 5 12 9 8 5"/></svg>'}
            else{clockIconEl.innerHTML=`<i class="fa-solid ${icon}"></i>`}}
    }

    // ===== 天空氛围系统：凌晨极光 / 夜晚流星 / 上下午海鸥 / 中午动物云 / 彩虹拱门 / 晨雾+刮风滤镜 =====
    let cloudCreature=false;       // 中午动物云状态标记
    // ---- 动物云贴图：只保留鲸鱼（与普通云朵完全相同的 puff 三层画法，看起来就是一朵鲸鱼形状的云） ----
    function mkCreatureCloudTex(){
        return mkTex(512,288,(x)=>{
            x.translate(256,150);
            // 鲸鱼轮廓 = 一组大重叠 puff：圆润头部 + 流畅长身 + 收窄尾柄 + 上扬分叉尾鳍 + 腹部胸鳍
            // （去掉了原来的头顶喷水柱——不像云、很突兀）
            const puffs=[[-118,24,46],[-84,12,60],[-36,2,74],[18,-2,78],[72,-6,66],
                [116,-14,50],[148,-26,34],
                [172,-46,24],[190,-60,15],
                [176,-14,21],
                [-24,58,26],[6,62,18]];
            const puff=(px,py,pr,c0,c1)=>{
                const g=x.createRadialGradient(px,py,pr*.06,px,py,pr);
                g.addColorStop(0,c0);g.addColorStop(.62,c1);g.addColorStop(1,'rgba(255,255,255,0)');
                x.fillStyle=g;x.beginPath();x.arc(px,py,pr,0,Math.PI*2);x.fill();
            };
            // 1) 云底淡蓝灰阴影层（向下偏移，体积感）
            for(const[px,py,pr]of puffs)puff(px,py+pr*.34,pr*1.02,'rgba(148,182,216,.5)','rgba(158,192,222,.3)');
            // 2) 主体白色蓬松层
            for(const[px,py,pr]of puffs)puff(px,py,pr,'rgba(255,255,255,.98)','rgba(247,251,255,.88)');
            // 3) 顶部高光小 puff（棉花糖层次感）
            for(const[px,py,pr]of puffs)puff(px-pr*.14,py-pr*.3,pr*.52,'rgba(255,255,255,.92)','rgba(255,255,255,.4)');
        });
    }
    const creatureTexs=[mkCreatureCloudTex()];
    // ---- 凌晨极光：流体感帘幕（自然极光配色：翠绿主体 + 紫红裙边 + 蓝紫顶部，宽幅柔和大褶皱，无竖直细条纹） ----
    // 贴图方向：canvas y=0 → 圆柱顶部，y=128 → 圆柱底部；自然极光最亮处在帘幕下缘
    function mkAuroraTex(hue){
        const t=mkTex(512,128,(x)=>{
            const lg=x.createLinearGradient(0,0,0,128);
            if(hue===0){ // 主帘：翠绿主体（极高饱和）+ 紫红裙边 + 蓝紫顶部
                lg.addColorStop(0,'rgba(160,80,255,0)');
                lg.addColorStop(.22,'rgba(120,90,255,.45)');
                lg.addColorStop(.48,'rgba(20,245,155,.78)');
                lg.addColorStop(.7,'rgba(20,255,80,1)');
                lg.addColorStop(.88,'rgba(120,255,130,1)');
                lg.addColorStop(.95,'rgba(255,50,215,.85)');
                lg.addColorStop(1,'rgba(255,50,215,0)');
            }else{ // 副帘：蓝紫青主体（极高饱和）
                lg.addColorStop(0,'rgba(130,70,255,0)');
                lg.addColorStop(.28,'rgba(150,90,255,.48)');
                lg.addColorStop(.55,'rgba(45,125,255,.75)');
                lg.addColorStop(.78,'rgba(20,240,185,.9)');
                lg.addColorStop(.9,'rgba(100,255,230,1)');
                lg.addColorStop(1,'rgba(100,255,230,0)');
            }
            x.fillStyle=lg;x.fillRect(0,0,512,128);
            // 宽幅柔和褶皱（宽 50-120 的软边明暗带，随贴图流动 → 像河面波光一样的流体折叠）
            // 每条带画两次（x 与 x-512），保证横跨环绕接缝处连续、无竖直硬边
            x.globalCompositeOperation='destination-out';
            const band=(sx0,w,a)=>{
                for(const ox of[0,-512]){
                    const g2=x.createLinearGradient(sx0+ox,0,sx0+ox+w,0);
                    g2.addColorStop(0,'rgba(0,0,0,0)');g2.addColorStop(.5,'rgba(0,0,0,'+a+')');g2.addColorStop(1,'rgba(0,0,0,0)');
                    x.fillStyle=g2;x.fillRect(sx0+ox,0,w,128);
                }
            };
            for(let i=0;i<6;i++)band(Math.random()*512,50+Math.random()*70,.16+Math.random()*.22);
            // 大型幕段明暗（有的方位整段很暗 → 帘幕一段一段、此起彼伏，不再是完整一圈围栏）
            for(let i=0;i<3;i++)band(Math.random()*512,110+Math.random()*130,.35+Math.random()*.3);
            x.globalCompositeOperation='source-over';
        });
        t.wrapS=THREE.RepeatWrapping;return t;
    }
    const auroraGroup=new THREE.Group();
    // 360° 环形极光帘幕：开口圆柱环绕玩家一整圈，任何方向抬头都能看到
    function mkAuroraRing(tex,rad,h,y,rep){
        tex.wrapS=THREE.RepeatWrapping;tex.repeat.set(rep,1);
        const geo=new THREE.CylinderGeometry(rad,rad,h,72,1,true);
        const mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,fog:false,blending:THREE.AdditiveBlending});
        const m=new THREE.Mesh(geo,mat);
        m.position.y=y;
        m.userData.base=geo.attributes.position.array.slice();
        auroraGroup.add(m);return m;
    }
    const aurora1=mkAuroraRing(mkAuroraTex(0),255,80,44,2); // 翠绿主帘（外圈，2 次环绕重复——大结构幕段）——抬高让紫红裙边刚好露出地平线
    const aurora2=mkAuroraRing(mkAuroraTex(1),222,60,38,2); // 蓝紫副帘（内圈）
    auroraGroup.visible=false;scene.add(auroraGroup);
    function updateAuroraRing(m,dt,f,ph,spd){
        const p=m.geometry.attributes.position,base=m.userData.base,t=getGameClock();
        for(let i=0;i<p.count;i++){
            const bx=base[i*3],bz=base[i*3+2];
            const az=Math.atan2(bz,bx); // 按方位角做波浪，整圈帘幕起伏（三个谐波叠加，更不像规则围栏）
            p.setY(i,base[i*3+1]+Math.sin(az*4+t*.8+ph)*9+Math.sin(az*7-t*.5+ph)*5+Math.sin(az*2+t*.3+ph*2)*6);
        }
        p.needsUpdate=true;
        m.material.map.offset.x+=dt*spd; // 内外两层反向流动 → 流体干涉感
        m.material.opacity=Math.min(1,f*(1.3+Math.sin(t*.4+ph)*.22)); // 彩虹级亮度
        m.material.color.setScalar(1+f*.35); // 轻 HDR 增益：加法混合下更鲜艳但不洗白
    }
    // ---- 夜晚流星：黄色亮头 + 白色拖尾（光晕照亮周围天空），沿速度方向划过 ----
    const meteorTex=mkTex(224,112,(x)=>{
        // 白色拖尾（头部亮、尾部渐隐）
        const g=x.createLinearGradient(0,0,196,0);
        g.addColorStop(0,'rgba(200,220,255,0)');g.addColorStop(.6,'rgba(230,240,255,.5)');g.addColorStop(1,'rgba(255,255,255,.95)');
        x.fillStyle=g;
        x.beginPath();x.moveTo(8,56);x.lineTo(178,47);x.lineTo(192,56);x.lineTo(178,65);x.closePath();x.fill();
        // 黄色亮头（白热核心 → 金黄外焰）
        const hg=x.createRadialGradient(186,56,0,186,56,17);
        hg.addColorStop(0,'rgba(255,252,230,1)');hg.addColorStop(.35,'rgba(255,222,120,.95)');hg.addColorStop(1,'rgba(255,190,60,0)');
        x.fillStyle=hg;x.beginPath();x.arc(186,56,17,0,Math.PI*2);x.fill();
        // 圆形光晕（画布够高不裁切，照亮周围天空）
        const halo=x.createRadialGradient(180,56,4,180,56,50);
        halo.addColorStop(0,'rgba(255,242,200,.42)');halo.addColorStop(.5,'rgba(220,235,255,.16)');halo.addColorStop(1,'rgba(180,210,255,0)');
        x.fillStyle=halo;x.beginPath();x.arc(180,56,50,0,Math.PI*2);x.fill();
    });
    const meteors=[];
    for(let i=0;i<8;i++){
        const m=new THREE.Sprite(new THREE.SpriteMaterial({map:meteorTex,transparent:true,opacity:0,fog:false,depthWrite:false,blending:THREE.AdditiveBlending}));
        m.scale.set(62,31,1);m.visible=false;scene.add(m);
        meteors.push({s:m,life:0,dur:1,vx:0,vy:0,vz:0,wait:.6+i*1.1,seq:i});
    }
    function spawnMeteor(m){
        const duckModel=getDuckModel();
        const cx=duckModel?duckModel.position.x:0,cz=duckModel?duckModel.position.z:0;
        // 朝向相机视野前方半球生成（玩家抬头就能看到），低空横跨
        // 双人模式：使用基于 gameClock 和流星序号的确定性 PRNG，确保两端流星轨迹一致
        const gameClock=getGameClock();
        const seed=gameClock*100+m.seq*7.3;
        const lookAz=Math.atan2(cz-camera.position.z,cx-camera.position.x);
        const az=lookAz+(duoRand(seed+1)-.5)*1.5,dist=240+duoRand(seed+2)*120;
        m.s.position.set(cx+Math.cos(az)*dist,40+duoRand(seed+3)*70,cz+Math.sin(az)*dist);
        // 速度：横向划过视野 + 下坠分量
        const ta=az+Math.PI/2+(duoRand(seed+4)-.5)*.5;
        const spd=150+duoRand(seed+5)*70;
        const sd=duoRand(seed+6)<.5?1:-1;
        m.vx=Math.cos(ta)*spd*sd;m.vz=Math.sin(ta)*spd*sd;m.vy=-(25+duoRand(seed+7)*55);
        m.life=0;m.dur=.9+duoRand(seed+8)*.6;m.s.visible=true;
    }
    const _mv1=new THREE.Vector3(),_mv2=new THREE.Vector3();
    function updateMeteors(dt){
        const f=timeFx.meteor;
        const gameClock=getGameClock();
        for(let i=0;i<meteors.length;i++){
            const m=meteors[i];
            if(f<=0.01){m.s.visible=false;m.wait=.6+duoRand(i*3.7+gameClock*10+1)*2.5;continue}
            if(m.wait>0){m.wait-=dt;m.s.visible=false;if(m.wait<=0)spawnMeteor(m);continue}
            m.life+=dt;
            if(m.life>=m.dur){m.s.visible=false;m.wait=.8+duoRand(i*7.3+gameClock*10+2)*2.5;continue}
            const p=m.s.position;
            p.x+=m.vx*dt;p.y+=m.vy*dt;p.z+=m.vz*dt;
            m.s.material.opacity=f*Math.sin(Math.PI*m.life/m.dur)*.95;
            // 尾迹朝向：把速度投影到屏幕空间，旋转贴图对齐
            _mv1.copy(p).project(camera);
            _mv2.set(p.x+m.vx,p.y+m.vy,p.z+m.vz).project(camera);
            m.s.material.rotation=Math.atan2(_mv2.y-_mv1.y,_mv2.x-_mv1.x);
        }
    }
    // ---- 上午/下午海鸥：三帧扇翅贴图，成群横穿天空 ----
    function mkGullTex(frame){
        return mkTex(96,96,(x)=>{
            x.translate(48,54);x.lineCap='round';
            const a=frame===0?-1:frame===1?-.1:.8; // 翅膀抬升角：上/平/下
            const draw=(color,lw)=>{
                x.strokeStyle=color;x.lineWidth=lw;
                x.beginPath();x.moveTo(-5,2);x.quadraticCurveTo(1,-3,9,0);x.stroke(); // 小身体
                for(const s of[-1,1]){x.beginPath();x.moveTo(s*2,0);x.quadraticCurveTo(s*16,-7+a*6,s*31,a*20);x.stroke()}
            };
            draw('rgba(120,145,170,.6)',8);   // 淡蓝灰描边（让白鸥在蓝天中显出轮廓）
            draw('rgba(252,253,255,.97)',4.5); // 白色鸥身
        });
    }
    const gullTexs=[mkGullTex(0),mkGullTex(1),mkGullTex(2)];
    const gulls=[];
    for(let i=0;i<6;i++){
        const m=new THREE.Sprite(new THREE.SpriteMaterial({map:gullTexs[1],transparent:true,opacity:0,fog:false,depthWrite:false}));
        m.scale.set(3.4,3.4,1);m.visible=false;scene.add(m);
        // 大部分低空掠水面（正常视角可见），少数高空盘旋
        // 双人模式：使用 duoRand 确保两端海鸥初始位置和飞行参数一致
        const low=i<4;
        gulls.push({s:m,ang:duoRand(i*3+1)*Math.PI*2,rad:low?18+duoRand(i*5+3)*32:45+duoRand(i*7+5)*35,
            spd:(.22+duoRand(i*11+7)*.18)*(duoRand(i*13+9)<.5?1:-1), // 绕玩家盘旋（角速度，确定性顺/逆时针）
            yBase:low?2.8+duoRand(i*17+11)*3.5:12+duoRand(i*19+13)*10,bobPh:duoRand(i*23+17)*6,frameT:duoRand(i*29+19)*3,fi:1,wait:.6+i*.9,seq:i});
    }
    function updateGulls(dt){
        const f=timeFx.gull;
        const duckModel=getDuckModel();
        const cx=duckModel?duckModel.position.x:0,cz=duckModel?duckModel.position.z:0;
        const gameClock=getGameClock();
        for(let i=0;i<gulls.length;i++){
            const g=gulls[i];
            if(f<=0.01){g.s.visible=false;g.wait=.5+duoRand(i*3.7+gameClock*10+1)*2;continue}
            if(g.wait>0){g.wait-=dt;g.s.visible=false;continue}
            g.s.visible=true;
            // 盘旋飞行：绕鸭子中距离环绕 + 上下起伏，定期掠过视野
            g.ang+=g.spd*dt;
            g.bobPh+=dt*2.1;
            const r=g.rad+Math.sin(g.bobPh*.45)*7;
            const p=g.s.position;
            p.x=cx+Math.cos(g.ang)*r;p.z=cz+Math.sin(g.ang)*r;
            p.y=Math.max(2.2,g.yBase+Math.sin(g.bobPh)*1.4); // 不低于水面太多
            g.frameT+=dt*7;
            const fi=Math.floor(g.frameT)%3;
            if(fi!==g.fi){g.fi=fi;g.s.material.map=gullTexs[fi]}
            g.s.material.opacity=f;
        }
    }
    // ---- 彩虹祝福：天空中的七彩拱门（连续光谱色带 + 软边，背离太阳方向，跟随玩家） ----
    const rainbowTex=mkTex(640,320,(x)=>{
        const cx=320,cy=312;
        // 主虹：逐半径连续光谱弧，外红(0°)内紫(275°)，正弦软边
        const R0=168,R1=238;
        for(let r=R0;r<=R1;r+=1.2){
            const t=(r-R0)/(R1-R0);
            const hue=t*275;
            const a=Math.sin(Math.pow(t,.85)*Math.PI)*.62;
            x.strokeStyle='hsla('+hue+',92%,56%,'+a+')';
            x.lineWidth=3;
            x.beginPath();x.arc(cx,cy,r,Math.PI,0);x.stroke();
        }
        // 霓（副虹）：更大半径、颜色反转（外紫内红）、亮度约主虹45%，中间自然形成暗带
        const S0=272,S1=316;
        for(let r=S0;r<=S1;r+=1.4){
            const t=(r-S0)/(S1-S0);
            const hue=275-t*275;
            const a=Math.sin(t*Math.PI)*.28;
            x.strokeStyle='hsla('+hue+',85%,60%,'+a+')';
            x.lineWidth=3;
            x.beginPath();x.arc(cx,cy,r,Math.PI,0);x.stroke();
        }
        // 主虹内侧天空微微泛亮（真实彩虹效应：虹内天空比虹外亮）
        const inner=x.createRadialGradient(cx,cy,20,cx,cy,R0);
        inner.addColorStop(0,'rgba(255,255,255,.10)');inner.addColorStop(1,'rgba(255,255,255,0)');
        x.fillStyle=inner;x.beginPath();x.arc(cx,cy,R0,Math.PI,0);x.fill();
        // 径向+垂直渐隐，让彩虹柔和融入天空（两端溶于地平线）
        x.globalCompositeOperation='destination-in';
        const g=x.createRadialGradient(cx,cy,80,cx,cy,330);
        g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(.45,'rgba(0,0,0,.85)');g.addColorStop(.8,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');
        x.fillStyle=g;x.fillRect(0,0,640,320);
        const gv=x.createLinearGradient(0,0,0,320);
        gv.addColorStop(0,'rgba(0,0,0,1)');gv.addColorStop(.82,'rgba(0,0,0,.92)');gv.addColorStop(1,'rgba(0,0,0,0)');
        x.fillStyle=gv;x.fillRect(0,0,640,320);
        x.globalCompositeOperation='source-over';
    });
    const rainbowSpr=new THREE.Sprite(new THREE.SpriteMaterial({map:rainbowTex,transparent:true,opacity:0,fog:false,depthWrite:false}));
    rainbowSpr.scale.set(470,235,1);rainbowSpr.visible=false;scene.add(rainbowSpr);
    // ---- 屏幕氛围画布：日出晨雾 + 刮风风线 ----
    const skyFxCv=document.getElementById('sky-fx');
    const skyFxCtx=skyFxCv.getContext('2d');
    let skyFxW=0,skyFxH=0;
    function sizeSkyFx(){const dpr=quality.renderPixelRatio;skyFxW=innerWidth;skyFxH=innerHeight;skyFxCv.width=skyFxW*dpr;skyFxCv.height=skyFxH*dpr;skyFxCtx.setTransform(dpr,0,0,dpr,0,0)}
    sizeSkyFx();
    const mistPuffs=[];for(let i=0;i<16;i++)mistPuffs.push({x:duoRand(i*3+1),y:.3+duoRand(i*5+3)*.65,r:.22+duoRand(i*7+5)*.3,vx:.008+duoRand(i*11+7)*.02,ph:duoRand(i*13+9)*6});
    const windStreaks=[];for(let i=0;i<18;i++)windStreaks.push({x:duoRand(i*17+11),y:duoRand(i*19+13),v:.55+duoRand(i*23+17)*.6,l:.05+duoRand(i*29+19)*.1,a:.16+duoRand(i*31+23)*.26});
    // 中午镜头光晕（全动态拟真）：实时跟踪太阳投影位置，视角转动时光晕/光圈/鬼影全部跟着变
    // 强度随太阳离画面中心的角距离衰减；太阳在头顶时从顶部渗入，在背后时消退（接近真实镜头）
    const _sunV=new THREE.Vector3(),_cf=new THREE.Vector3();
    function drawLensFlare(x,W,H,nf){
        _sunV.copy(sunGroup.position).project(camera);
        const R=Math.max(W,H);
        let sx,sy,vis;
        if(sunGroup.position.y>420){
            // 正午：太阳近天顶，屏幕投影不可靠。改为按"太阳方位角 vs 相机朝向"动态定位：
            // 朝太阳方位看 → 光从顶部中央洒落；转头 → 光斑沿顶部横移（sin(dAz) 即屏幕右方投影）；背对 → 消退
            camera.getWorldDirection(_cf);
            const sunAz=Math.atan2(sunGroup.position.z,sunGroup.position.x);
            const camAz=Math.atan2(_cf.z,_cf.x);
            let dAz=sunAz-camAz;while(dAz>Math.PI)dAz-=Math.PI*2;while(dAz<-Math.PI)dAz+=Math.PI*2;
            vis=Math.max(0,Math.cos(dAz))*.55;
            if(vis<=0)return;
            sx=W/2+Math.sin(dAz)*W*.5;sy=-H*.03;
        }else if(_sunV.z<1){
            // 太阳在相机前方：真实屏幕位置（可能在画面外）
            sx=(_sunV.x*.5+.5)*W;sy=(-_sunV.y*.5+.5)*H;
            // 离屏越近越亮：屏内=1，屏外按边缘距离衰减（最大 H*.45 处熄灭）
            const outX=Math.max(0,Math.max(-sx,sx-W)),outY=Math.max(0,Math.max(-sy,sy-H));
            const outD=Math.hypot(outX,outY);
            vis=Math.max(0,1-outD/(H*.45));
        }else{return}
        // 呼吸微闪（自然的亮度波动）
        const gameClock=getGameClock();
        vis*=nf*(.9+Math.sin(gameClock*3.7)*.1);
        if(vis<=0.02)return;
        // 光晕锚点：钳制到屏幕内（屏外太阳 → 光从最近边缘渗入）
        const fx=Math.max(W*.08,Math.min(W*.92,sx)),fy=Math.max(H*.05,Math.min(H*.8,sy));
        const cx2=W/2,cy2=H/2;
        // 主光晕（大而柔和的金白光晕，边缘完全晕开，无任何硬边/线条）
        let g=x.createRadialGradient(fx,fy,0,fx,fy,R*.22);
        g.addColorStop(0,'rgba(255,252,235,'+(.62*vis)+')');g.addColorStop(.4,'rgba(255,240,190,'+(.3*vis)+')');g.addColorStop(1,'rgba(255,225,160,0)');
        x.fillStyle=g;x.fillRect(fx-R*.22,fy-R*.22,R*.44,R*.44);
        // 柔亮核心（圆形，原始版本）
        g=x.createRadialGradient(fx,fy,0,fx,fy,R*.07);
        g.addColorStop(0,'rgba(255,255,250,'+(.85*vis)+')');g.addColorStop(.5,'rgba(255,248,220,'+(.35*vis)+')');g.addColorStop(1,'rgba(255,250,220,0)');
        x.fillStyle=g;x.beginPath();x.arc(fx,fy,R*.07,0,Math.PI*2);x.fill();
        // 中心星形光芒（类似 * 的 6 道射线，柔和版：中间仅 25% 透明度，往外渐亮再淡出）
        x.save();x.translate(fx,fy);
        const sR=R*.2;
        for(let k=0;k<6;k++){
            const ang=k*Math.PI/3;
            const ex=Math.cos(ang)*sR,ey=Math.sin(ang)*sR;
            // 中心固定 25% 透明度，往外渐亮到 50%，再淡出到 0
            const grd=x.createLinearGradient(0,0,ex,ey);
            grd.addColorStop(0,'rgba(255,250,230,'+(.25*vis)+')');
            grd.addColorStop(.5,'rgba(255,246,215,'+(.4*vis)+')');
            grd.addColorStop(.85,'rgba(255,240,200,'+(.32*vis)+')');
            grd.addColorStop(1,'rgba(255,236,180,0)');
            x.strokeStyle=grd;x.lineWidth=Math.max(1.5,R*.014);x.lineCap='round';
            x.beginPath();x.moveTo(0,0);x.lineTo(ex,ey);x.stroke();
        }
        x.restore();
        // 光圈环（圆形，原始版本）
        g=x.createRadialGradient(fx,fy,R*.08,fx,fy,R*.2);
        g.addColorStop(0,'rgba(255,250,220,0)');
        g.addColorStop(.55,'rgba(255,244,200,'+(.32*vis)+')');
        g.addColorStop(.78,'rgba(255,228,150,'+(.22*vis)+')');
        g.addColorStop(1,'rgba(255,220,140,0)');
        x.fillStyle=g;x.beginPath();x.arc(fx,fy,R*.2,0,Math.PI*2);x.fill();
        // 水平眩光带：椭圆径向渐变压扁而成，整条都是晕开的光，看不见"线"
        x.save();x.translate(fx,fy);x.scale(1,.07);
        g=x.createRadialGradient(0,0,0,0,0,R*.45);
        g.addColorStop(0,'rgba(255,248,220,'+(.28*vis)+')');g.addColorStop(.6,'rgba(255,242,200,'+(.12*vis)+')');g.addColorStop(1,'rgba(255,240,200,0)');
        x.fillStyle=g;x.beginPath();x.arc(0,0,R*.45,0,Math.PI*2);x.fill();
        x.restore();
        // 六边形彩色鬼影：沿"太阳锚点→画面中心"连线排布的六边形光斑（径向渐变 + 描边，更像真实镜头鬼影的几何折射）
        const ghosts=[[.25,.026,'255,170,140'],[.45,.036,'255,220,170'],[.65,.048,'180,230,255'],[.85,.06,'200,255,220'],[1.05,.075,'255,200,180']];
        for(const[t,gr,col]of ghosts){
            const gx=fx+(cx2-fx)*t,gy=fy+(cy2-fy)*t,rr=gr*R;
            x.beginPath();
            for(let k=0;k<6;k++){const ha=Math.PI/6+k*Math.PI/3,hx=gx+Math.cos(ha)*rr,hy=gy+Math.sin(ha)*rr;k?x.lineTo(hx,hy):x.moveTo(hx,hy)}
            x.closePath();
            g=x.createRadialGradient(gx,gy,rr*.15,gx,gy,rr);
            g.addColorStop(0,'rgba('+col+','+(.18*vis)+')');g.addColorStop(.85,'rgba('+col+','+(.08*vis)+')');g.addColorStop(1,'rgba('+col+',0)');
            x.fillStyle=g;x.fill();
            x.strokeStyle='rgba('+col+','+(.3*vis)+')';x.lineWidth=Math.max(1,R*.002);x.stroke();
        }
        // 大彩虹环鬼影（参考图右下角的光谱圆环）：真实镜头鬼影关于画面中心点对称 → 放在锚点的中心对称点，必然在画面内
        const rx=2*cx2-fx,ry=2*cy2-fy,rr2=R*.12;
        for(let k=0;k<24;k++){
            x.strokeStyle='hsla('+(k*15)+',95%,68%,'+(.2*vis)+')';
            x.lineWidth=R*.014;
            x.beginPath();x.arc(rx,ry,rr2,k/24*Math.PI*2,(k+1)/24*Math.PI*2);x.stroke();
        }
    }
    function updateSkyFx(dt){
        const mf=timeFx.mist,wf=timeFx.wind,x=skyFxCtx,W=skyFxW,H=skyFxH;
        const stormFactor=state.stormFactor;
        const lf=timeFx.noon*(stormFactor>.3?0:1); // 中午镜头光晕（暴风雨时太阳被遮住）
        const vis=Math.max(mf,wf,lf);
        skyFxCv.style.opacity=Math.min(1,vis*1.3);
        if(vis<=0.01){x.clearRect(0,0,W,H);return}
        x.clearRect(0,0,W,H);
        if(lf>0.01)drawLensFlare(x,W,H,lf);
        if(mf>0.01){
            // 漂移雾团（淡淡的薄雾，只需一点点朦胧感）
            for(const b of mistPuffs){
                b.x+=b.vx*dt;b.ph+=dt*.25;
                if(b.x>1.25)b.x=-.25;
                const bx=b.x*W,by=(b.y+Math.sin(b.ph)*.03)*H,br=b.r*Math.max(W,H);
                const g=x.createRadialGradient(bx,by,0,bx,by,br);
                g.addColorStop(0,'rgba(236,242,248,'+(.08*mf)+')');g.addColorStop(1,'rgba(236,242,248,0)');
                x.fillStyle=g;x.fillRect(bx-br,by-br,br*2,br*2);
            }
            // 底部薄雾带（贴水面一层，不糊全屏）
            const g2=x.createLinearGradient(0,H*.68,0,H);
            g2.addColorStop(0,'rgba(232,240,246,0)');g2.addColorStop(1,'rgba(232,240,246,'+(.14*mf)+')');
            x.fillStyle=g2;x.fillRect(0,H*.68,W,H*.32);
        }
        if(wf>0.01){
            // 刮风：斜向高速风线（轻微上扬，有风呼啸感）
            x.lineCap='round';
            const gameClock=getGameClock();
            for(let i=0;i<windStreaks.length;i++){
                const s=windStreaks[i];
                s.x+=s.v*dt*1.5;
                if(s.x>1.2){s.x=-.2-s.l;s.y=duoRand(gameClock*10+i*4.1+1)}
                const px=s.x*W,py=s.y*H,len=s.l*W,sl=len*.14;
                x.strokeStyle='rgba(255,255,255,'+(s.a*wf)+')';x.lineWidth=2;
                x.beginPath();x.moveTo(px,py);x.lineTo(px+len,py-sl);x.stroke();
            }
        }
    }
    // ---- 统一更新：事件滤镜强度平滑 + 各氛围特效 ----
    function updateSkyAmbience(dt){
        const duckModel=getDuckModel();
        const gameClock=getGameClock();
        timeFx.wind+=((state.windActive?1:0)-timeFx.wind)*Math.min(1,dt*1.5);
        timeFx.rainbow+=((state.rainbowActive?1:0)-timeFx.rainbow)*Math.min(1,dt*1.2);
        // 凌晨极光（跟随玩家平移，360° 环形帘幕环绕玩家）
        const af=timeFx.aurora;
        auroraGroup.visible=af>0.01;
        if(af>0.01){
            if(duckModel){auroraGroup.position.x=duckModel.position.x;auroraGroup.position.z=duckModel.position.z}
            updateAuroraRing(aurora1,dt,af,0,.03);updateAuroraRing(aurora2,dt,af,2.1,-.022);
        }
        updateMeteors(dt);
        updateGulls(dt);
        // 彩虹拱门（事件触发瞬间锚定在相机视野前方，之后固定在世界中平滑跟随玩家）
        // 双人模式：彩虹方位角偏移使用基于 gameClock 的确定性 PRNG，确保两端彩虹位置一致
        const rf=timeFx.rainbow;
        const rainbowActive=state.rainbowActive;
        if(rainbowActive&&!updateSkyAmbience._rbWas&&duckModel){
            const lookAz=Math.atan2(duckModel.position.z-camera.position.z,duckModel.position.x-camera.position.x);
            updateSkyAmbience._rbAz=lookAz+(duoRand(gameClock*100+1)-.5)*.5;
        }
        updateSkyAmbience._rbWas=rainbowActive;
        rainbowSpr.visible=rf>0.01;
        if(rf>0.01){
            rainbowSpr.material.opacity=rf*.85*(.9+Math.sin(gameClock*1.7)*.1);
            if(duckModel){
                const az=updateSkyAmbience._rbAz||0;
                const tx=duckModel.position.x+Math.cos(az)*290,tz=duckModel.position.z+Math.sin(az)*290;
                rainbowSpr.position.x+=(tx-rainbowSpr.position.x)*Math.min(1,dt*.8);
                rainbowSpr.position.z+=(tz-rainbowSpr.position.z)*Math.min(1,dt*.8);
                rainbowSpr.position.y=56;
            }
        }
        // 中午动物云：进入/离开中午时段时只设定变形目标和确定性错开延迟，实际形变在 updateClouds 中缓慢进行
        // 双人模式：使用 duoRand 确保两端云朵变形选择和延迟一致
        const wantCreature=timeFx.noon>.5;
        if(wantCreature!==cloudCreature){
            cloudCreature=wantCreature;
            for(let ci=0;ci<clouds.length;ci++){
                const c=clouds[ci];
                if(cloudCreature){
                    c.creature=duoRand(ci*3.7+gameClock*10+1)<.22; // 约1/5的云变成大鲸鱼（好几朵普通云的大小）
                    if(c.creature){c.morphT=1;c.morphDelay=duoRand(ci*7.3+gameClock*10+2)*12} // 12秒内陆续开始变形
                }else if(c.creature){
                    c.morphT=0;c.morphDelay=duoRand(ci*11.7+gameClock*10+3)*8; // 8秒内陆续变回普通云
                }
            }
        }
    }
    // 调试钩子：检查天空氛围特效状态
    window.__skyTest={
        timeFx:()=>JSON.parse(JSON.stringify(timeFx)),
        meteors:()=>meteors.map(m=>({v:m.s.visible,o:+m.s.material.opacity.toFixed(2)})),
        gulls:()=>gulls.map(g=>({v:g.s.visible,y:+g.s.position.y.toFixed(0)})),
        creature:()=>{const duckModel=getDuckModel();return{on:cloudCreature,n:clouds.filter(c=>c.creature).length,m:clouds.filter(c=>c.creature||c.morph>0).map(c=>+c.morph.toFixed(2))}},
        aurora:()=>({vis:auroraGroup.visible,op:+aurora1.material.opacity.toFixed(2)}),
        clouds:()=>{const duckModel=getDuckModel();return clouds.map(c=>({a:+Math.atan2(c.s.position.z-(duckModel?duckModel.position.z:0),c.s.position.x-(duckModel?duckModel.position.x:0)).toFixed(2),cr:c.creature?1:0,o:+c.s.material.opacity.toFixed(2)}))},
    };

    // ===== 调试：切换时段 / 直接设置时间 =====
    let _timeIdx=0;
    function cycleTime(){const ts=[6,9,12,15,18,20,0];_timeIdx=(_timeIdx+1)%ts.length;state.timeOfDay=ts[_timeIdx]}
    function setTime(h){state.timeOfDay=h}

    // ===== 窗口尺寸变化时重置画布 =====
    function resize(){sizeStormCv();sizeSkyFx()}

    return {
        setCartoonSky,
        updateClouds,
        updateStormFx,
        updateSkyFx,
        updateSkyAmbience,
        getStormSync,
        applyStormSync,
        getStormDebug,
        cycleTime,
        setTime,
        resize,
        sunLight, // main.js 阴影系统可能引用
    };
}
