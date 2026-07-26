// 渲染后处理：漩涡吸入屏幕滤镜（涡旋扭曲 + 旋转模糊 + 暗角收拢）
// 依赖通过 createSwirlPostfx(ctx) 注入：{ renderer, scene, camera, width, height }
// 返回后处理对象，包含 render/resize/dispose 方法
// sinkFx 强度仍由 main.js 维护（let 变量，被多处修改），本模块只负责渲染逻辑

import * as THREE from 'three';

/**
 * 创建漩涡吸入后处理
 * @param {{renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera,width:number,height:number}} ctx
 */
export function createSwirlPostfx(ctx){
    const {renderer,scene,camera,width,height}=ctx;

    const swirlRT=new THREE.WebGLRenderTarget(width,height);
    const swirlCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const swirlScene=new THREE.Scene();
    const swirlMat=new THREE.ShaderMaterial({
        uniforms:{
            tD:{value:swirlRT.texture},
            fx:{value:0},
            asp:{value:width/height}
        },
        vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader:`
            uniform sampler2D tD;uniform float fx;uniform float asp;varying vec2 vUv;
            void main(){
                vec2 p=vUv-.5;p.x*=asp;
                float r=length(p),a=atan(p.y,p.x);
                // 柔缓的涡旋扭转（平滑衰减，优雅的大弧线而非狂暴搅动）
                float tw=fx*4.5*smoothstep(.95,.1,r);
                // 轻微向中心吸入的缩放（被温柔卷进去）
                float zm=1.-fx*.18*smoothstep(.9,.2,r);
                // 旋转模糊：沿扭转弧 10 次采样（丝绸般的弧线拖影）
                vec3 col=vec3(0.);
                for(int i=0;i<10;i++){
                    float o=(float(i)/9.-.5)*fx*.7*smoothstep(.9,.1,r);
                    vec2 q=vec2(cos(a+tw+o),sin(a+tw+o))*r*zm;q.x/=asp;
                    col+=texture2D(tD,q+.5).rgb;
                }
                col/=10.;
                // 中心柔光（隧道尽头的一点亮）+ 边缘海水蓝暗角（不要死黑，要优雅的水下感）
                col*=1.+fx*.3*smoothstep(.45,.0,r);
                col=mix(col,vec3(.03,.1,.2),fx*smoothstep(.3,.95,r)*.75);
                gl_FragColor=vec4(col,1.);
            }`
    });
    swirlScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),swirlMat));

    /** 渲染漩涡后处理（fx>0.004 时调用） */
    function render(fx){
        if(fx<=0.004)return;
        swirlMat.uniforms.fx.value=fx;
        renderer.setRenderTarget(swirlRT);
        renderer.render(scene,camera);
        renderer.setRenderTarget(null);
        renderer.render(swirlScene,swirlCam);
    }

    /** 窗口尺寸变化时同步 render target 与 aspect */
    function resize(w,h){
        swirlRT.setSize(w,h);
        swirlMat.uniforms.asp.value=w/h;
    }

    /** 释放资源（如需销毁） */
    function dispose(){
        swirlRT.dispose();
        swirlMat.dispose();
        swirlScene.children.forEach(c=>{c.geometry?.dispose()});
    }

    return {render,resize,dispose,swirlRT,swirlMat,swirlScene,swirlCam};
}
