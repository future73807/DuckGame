// 渲染运行时：渲染器 / 场景 / 相机 / 控制器 / 动态分辨率（DRS） / 画质档位
// 将原 main.js 中的渲染基础设施抽出，main.js 通过 createRuntime() 获取实例
// 画质相关变量集中到 quality 对象，便于画质档位切换与 DRS 调度
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

/**
 * 创建渲染运行时
 * @returns {{canvas,camera,controls,renderer,scene,quality,cam,applyDRS,resize}}
 *   - quality: 画质状态对象（renderPixelRatio/basePixelRatio/drsScale/drsTimer/waveUpdateInterval/...）
 *   - cam: 相机跟随 / 用户交互状态
 *   - applyDRS(callbacks?): 动态分辨率调整，callbacks 可选 {sizeStormCv,sizeSkyFx}
 *   - resize(w,h,swirlPostfx?): 窗口尺寸变化处理
 */
export function createRuntime(){
    const canvas=document.getElementById('c');
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:false});

    // 画质档位 & DRS 状态（原 main.js 中的 let 变量）
    const quality={
        renderPixelRatio:Math.min(devicePixelRatio,1.35),
        basePixelRatio:Math.min(devicePixelRatio,1.35),
        drsScale:1,
        drsTimer:0,
        waveUpdateHz:60,
        stormWaveUpdateHz:60,
        waveNormalHz:8,
        waveUpdateInterval:3,
        waveNormalInterval:12,
        environmentUpdateInterval:2,
        shadowUpdateInterval:2,
        shadowUpdateHz:20,
        restricted:false,
    };

    renderer.setSize(innerWidth,innerHeight);
    renderer.setPixelRatio(quality.renderPixelRatio);
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.2;
    renderer.outputColorSpace=THREE.SRGBColorSpace;

    const scene=new THREE.Scene();
    scene.fog=new THREE.Fog(0x88ccee,60,190); // 远处水面/物体融入地平线

    const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,2000);
    camera.position.set(4,6,8);

    const controls=new OrbitControls(camera,canvas);
    controls.enableDamping=true;
    controls.dampingFactor=.06;
    controls.target.set(0,0,0);
    controls.minDistance=4;
    controls.maxDistance=18;
    controls.maxPolarAngle=Math.PI*.48;
    controls.minPolarAngle=Math.PI*.1;

    // 旋转 / 缩放时仍要跟随鸭子平移；start/end 只记录真实用户交互，绝不暂停跟随。
    // change 不能用于识别用户输入，因为程序调用 controls.update() 也会触发它。
    const cam={followPaused:false,userInteracting:false};
    controls.addEventListener('start',()=>{cam.userInteracting=true});
    controls.addEventListener('end',()=>{cam.userInteracting=false});

    /**
     * 动态分辨率（DRS）：按实测 FPS 在 0.6~1.0 之间自动缩放像素比
     * @param {{sizeStormCv?:Function,sizeSkyFx?:Function}} [callbacks]
     */
    function applyDRS(callbacks){
        quality.renderPixelRatio=Math.max(.5,quality.basePixelRatio*quality.drsScale);
        renderer.setPixelRatio(quality.renderPixelRatio);
        renderer.setSize(innerWidth,innerHeight);
        if(callbacks&&callbacks.sizeStormCv)callbacks.sizeStormCv();
        if(callbacks&&callbacks.sizeSkyFx)callbacks.sizeSkyFx();
    }

    /**
     * 窗口尺寸变化：更新相机宽高比、渲染器尺寸、后处理尺寸
     * @param {number} w
     * @param {number} h
     * @param {{resize?:Function}} [swirlPostfx]
     */
    function resize(w,h,swirlPostfx){
        camera.aspect=w/h;
        camera.updateProjectionMatrix();
        renderer.setSize(w,h);
        if(swirlPostfx&&swirlPostfx.resize)swirlPostfx.resize(w,h);
    }

    return {canvas,renderer,scene,camera,controls,quality,cam,applyDRS,resize};
}
