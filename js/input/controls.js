// ===== 键盘 / 摇杆输入 ——自 js/main.js 阶段 8 迁入 =====
// 依赖注入：initControls({isMobile,mv,getDuckMaxSpeed}) 由 main.js 在依赖就绪后调用。
// joySensitivity 为模块级 live binding：设置面板通过 setJoySensitivity 写入、
// 摇杆回调用 import 活绑定读取。
export let joySensitivity=Math.max(.5,Math.min(1.5,Number(localStorage.getItem('duck_joy_sensitivity'))||1));
export function setJoySensitivity(v){joySensitivity=v}

export function initControls({isMobile,mv,getDuckMaxSpeed}){
// 键盘（W/S 前后，A/D 左右，均相对相机视角）
if(!isMobile){addEventListener('keydown',e=>{switch(e.code){case'KeyW':case'ArrowUp':mv.f=true;break;case'KeyS':case'ArrowDown':mv.b=true;break;case'KeyA':case'ArrowLeft':mv.l=true;break;case'KeyD':case'ArrowRight':mv.r=true;break;case'KeyM':document.getElementById('music-btn').click();break}});
addEventListener('keyup',e=>{switch(e.code){case'KeyW':case'ArrowUp':mv.f=false;break;case'KeyS':case'ArrowDown':mv.b=false;break;case'KeyA':case'ArrowLeft':mv.l=false;break;case'KeyD':case'ArrowRight':mv.r=false;break}})}

// 摇杆（视角相对：推上=朝相机前方移动，推右=朝相机右方移动）
if(isMobile){const zone=document.getElementById('joy-zone'),base=document.getElementById('joy-base'),knob=document.getElementById('joy-knob');
let ja=false,jc={x:0,y:0};
zone.ontouchstart=e=>{e.preventDefault();e.stopPropagation();const t=e.touches[0];ja=true;
const rect=zone.getBoundingClientRect();
const bx=t.clientX-rect.left,by=t.clientY-rect.top;
base.style.display='block';
base.style.left=Math.max(0,Math.min(bx-65,rect.width-130))+'px';
base.style.top=Math.max(0,Math.min(by-65,rect.height-130))+'px';
jc={x:t.clientX,y:t.clientY};knob.style.left='50%';knob.style.top='50%'};
zone.ontouchmove=e=>{e.preventDefault();if(!ja)return;const t=e.touches[0],dx=t.clientX-jc.x,dy=t.clientY-jc.y,dist=Math.sqrt(dx*dx+dy*dy),max=65,cl=Math.min(dist,max),ang=Math.atan2(dy,dx);knob.style.left=`${50+(cl/max)*50*Math.cos(ang)}%`;knob.style.top=`${50+(cl/max)*50*Math.sin(ang)}%`;const dead=18;if(dist>dead){
// 摇杆方向转换为归一化分量（上=前进，右=右移）
const speedRatio=Math.min((dist-dead)/(max-dead),1);
mv.joyDx=dx/dist; // 右分量
mv.joyDy=-dy/dist; // 前分量（屏幕Y轴向下，取反）
mv._joySpeed=speedRatio*getDuckMaxSpeed()*joySensitivity;
}else{mv.f=mv.b=mv.l=mv.r=false;mv.str=0;mv._joySpeed=0;mv.joyDx=0;mv.joyDy=0}};
const rst=()=>{ja=false;base.style.display='none';mv.f=mv.b=mv.l=mv.r=false;mv.str=0;mv._joySpeed=0;mv.joyDx=0;mv.joyDy=0};zone.ontouchend=rst;zone.ontouchcancel=rst}
}
