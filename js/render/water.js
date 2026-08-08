// 水面渲染：深水底板 / 波浪层 / 唯一 waveHeight 实现 / 贴浪面圆环圆盘工具
// 依赖通过 createWater(ctx) 注入：
//   - scene: THREE.Scene
//   - quality: 画质状态对象（waveUpdateInterval / waveNormalInterval）
//   - getFrameCount: () => number （主循环帧计数 getter）
//   - getWaveEventDir: () => {x, z}  （海浪事件方向 getter）
//   - state: 共享状态对象，含 waveBoost/waveClock/waveSpeed/renderedWaveClock 的 getter/setter 与 whirlZones 数组
// 返回：
//   - waveHeight(x,z,t): 唯一波浪高度函数（水面/鸭子/道具/漩涡共用）
//   - mkWaveRing/mkWaveDisk: 贴浪面网格工具
//   - setWaveDetail(segments): 切换波浪细分
//   - updatePhase(dt, waveSpeedTarget): 推进波浪相位
//   - followTarget(x, z): 水面网格跟随目标
//   - updateVertices(gameClock): 更新波浪顶点位移与顶点色
//   - waterMesh/waveMesh/waterMat/waterColDeep/waterColLight/waterColFoam: 供环境系统昼夜调色

import * as THREE from 'three';

/**
 * 创建水面渲染系统
 * @param {{scene:THREE.Scene,quality:object,getFrameCount:()=>number,getWaveEventDir:()=>{x:number,z:number},state:object}} ctx
 */
export function createWater(ctx){
    const {scene,quality,getFrameCount,getWaveEventDir,state}=ctx;

    // ===== 波浪更新闸口：暴风雨时波浪推进快，自动加密更新保持视觉顺滑 =====
    function waveFrameDue(){
        const iv=state.waveSpeed>1.6?Math.min(2,quality.waveUpdateInterval):quality.waveUpdateInterval;
        return getFrameCount()%iv===0;
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
        if(waveGeo?.userData.detail===segments)return;
        const previous=waveGeo;
        waveGeo=createWaveGeometry(segments);
        waveGeo.userData.detail=segments;
        waveMesh.geometry=waveGeo;
        if(previous)previous.dispose();
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
    function mkWaveDisk(radius,radialSegs,thetaSegs,material,uvRepeatU=1,uvRepeatV=1){
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
                uv[i*2]=t/thetaSegs*uvRepeatU;
                uv[i*2+1]=r/radialSegs*uvRepeatV;
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
        // 每帧更新：圆盘中心 (cx,cz)，缩放 ws（对应 group.scale），yOff 抬高避免被浪面遮挡
        // 采样 renderedWaveClock：与渲染中的浪面网格严格同相，漩涡贴图紧贴水面漏斗
        mesh.userData.update=function(cx,cz,ws,yOff){
            const p=geo.attributes.position;
            for(let i=0;i<p.count;i++){
                const lx=p.getX(i),lz=p.getZ(i);
                const wx=cx+lx*ws,wz=cz+lz*ws;
                // y 需除以 ws 抵消 group 缩放，使世界 y = waveHeight + yOff
                p.setY(i,(waveHeight(wx,wz,state.renderedWaveClock)+yOff)/ws);
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
    }

    // ===== 水面网格跟随目标（鸭子位置） =====
    function followTarget(x,z){
        waterMesh.position.x=x;
        waterMesh.position.z=z;
        waveMesh.position.x=x;
        waveMesh.position.z=z;
    }

    // ===== 波浪顶点位移 + 顶点色更新（闸口控制频率） =====
    // 更新后定格 renderedWaveClock：鸭子/道具/涟漪/鲨鱼都以它采样，与渲染浪面严格一致
    function updateVertices(gameClock){
        if(!waveFrameDue())return;
        state.renderedWaveClock=state.waveClock;
        const wp=waveGeo.attributes.position,wcA=waveGeo.attributes.color;
        const wmx=waveMesh.position.x,wmz=waveMesh.position.z;
        const frameCount=getFrameCount();
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
        if(frameCount%quality.waveNormalInterval===0)waveGeo.computeVertexNormals();
    }

    function dispose(){
        waterGeo.dispose();
        waterMat.dispose();
        waveGeo.dispose();
        waveMat.dispose();
    }

    return {
        // 唯一 waveHeight（其他模块不得复制水面算法）
        waveHeight,
        // 贴浪面工具
        mkWaveRing,mkWaveDisk,
        // 画质控制
        setWaveDetail,
        // 主循环调用
        updatePhase,followTarget,updateVertices,
        // 网格引用（main.js 跟随鸭子位置等）
        waterMesh,waveMesh,
        // 材质/颜色引用（环境系统昼夜调色）
        waterMat,waterColDeep,waterColLight,waterColFoam,
        dispose,
    };
}
