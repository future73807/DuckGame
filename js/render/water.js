// 水面渲染：深水底板 / 波浪层 / 唯一 waveHeight 实现 / 贴浪面圆环圆盘工具
// 依赖通过 createWater(ctx) 注入：
//   - scene: THREE.Scene
//   - quality: 画质状态对象（waveUpdateHz / stormWaveUpdateHz / waveNormalHz）
//   - getFrameCount: () => number （旧调用兼容；水面更新不再依赖帧计数）
//   - getWaveEventDir: () => {x, z}  （海浪事件方向 getter）
//   - state: 共享状态对象，含 waveBoost/waveClock/waveSpeed/renderedWaveClock 的 getter/setter 与 whirlZones 数组
// 返回：
//   - waveHeight(x,z,t): 唯一波浪高度函数（水面/鸭子/道具/漩涡共用）
//   - renderedWaveHeight(x,z): 当前可见水网格的三角插值高度（大型漂浮物贴合低细分浪面用）
//   - mkWaveRing/mkWaveDisk: 贴浪面网格工具
//   - setWaveDetail(segments): 切换波浪细分
//   - updatePhase(dt, waveSpeedTarget): 推进波浪相位
//   - followTarget(x, z): 水面网格跟随目标
//   - updateVertices(gameClock,targetX,targetZ,nowMs): 按时间调度更新波浪顶点位移与顶点色
//   - getUpdateStats(): 返回波面实际更新次数与更新间隔统计
//   - waterMesh/waveMesh/waterMat/waterColDeep/waterColLight/waterColFoam: 供环境系统昼夜调色

import * as THREE from 'three';
import {createRafTimeGate} from './time-gate.js';

/**
 * 创建水面渲染系统
 * @param {{scene:THREE.Scene,quality:object,getFrameCount:()=>number,getWaveEventDir:()=>{x:number,z:number},state:object}} ctx
 */
export function createWater(ctx){
    const {scene,quality,getWaveEventDir,state}=ctx;

    // ===== 波浪更新时间调度 =====
    // 不再用 frameCount % N：窗口被浏览器降到约 30 FPS 时，按帧取模会产生 33/66ms 交替，
    // 令水面、鸭子和相机的垂直位置呈阶梯跳动。时间闸口在接近目标频率时允许每个 rAF 更新一次。
    const DEFAULT_WAVE_HZ=60,DEFAULT_STORM_WAVE_HZ=60,DEFAULT_NORMAL_HZ=10;
    let pendingWaveX=0,pendingWaveZ=0;
    let lastSurfaceUpdateMs=null;
    const surfaceTimeGate=createRafTimeGate({defaultHz:DEFAULT_WAVE_HZ,fullRateEnabled:true});
    const normalTimeGate=createRafTimeGate({defaultHz:DEFAULT_NORMAL_HZ,fullRateEnabled:false});
    const updateStats={updates:0,maxGapMs:0,lastGapMs:0};
    const stats=Object.freeze({
        get updates(){return updateStats.updates},
        get maxGapMs(){return updateStats.maxGapMs},
        get lastGapMs(){return updateStats.lastGapMs},
    });

    function positiveHz(value,fallback){
        const hz=Number(value);
        return Number.isFinite(hz)&&hz>0?hz:fallback;
    }
    function resolveNowMs(nowMs){
        if(Number.isFinite(nowMs))return nowMs;
        return globalThis.performance?.now?.()??Date.now();
    }
    function getUpdateStats(){
        return{updates:updateStats.updates,maxGapMs:updateStats.maxGapMs,lastGapMs:updateStats.lastGapMs};
    }

    // ===== 主涌浪：三组不同方向/波长的低频大浪 + 两组中频碎波 =====
    function waveBase(x,z,t){
        let h=Math.sin(x*.09+t*.8)*.6
            +Math.sin(z*.11-t*.62)*.5
            +Math.sin((x+z)*.065+t*1.05)*.45
            +Math.sin(x*.31+z*.23+t*1.7)*.16
            +Math.sin(z*.34-x*.26-t*2.2)*.12;
        h*=state.waveBoost;
        // 海浪事件：沿事件方向传播的行波
        if(state.waveBoost>1.01){
            const dir=getWaveEventDir();
            h+=Math.sin((x*dir.x+z*dir.z)*.22-t*3.2)*.5*(state.waveBoost-1);
        }
        return h;
    }

    // ===== 唯一波浪高度函数：水面网格、鸭子、道具、漩涡、涟漪、鲨鱼全部共用 =====
    // 漩涡把水面向下拉成漏斗（真正改变水体形状）
    function waveHeight(x,z,t){
        let h=waveBase(x,z,t);
        const wz=state.whirlZones;
        for(let k=0;k<wz.length;k++){
            const w=wz[k];const dx=x-w.x,dz=z-w.z;const d2=dx*dx+dz*dz;
            if(d2<w.r*w.r){const s=1-Math.sqrt(d2)/w.r;h-=w.depth*s*s;}
        }
        return h;
    }

    // ===== 深层底板（在浪谷下方兜住视野，跟随鸭子移动） =====
    const waterGeo=new THREE.PlaneGeometry(400,400,1,1);
    waterGeo.rotateX(-Math.PI/2);
    const waterMat=new THREE.MeshStandardMaterial({color:0x1a6aa8,roughness:.95,metalness:0,side:THREE.DoubleSide});
    const waterMesh=new THREE.Mesh(waterGeo,waterMat);
    waterMesh.position.y=-3.6;
    scene.add(waterMesh);

    // ===== 波浪层（细分平面，逐帧顶点位移 + 顶点色渐变/浪尖泡沫） =====
    let waveGeo;
    function createWaveGeometry(segments){
        const geo=new THREE.PlaneGeometry(200,200,segments,segments);
        geo.rotateX(-Math.PI/2);
        geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count*3),3));
        return geo;
    }
    waveGeo=createWaveGeometry(56);
    waveGeo.userData.detail=56;

    // 顶点色三原色：深水/浅水/泡沫（随昼夜变化，由环境系统修改）
    const waterColDeep=new THREE.Color(0x0e5f9e),waterColLight=new THREE.Color(0x49b6e4),waterColFoam=new THREE.Color(0xeafcff);
    const _wc=new THREE.Color(); // 顶点色计算用临时色

    const waveMat=new THREE.MeshStandardMaterial({
        vertexColors:true,
        roughness:.3,
        metalness:0,
        side:THREE.DoubleSide,
    });
    const waveMesh=new THREE.Mesh(waveGeo,waveMat);
    waveMesh.receiveShadow=true;
    scene.add(waveMesh);

    function setWaveDetail(segments){
        // 即使细分数未改变，画质重应用后也要让下一帧重新同步曲面与法线。
        surfaceTimeGate.forceNext();
        normalTimeGate.forceNext();
        if(waveGeo?.userData.detail===segments)return;
        const previous=waveGeo;
        waveGeo=createWaveGeometry(segments);
        waveGeo.userData.detail=segments;
        waveMesh.geometry=waveGeo;
        if(previous)previous.dispose();
    }

    // ===== 当前可见水网格高度 =====
    // waveHeight 是连续解析曲面，但屏幕上的 PlaneGeometry 会在相邻顶点间做三角插值。
    // 普通小道具体型有限，差异不明显；大型漂浮物跨在漩涡漏斗上时需读取真实可见高度，避免粗网格穿模。
    function renderedWaveHeight(x,z){
        const detail=waveGeo.userData.detail;
        const size=200,half=size*.5,step=size/detail;
        const gx=(x-waveMesh.position.x+half)/step,gz=(z-waveMesh.position.z+half)/step;
        if(gx<0||gz<0||gx>detail||gz>detail)return waveHeight(x,z,state.renderedWaveClock);
        const ix=Math.min(detail-1,Math.floor(gx)),iz=Math.min(detail-1,Math.floor(gz));
        const fx=gx-ix,fz=gz-iz,row=detail+1,p=waveGeo.attributes.position;
        // PlaneGeometry 每格索引为 (a,b,d) / (b,c,d)，旋转到 XZ 平面后行方向为 +Z。
        const a=iz*row+ix,d=a+1,b=a+row,c=b+1;
        const ya=p.getY(a),yb=p.getY(b),yc=p.getY(c),yd=p.getY(d);
        if(fx+fz<=1)return ya+(yd-ya)*fx+(yb-ya)*fz;
        return yc+(yb-yc)*(1-fx)+(yd-yc)*(1-fz);
    }

    // ===== 贴浪面圆环（顶点逐帧贴合 waveHeight，不会被海浪遮挡） =====
    // 用于：漩涡边缘浪花/引力圈、鲨鱼鳍根浪花、磁铁范围圈/脉冲环
    function mkWaveRing(radialSegs,thetaSegs,material,uvRepeat=1){
        const verts=(radialSegs+1)*(thetaSegs+1);
        const pos=new Float32Array(verts*3),uv=new Float32Array(verts*2),idx=[];
        for(let r=0;r<=radialSegs;r++)for(let t=0;t<=thetaSegs;t++){const i=r*(thetaSegs+1)+t;uv[i*2]=t/thetaSegs*uvRepeat;uv[i*2+1]=r/radialSegs}
        for(let r=0;r<radialSegs;r++)for(let t=0;t<thetaSegs;t++){const a=r*(thetaSegs+1)+t,b=a+1,c=a+thetaSegs+1,d=c+1;idx.push(a,c,b,b,c,d)}
        const geo=new THREE.BufferGeometry();
        geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
        geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));
        geo.setIndex(idx);
        const mesh=new THREE.Mesh(geo,material);
        mesh.frustumCulled=false;
        // 每帧更新：圆环绕 (cx,cz)，内外半径 r0~r1，顶点贴合浪面 + yOff
        // 采样 renderedWaveClock：与渲染中的浪面网格严格同相，贴图永不脱离水面
        mesh.userData.update=function(cx,cz,r0,r1,yOff){
            const p=geo.attributes.position;
            for(let r=0;r<=radialSegs;r++){
                const rr=r0+(r1-r0)*(r/radialSegs);
                for(let t=0;t<=thetaSegs;t++){
                    const i=r*(thetaSegs+1)+t,a=t/thetaSegs*Math.PI*2;
                    const x=cx+Math.cos(a)*rr,z=cz+Math.sin(a)*rr;
                    p.setXYZ(i,x,waveHeight(x,z,state.renderedWaveClock)+yOff,z);
                }
            }
            p.needsUpdate=true;
        };
        return mesh;
    }

    // ===== 贴浪面圆盘（实心圆，顶点逐帧贴合 waveHeight，不会被海浪遮挡） =====
    // 用于：漩涡主体/泡沫/中心暗洞等需要"贴图直接映射在水面"的场景
    function mkWaveDisk(radius,radialSegs,thetaSegs,material,uvRepeatU=1,uvRepeatV=1,uvMode='polar'){
        const pos=new Float32Array((radialSegs+1)*(thetaSegs+1)*3);
        const uv=new Float32Array((radialSegs+1)*(thetaSegs+1)*2);
        const idx=[];
        for(let r=0;r<=radialSegs;r++){
            const rr=radius*(r/radialSegs);
            for(let t=0;t<=thetaSegs;t++){
                const i=r*(thetaSegs+1)+t;
                const a=t/thetaSegs*Math.PI*2;
                pos[i*3]=Math.cos(a)*rr;
                pos[i*3+1]=0;
                pos[i*3+2]=Math.sin(a)*rr;
                if(uvMode==='planar'){
                    // 普通二维圆形贴图（如中心暗洞）需要笛卡尔 UV；若沿用极坐标 UV，
                    // 同一个圆心会采到一整排不同像素，视觉上就会变成月牙或扇形。
                    const nr=r/radialSegs;
                    uv[i*2]=(.5+Math.cos(a)*nr*.5)*uvRepeatU;
                    uv[i*2+1]=(.5+Math.sin(a)*nr*.5)*uvRepeatV;
                }else{
                    // 水流与泡沫使用“角度 + 半径”展开，斜纹映射后自然形成螺旋。
                    uv[i*2]=t/thetaSegs*uvRepeatU;
                    uv[i*2+1]=r/radialSegs*uvRepeatV;
                }
            }
        }
        for(let r=0;r<radialSegs;r++)for(let t=0;t<thetaSegs;t++){
            const a=r*(thetaSegs+1)+t,b=a+1,c=a+thetaSegs+1,d=c+1;
            idx.push(a,c,b,b,c,d);
        }
        const geo=new THREE.BufferGeometry();
        geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
        geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mesh=new THREE.Mesh(geo,material);
        mesh.frustumCulled=false;
        // 每帧更新：圆盘中心 (cx,cz)，缩放 ws（对应 group.scale），yOff 抬高避免被浪面遮挡。
        // 必须采样当前真正显示的低细分网格；解析 waveHeight 在漩涡漏斗处可能比三角面低近 2 个单位，
        // 即使 renderOrder 更高也会因深度测试而被主水面盖住。
        mesh.userData.update=function(cx,cz,ws,yOff){
            const p=geo.attributes.position;
            for(let i=0;i<p.count;i++){
                const lx=p.getX(i),lz=p.getZ(i);
                const wx=cx+lx*ws,wz=cz+lz*ws;
                // y 需除以 ws 抵消 group 缩放，使世界 y = 可见水面高度 + yOff
                p.setY(i,(renderedWaveHeight(wx,wz)+yOff)/ws);
            }
            p.needsUpdate=true;
            // MeshBasicMaterial 不参与光照，无需 computeVertexNormals（每帧省下数千次法线重算）
        };
        return mesh;
    }

    // ===== 波浪相位推进：暴风雨/海浪事件加速，平静时刻减速（平滑过渡） =====
    function updatePhase(dt,waveSpeedTarget){
        state.waveSpeed+=(waveSpeedTarget-state.waveSpeed)*Math.min(1,dt*1.4);
        state.waveClock+=dt*state.waveSpeed;
        // 鸭子/道具/涟漪/鲨鱼采样的 renderedWaveClock 逐帧推进：即使浪面网格按闸口降频重建，
        // 漂浮物也不会被冻结在旧相位上——移动时鸭子相对浪面不再呈 33ms 阶梯抖动。
        state.renderedWaveClock+=dt*state.waveSpeed;
    }

    // ===== 水面网格跟随目标（鸭子位置） =====
    function followTarget(x,z){
        pendingWaveX=x;
        pendingWaveZ=z;
        waterMesh.position.x=x;
        waterMesh.position.z=z;
    }

    // ===== 波浪顶点位移 + 顶点色更新（performance.now 时间闸口控制频率） =====
    // 每次重建时把 renderedWaveClock 对齐到 waveClock（两者逐帧同量推进，这里仅兜底消除浮点漂移），
    // 保证重建瞬间鸭子/道具/涟漪/鲨鱼与渲染浪面严格同相。
    function updateVertices(gameClock,targetX,targetZ,nowMs){
        if(Number.isFinite(targetX))pendingWaveX=targetX;
        if(Number.isFinite(targetZ))pendingWaveZ=targetZ;

        const now=resolveNowMs(nowMs);
        const surfaceHz=state.waveSpeed>1.6
            ?positiveHz(quality.stormWaveUpdateHz,DEFAULT_STORM_WAVE_HZ)
            :positiveHz(quality.waveUpdateHz,DEFAULT_WAVE_HZ);
        if(!surfaceTimeGate.shouldUpdate(now,surfaceHz))return false;

        // waveMesh 的世界中心与顶点高度必须原子更新，否则移动中心后会短暂显示旧世界坐标的波形。
        waveMesh.position.x=pendingWaveX;
        waveMesh.position.z=pendingWaveZ;
        state.renderedWaveClock=state.waveClock;
        const wp=waveGeo.attributes.position,wcA=waveGeo.attributes.color;
        const wmx=waveMesh.position.x,wmz=waveMesh.position.z;
        const boost=state.waveBoost;
        const clk=state.waveClock;
        for(let i=0;i<wp.count;i++){
            const wx=wp.getX(i)+wmx,wz=wp.getZ(i)+wmz;
            const h=waveHeight(wx,wz,clk);
            wp.setY(i,h);
            // 顶点色：深水→浅水渐变
            let hn=(h+2)*.25;hn=hn<0?0:hn>1?1:hn;
            _wc.copy(waterColDeep).lerp(waterColLight,hn*hn);
            // 浪尖泡沫：阈值随振幅自适应（避免事件时整片泛白），噪声打碎泡沫边缘
            let foamF=(h-1.02*boost)*2.2;
            if(foamF>0){
                const fn=Math.sin(wx*1.9+wz*2.7+gameClock*1.3)*Math.sin(wx*2.7-wz*1.6-gameClock*.9);
                foamF*=.35+.65*Math.max(0,fn);if(foamF>.85)foamF=.85;
                _wc.lerp(waterColFoam,foamF);
            }
            wcA.setXYZ(i,_wc.r,_wc.g,_wc.b);
        }
        wp.needsUpdate=true;wcA.needsUpdate=true;

        const normalHz=positiveHz(quality.waveNormalHz,DEFAULT_NORMAL_HZ);
        if(normalTimeGate.shouldUpdate(now,normalHz)){
            waveGeo.computeVertexNormals();
        }

        if(lastSurfaceUpdateMs!==null){
            const gap=Math.max(0,now-lastSurfaceUpdateMs);
            updateStats.lastGapMs=gap;
            if(gap>updateStats.maxGapMs)updateStats.maxGapMs=gap;
        }else updateStats.lastGapMs=0;
        updateStats.updates++;
        lastSurfaceUpdateMs=now;
        return true;
    }

    function dispose(){
        waterGeo.dispose();
        waterMat.dispose();
        waveGeo.dispose();
        waveMat.dispose();
    }

    return {
        // 唯一 waveHeight（其他模块不得复制水面算法）
        waveHeight,renderedWaveHeight,
        // 贴浪面工具
        mkWaveRing,mkWaveDisk,
        // 画质控制
        setWaveDetail,
        // 主循环调用
        updatePhase,followTarget,updateVertices,
        // 轻量性能诊断（stats 为只读实时视图，getUpdateStats 返回快照）
        stats,getUpdateStats,
        // 网格引用（main.js 跟随鸭子位置等）
        waterMesh,waveMesh,
        // 材质/颜色引用（环境系统昼夜调色）
        waterMat,waterColDeep,waterColLight,waterColFoam,
        dispose,
    };
}
