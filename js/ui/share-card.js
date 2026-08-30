// 分享卡片：Canvas 1200×800 绘制、二维码生成、预览与下载
// 依赖通过 setShareCardCtx 注入：{ Leaderboard, Duo, toast, getRunHighlight }
// 这样可避免与 main.js 产生循环导入，同时保持 UI 模块无状态侵入

import {formatScore} from '../core/format.js';

let _ctx=null;

const DEFAULT_RUN_HIGHLIGHT=Object.freeze({kind:'steady',icon:'fa-star',text:'勇敢完成本局'});

function normalizeRunHighlight(value){
    if(typeof value==='string')value={text:value};
    if(!value||typeof value!=='object')return {...DEFAULT_RUN_HIGHLIGHT};
    const rawText=typeof value.text==='string'?value.text.trim():'';
    const text=rawText.replace(/^本局高光\s*[\u00b7・:：\-]?\s*/,'').trim()||DEFAULT_RUN_HIGHLIGHT.text;
    const icon=typeof value.icon==='string'&&value.icon.trim()?value.icon.trim():DEFAULT_RUN_HIGHLIGHT.icon;
    const kind=typeof value.kind==='string'&&value.kind.trim()?value.kind.trim().toLowerCase():DEFAULT_RUN_HIGHLIGHT.kind;
    return {kind,icon,text};
}

/** 由 main.js 在初始化阶段注入依赖 */
export function setShareCardCtx(ctx){
    _ctx=ctx;
}

function ensureQRCodeLib(){
    return new Promise((resolve)=>{
        if(typeof QRCode!=='undefined'){resolve();return}
        const s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
        s.onload=()=>resolve();
        s.onerror=()=>resolve();
        document.head.appendChild(s);
    });
}

function generateQRDataURL(text,size){
    return new Promise((resolve)=>{
        const holder=document.createElement('div');
        holder.style.position='fixed';holder.style.left='-9999px';holder.style.top='0';
        document.body.appendChild(holder);
        try{
            new QRCode(holder,{text,width:size,height:size});
            setTimeout(()=>{
                const cv=holder.querySelector('canvas');
                const img=holder.querySelector('img');
                let dataURL=null;
                if(cv)dataURL=cv.toDataURL('image/png');
                else if(img)dataURL=img.src;
                document.body.removeChild(holder);
                resolve(dataURL);
            },80);
        }catch(e){document.body.removeChild(holder);resolve(null)}
    });
}

let _cachedShareDataURLPromise=null;  // Promise 缓存：预览和下载共用同一次生成，杜绝并发生成导致不一致
function getShareCardDataURL(){
    if(!_cachedShareDataURLPromise){
        _cachedShareDataURLPromise=generateShareCardDataURL().catch(e=>{
            _cachedShareDataURLPromise=null;  // 失败时重置，允许重试
            throw e;
        });
    }
    return _cachedShareDataURLPromise;
}

/** 重置缓存（外部如需强制重新生成可调用） */
export function resetShareCardCache(){
    _cachedShareDataURLPromise=null;
}

/** 关闭分享卡弹窗并清空缓存（供 HTML onclick 直接调用） */
export function closeShareModal(){
    document.getElementById('share-modal').classList.remove('show');
    _cachedShareDataURLPromise=null;
}

function setShareLoading(loading,message='正在生成分享卡片…'){
    const loadingEl=document.getElementById('share-loading');
    const img=document.getElementById('share-preview-img');
    if(loadingEl){loadingEl.classList.toggle('show',loading);const text=loadingEl.querySelector('span');if(text)text.textContent=message}
    if(img&&loading)img.style.display='none';
}

export async function showShareModal(){
    document.getElementById('share-modal').classList.add('show');
    resizeSharePreview();
    const img=document.getElementById('share-preview-img');
    img.removeAttribute('src');
    img.alt='分享卡片生成中';
    setShareLoading(true);
    try{
        const dataURL=await getShareCardDataURL();
        console.log('[ShareCard] generated, length:',dataURL?dataURL.length:0);
        await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('预览图片加载失败'));img.src=dataURL});
        setShareLoading(false);
        img.alt='分享卡片预览';
        img.style.display='block';
    }catch(e){
        console.error('[ShareCard] showShareModal error:',e);
        img.alt='卡片生成失败：'+e.message;
        setShareLoading(true,'卡片生成失败，请重试');
    }
}

function resizeSharePreview(){
    const card=document.querySelector('#share-modal .sm-card');
    if(!card)return;
    const isTouch=matchMedia('(hover:none), (pointer:coarse)').matches;
    const gutter=isTouch?24:28;
    const maxW=window.innerWidth-gutter;
    const controlsH=isTouch?76:88;
    const maxH=Math.max(120,window.innerHeight-controlsH);
    const imgW=Math.max(160,Math.min(maxW,maxH*1.5,isTouch?maxW:900));
    card.style.width=imgW+'px';
}

// 手机端：地址栏显示/隐藏会改变可见高度，监听 resize 重新计算图片高度
let _shareResizeHandler=null;
function _bindShareResize(){
    if(_shareResizeHandler)return;
    _shareResizeHandler=()=>{
        const modal=document.getElementById('share-modal');
        if(!modal||!modal.classList.contains('show'))return;
        resizeSharePreview();
    };
    window.addEventListener('resize',_shareResizeHandler);
    window.addEventListener('orientationchange',_shareResizeHandler);
}
_bindShareResize();

// 生成分享卡片 dataURL（预览和下载共用，确保一模一样）
async function generateShareCardDataURL(){
    const {Leaderboard,Duo,getRunHighlight}=(_ctx||{});
    if(!Leaderboard)throw new Error('ShareCard ctx not initialized');
    // 在任何异步等待前只读取一次，保证整张卡片使用同一份本局快照。
    let rawRunHighlight=null;
    try{rawRunHighlight=typeof getRunHighlight==='function'?getRunHighlight():null}catch(e){rawRunHighlight=null}
    const runHighlight=normalizeRunHighlight(rawRunHighlight);
    const myBest=Leaderboard.myBest();
    const myName=Leaderboard.getCachedName()||'勇敢鸭鸭';
    const duoShare=!!(Duo&&Duo.active&&Duo.room);
    const duoNames=duoShare?[Duo.room.host?.name,Duo.room.guest?.name].filter(Boolean):[];
    const shareMode=duoShare?`双人同行 · ${duoNames.join(' 与 ')||'双人队伍'}`:`单人模式 · ${myName}`;
    const url=location.href.split('?')[0];
    let myRank=0;
    try{
        const d=Leaderboard.get();
        const uid=Leaderboard.getUserId();
        const sorted=[...d.entries].sort((a,b)=>(b.score||0)-(a.score||0));
        const idx=sorted.findIndex(e=>e.userId===uid);
        if(idx>=0)myRank=idx+1;
    }catch(e){}
    // 生成二维码 dataURL
    let qrDataURL=null;
    try{
        await ensureQRCodeLib();
        qrDataURL=await generateQRDataURL(url,200);
    }catch(e){qrDataURL=null}
    // ===== 3:2 横版画布（1200×800）=====
    const W=1200,H=800;
    const canvas=document.createElement('canvas');
    canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext('2d');
    // ===== 背景 =====
    const bg=ctx.createLinearGradient(0,0,W,H);
    bg.addColorStop(0,'#0c1830');bg.addColorStop(.5,'#0a1428');bg.addColorStop(1,'#080f1f');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    // 左上柔和暖光
    const haloL=ctx.createRadialGradient(W*.22,180,0,W*.22,180,480);
    haloL.addColorStop(0,'rgba(255,210,140,.18)');haloL.addColorStop(.5,'rgba(255,200,120,.05)');haloL.addColorStop(1,'rgba(255,200,120,0)');
    ctx.fillStyle=haloL;ctx.fillRect(0,0,W*.55,H);
    // 右侧金光（聚焦小黄鸭区）
    const haloR=ctx.createRadialGradient(W*.8,H*.42,0,W*.8,H*.42,400);
    haloR.addColorStop(0,'rgba(255,200,100,.16)');haloR.addColorStop(.6,'rgba(255,180,80,.04)');haloR.addColorStop(1,'rgba(255,180,80,0)');
    ctx.fillStyle=haloR;ctx.fillRect(W*.45,0,W*.55,H);
    // 底部微暗角
    const vig=ctx.createRadialGradient(W/2,H*.55,300,W/2,H*.55,H*.8);
    vig.addColorStop(0,'rgba(0,0,0,0)');vig.addColorStop(1,'rgba(0,0,0,.3)');
    ctx.fillStyle=vig;ctx.fillRect(0,0,W,H);
    // 装饰：角花（移除，已被塔罗牌式边框四角装饰取代）
    // ===== 塔罗牌式奢华边框（4层金线 + 四角花纹 + 中点菱形）=====
    const BW=24;
    // 第1层：外粗金线
    ctx.strokeStyle='rgba(212,175,100,.75)';ctx.lineWidth=2.5;
    roundRect(ctx,BW,BW,W-BW*2,H-BW*2,4);ctx.stroke();
    // 第2层：内 6px 极细金线
    ctx.strokeStyle='rgba(212,175,100,.35)';ctx.lineWidth=.8;
    roundRect(ctx,BW+6,BW+6,W-(BW+6)*2,H-(BW+6)*2,2);ctx.stroke();
    // 第3层：再内 4px 中粗金线
    ctx.strokeStyle='rgba(212,175,100,.6)';ctx.lineWidth=1.5;
    roundRect(ctx,BW+10,BW+10,W-(BW+10)*2,H-(BW+10)*2,2);ctx.stroke();
    // 第4层：再内 6px 极细白线
    ctx.strokeStyle='rgba(255,255,255,.1)';ctx.lineWidth=.5;
    roundRect(ctx,BW+16,BW+16,W-(BW+16)*2,H-(BW+16)*2,1);ctx.stroke();
    // ===== 四角装饰花纹（菱形+卷曲，无圆形）=====
    function drawCornerOrnament(x,y,dx,dy){
        ctx.save();
        ctx.globalAlpha=0.35;  // 半透明，避免遮挡元素
        ctx.strokeStyle='rgba(212,175,100,.75)';ctx.lineWidth=1.5;
        // 中心菱形（距角 15px）
        const cx=x+dx*15,cy=y+dy*15;
        ctx.beginPath();
        ctx.moveTo(cx,cy-6*dy);
        ctx.lineTo(cx+6*dx,cy);
        ctx.lineTo(cx,cy+6*dy);
        ctx.lineTo(cx-6*dx,cy);
        ctx.closePath();
        ctx.stroke();
        // 横向卷曲
        ctx.beginPath();
        ctx.moveTo(x+dx*32,y+dy*8);
        ctx.quadraticCurveTo(x+dx*38,y+dy*8,x+dx*38,y+dy*15);
        ctx.stroke();
        // 纵向卷曲
        ctx.beginPath();
        ctx.moveTo(x+dx*8,y+dy*32);
        ctx.quadraticCurveTo(x+dx*8,y+dy*38,x+dx*15,y+dy*38);
        ctx.stroke();
        ctx.restore();
    }
    drawCornerOrnament(BW+22,BW+22,1,1);       // 左上
    drawCornerOrnament(W-BW-22,BW+22,-1,1);    // 右上
    drawCornerOrnament(BW+22,H-BW-22,1,-1);    // 左下
    drawCornerOrnament(W-BW-22,H-BW-22,-1,-1); // 右下
    // ===== 边框中点小菱形装饰 =====
    function drawMidOrnament(x,y,horizontal){
        ctx.save();
        ctx.fillStyle='rgba(212,175,100,.6)';
        ctx.strokeStyle='rgba(212,175,100,.4)';ctx.lineWidth=.8;
        if(horizontal){
            ctx.beginPath();
            ctx.moveTo(x,y-5);ctx.lineTo(x+5,y);ctx.lineTo(x,y+5);ctx.lineTo(x-5,y);
            ctx.closePath();ctx.fill();ctx.stroke();
            // 两侧小点
            ctx.fillStyle='rgba(212,175,100,.45)';
            ctx.beginPath();ctx.arc(x-12,y,1.5,0,Math.PI*2);ctx.fill();
            ctx.beginPath();ctx.arc(x+12,y,1.5,0,Math.PI*2);ctx.fill();
        }else{
            ctx.beginPath();
            ctx.moveTo(x-5,y);ctx.lineTo(x,y+5);ctx.lineTo(x+5,y);ctx.lineTo(x,y-5);
            ctx.closePath();ctx.fill();ctx.stroke();
            ctx.fillStyle='rgba(212,175,100,.45)';
            ctx.beginPath();ctx.arc(x,y-12,1.5,0,Math.PI*2);ctx.fill();
            ctx.beginPath();ctx.arc(x,y+12,1.5,0,Math.PI*2);ctx.fill();
        }
        ctx.restore();
    }
    drawMidOrnament(W/2,BW,true);     // 顶部中点
    drawMidOrnament(W/2,H-BW,true);   // 底部中点
    drawMidOrnament(BW,H/2,false);    // 左侧中点
    drawMidOrnament(W-BW,H/2,false);  // 右侧中点
    // ===== 左侧区域（与弹窗 sm-left 对应：品牌区 + 分数区 + URL 区）=====
    const LX=80, RX_right=W-80;  // 内容左右边距
    const contentTop=80, contentBottom=H-80;
    ctx.textAlign='left';
    // ===== 顶部品牌区（对应 sm-brand）=====
    ctx.fillStyle='#e8c878';ctx.font='300 32px "Georgia","Times New Roman",serif';
    drawSpacedTextLeft(ctx,'D U C K   D R I F T',LX,contentTop+40,0);
    ctx.fillStyle='rgba(255,255,255,.5)';ctx.font='300 18px sans-serif';
    drawSpacedTextLeft(ctx,'小 黄 鸭 漂 流 记',LX,contentTop+78,2);
    // 品牌区下方分割线（对应 sm-brand 的 border-bottom）
    ctx.strokeStyle='rgba(212,175,100,.25)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(LX,contentTop+110);ctx.lineTo(RX_right,contentTop+110);ctx.stroke();
    // ===== 中间分数区（对应 sm-mid，垂直居中）=====
    const midTop=contentTop+110, midBottom=contentBottom-90;
    const midCenterY=(midTop+midBottom)/2;
    // 模式与玩家信息置于 MY BEST 上方，单人和双人卡片保持一致的阅读顺序。
    ctx.fillStyle='rgba(255,255,255,.55)';ctx.font='400 20px sans-serif';
    let labelTxt=shareMode;
    if(!duoShare&&myRank>0)labelTxt+='   ·   全榜第 #'+myRank+' 名';
    if(ctx.measureText(labelTxt).width>W*.52){
        ctx.font='400 17px sans-serif';
    }
    ctx.fillText(labelTxt,LX,midCenterY-124);
    // MY BEST 小标签（对应 sm-score-tag）
    ctx.fillStyle='rgba(255,210,140,.65)';ctx.font='400 18px sans-serif';
    drawSpacedTextLeft(ctx,'M Y   B E S T',LX,midCenterY-90,3);
    // 大分数（对应 sm-score，自适应字号）
    const scoreStr=formatScore(myBest);
    const scoreLen=scoreStr.length;
    const scoreFontSize=scoreLen<=4?140:scoreLen<=5?115:95;
    ctx.fillStyle='#fff';ctx.font='900 '+scoreFontSize+'px "Georgia","Times New Roman",serif';
    ctx.textBaseline='alphabetic';
    ctx.shadowColor='rgba(255,210,140,.5)';ctx.shadowBlur=36;
    ctx.fillText(scoreStr,LX,midCenterY+40);
    ctx.shadowBlur=0;
    // 本局单项高光：单行胶囊，与分数保留约 34px 呼吸间距；图标用矢量四芒星（不用 emoji，跨平台渲染一致）。
    const highlightColors={
        multiplier:[255,202,83],combo:[255,202,83],
        collection:[99,220,255],collector:[99,220,255],streak:[99,220,255],
        clutch:[255,126,145],survivor:[255,126,145],rescue:[255,126,145]
    };
    const highlightRGB=highlightColors[runHighlight.kind]||[255,205,103];
    const highlightX=LX,highlightY=midCenterY+98,highlightMaxW=440,highlightH=48;
    ctx.font='700 20px "Microsoft YaHei",sans-serif';
    const hlLabel='本局高光',hlBodyRaw=' · '+runHighlight.text;
    const hlLabelW=ctx.measureText(hlLabel).width;
    const hlBody=ellipsizeText(ctx,hlBodyRaw,highlightMaxW-hlLabelW-58);
    const highlightW=Math.min(highlightMaxW,Math.ceil(hlLabelW+ctx.measureText(hlBody).width)+58);
    const highlightBg=ctx.createLinearGradient(highlightX,0,highlightX+highlightW,0);
    highlightBg.addColorStop(0,`rgba(${highlightRGB.join(',')},.16)`);
    highlightBg.addColorStop(1,`rgba(${highlightRGB.join(',')},.045)`);
    ctx.fillStyle=highlightBg;
    roundRect(ctx,highlightX,highlightY-highlightH/2,highlightW,highlightH,highlightH/2);ctx.fill();
    ctx.strokeStyle=`rgba(${highlightRGB.join(',')},.28)`;ctx.lineWidth=1;
    roundRect(ctx,highlightX,highlightY-highlightH/2,highlightW,highlightH,highlightH/2);ctx.stroke();
    // 矢量四芒星图标（纯色平涂，不加发光）
    ctx.save();
    ctx.fillStyle=`rgb(${highlightRGB.join(',')})`;
    const sparkX=highlightX+24;
    ctx.beginPath();
    for(let i=0;i<8;i++){const a=-Math.PI/2+i*Math.PI/4,r=i%2?3:8.5;const px=sparkX+Math.cos(a)*r,py=highlightY+Math.sin(a)*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py)}
    ctx.closePath();ctx.fill();
    ctx.restore();
    // 两段文字：标签用高光色，正文用白色
    ctx.textBaseline='middle';
    ctx.fillStyle=`rgb(${highlightRGB.join(',')})`;
    ctx.fillText(hlLabel,highlightX+42,highlightY+1);
    ctx.fillStyle='rgba(255,255,255,.92)';
    ctx.fillText(hlBody,highlightX+42+hlLabelW,highlightY+1);
    ctx.textBaseline='alphabetic';
    // ===== 底部 URL 区（对应 sm-bottom）=====
    // 上方分割线
    ctx.strokeStyle='rgba(212,175,100,.25)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(LX,contentBottom-50);ctx.lineTo(RX_right,contentBottom-50);ctx.stroke();
    // URL 文字（24px 保证缩略查看时可读）
    ctx.fillStyle='rgba(255,255,255,.58)';ctx.font='400 24px sans-serif';
    ctx.fillText(ellipsizeText(ctx,url,W-LX*2-40),LX,contentBottom-22);
    // ===== 右侧区域：二维码 + 鸭子列（对应 sm-right，水平排列）=====
    // 鸭子位置（略右略下），垂直居中偏下
    const duckSize=280;
    const duckCX=W*.76;
    const duckCY=H*.54;
    // 鸭子背后的大光环
    const duckHalo=ctx.createRadialGradient(duckCX,duckCY,0,duckCX,duckCY,260);
    duckHalo.addColorStop(0,'rgba(255,215,130,.25)');
    duckHalo.addColorStop(.5,'rgba(255,200,100,.1)');
    duckHalo.addColorStop(1,'rgba(255,200,100,0)');
    ctx.fillStyle=duckHalo;
    ctx.beginPath();ctx.arc(duckCX,duckCY,260,0,Math.PI*2);ctx.fill();
    // 装饰外环（围绕鸭子，对应 sm-duck-col::before/::after）
    ctx.strokeStyle='rgba(212,175,100,.25)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(duckCX,duckCY,240,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='rgba(212,175,100,.12)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(duckCX,duckCY,210,0,Math.PI*2);ctx.stroke();
    // 二维码（鸭子圆环左边，与圆环之间留间隙）
    const qrSize=160;
    const ringRadius=240;          // 圆环外缘半径
    const qrGap=28;                // 二维码与圆环之间的间隙
    const qrX=duckCX-ringRadius-qrGap-qrSize;  // 二维码左上角 X
    const qrY=duckCY-qrSize/2;     // 垂直居中对齐鸭子中心
    if(qrDataURL){
        const qrImg=new Image();
        qrImg.src=qrDataURL;
        await new Promise(res=>{qrImg.onload=res;qrImg.onerror=res});
        // 白底圆角 + 双层金边（圆角边框更明显）
        ctx.fillStyle='#fff';
        roundRect(ctx,qrX-10,qrY-10,qrSize+20,qrSize+20,10);ctx.fill();
        ctx.drawImage(qrImg,qrX,qrY,qrSize,qrSize);
        // 外金边
        ctx.strokeStyle='rgba(212,175,100,.7)';ctx.lineWidth=2.5;
        roundRect(ctx,qrX-10,qrY-10,qrSize+20,qrSize+20,10);ctx.stroke();
        // 内细金线
        ctx.strokeStyle='rgba(212,175,100,.3)';ctx.lineWidth=1;
        roundRect(ctx,qrX-3,qrY-3,qrSize+6,qrSize+6,5);ctx.stroke();
    }
    // 完整多 path 小黄鸭 SVG（对应弹窗 sm-right 里的 duck SVG）
    const duckSVG=await (await fetch('./assets/duck-share.svg')).text();
    const duckImg=new Image();
    duckImg.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(duckSVG);
    await new Promise(res=>{duckImg.onload=res;duckImg.onerror=res});
    if(duckImg.width>0){
        ctx.drawImage(duckImg,duckCX-duckSize/2,duckCY-duckSize/2,duckSize,duckSize);
    }
    // 鸭子下方标签（对应 sm-duck-label）
    ctx.fillStyle='rgba(232,200,120,.7)';ctx.font='400 16px "Georgia",serif';
    ctx.textAlign='center';
    drawSpacedText(ctx,'D U C K',duckCX,duckCY+duckSize/2+36,3);
    drawSpacedText(ctx,'D R I F T',duckCX,duckCY+duckSize/2+62,3);
    ctx.textAlign='left';
    // 返回 dataURL（预览和下载共用）
    return canvas.toDataURL('image/png');
}

// 下载分享卡片（与预览共用同一 Promise，确保完全一致）
export async function downloadShareCard(){
    const {Leaderboard,toast}=(_ctx||{});
    if(!Leaderboard||!toast)throw new Error('ShareCard ctx not initialized');
    try{
        const dataURL=await getShareCardDataURL();
        const myBest=Leaderboard.myBest();
        const a=document.createElement('a');
        a.href=dataURL;
        a.download='duck_best_score_'+(myBest||0)+'.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast('<i class="fa-solid fa-hand-pointer"></i> 若下载未开始，可长按图片保存','s');
    }catch(e){
        console.error('downloadShareCard error:',e);
        toast('<i class="fa-solid fa-hand-pointer"></i> 下载失败时，可长按图片保存','m');
    }
}

// 辅助：字距加宽的左对齐文字绘制
function drawSpacedTextLeft(ctx,text,x,y,extraSpacing){
    const chars=[...text];
    let cx=x;
    const oldAlign=ctx.textAlign;
    ctx.textAlign='left';
    for(let i=0;i<chars.length;i++){
        ctx.fillText(chars[i],cx,y);
        cx+=ctx.measureText(chars[i]).width+extraSpacing;
    }
    ctx.textAlign=oldAlign;
}

// 辅助：字距加宽的文字绘制
function drawSpacedText(ctx,text,x,y,extraSpacing){
    const chars=[...text];
    const widths=chars.map(c=>ctx.measureText(c).width);
    const total=widths.reduce((a,b)=>a+b,0)+extraSpacing*(chars.length-1);
    let cx=x-total/2;
    ctx.textAlign='left';
    for(let i=0;i<chars.length;i++){
        ctx.fillText(chars[i],cx,y);
        cx+=widths[i]+extraSpacing;
    }
    ctx.textAlign='center';
}

// 辅助：文字折行
function wrapText(ctx,text,x,y,maxW,lh){
    const chars=[...text];let line='';
    for(let i=0;i<chars.length;i++){
        const test=line+chars[i];
        if(ctx.measureText(test).width>maxW){ctx.fillText(line,x,y);y+=lh;line=chars[i]}
        else line=test;
    }
    if(line)ctx.fillText(line,x,y);
}

function ellipsizeText(ctx,text,maxW){
    if(ctx.measureText(text).width<=maxW)return text;
    const chars=[...text];
    while(chars.length&&ctx.measureText(chars.join('')+'…').width>maxW)chars.pop();
    return chars.join('')+'…';
}

function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
}
