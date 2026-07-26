// 纯工具函数：分数/时间/日期格式化、HTML 转义、UUID 生成
// 注意：escapeHtml 与 genUUID 依赖浏览器 API（DOM / crypto），仍保留在此模块中以便集中管理

/**
 * 生成 UUID（优先使用 crypto.randomUUID，兜底随机字符串）
 */
export function genUUID(){
    if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
        const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);
        return v.toString(16);
    });
}

/**
 * HTML 转义：避免排行榜昵称等用户输入注入
 */
export function escapeHtml(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML}

/**
 * 秒数 → "x分y秒" / "y秒"
 */
export function formatTime(s){const m=Math.floor(s/60),sec=s%60;return m>0?m+'分'+sec+'秒':sec+'秒'}

/**
 * 时间戳 → "M/D HH:MM"
 */
export function formatDate(ts){const d=new Date(ts);return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}

/**
 * 分数格式化：<1k 直接显示，<10k 显示 "x.xxxk"，≥10k 显示 "x.xxxw"
 */
export function formatScore(n){
    const value=Math.max(0,Number(n)||0);
    if(value<1000)return String(Math.floor(value));
    if(value<10000)return(value/1000).toFixed(3)+'k';
    return(value/10000).toFixed(3)+'w';
}
