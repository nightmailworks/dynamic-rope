export const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y});
export const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
export const scale=(a,s)=>({x:a.x*s,y:a.y*s});
export const dot=(a,b)=>a.x*b.x+a.y*b.y;
export const cross=(a,b)=>a.x*b.y-a.y*b.x;
export const len2=(a)=>a.x*a.x+a.y*a.y;
export const len=(a)=>Math.hypot(a.x,a.y);
export const dist2=(a,b)=>len2(sub(a,b));
export const dist=(a,b)=>len(sub(a,b));
export const norm=(a)=>{const l=len(a)||1;return {x:a.x/l,y:a.y/l};};
export const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
export const perp=(a)=>({x:-a.y,y:a.x});                 // +90° CCW
export const rot=(a,th)=>({x:a.x*Math.cos(th)-a.y*Math.sin(th),y:a.x*Math.sin(th)+a.y*Math.cos(th)});
export const fromAngle=(th)=>({x:Math.cos(th),y:Math.sin(th)});
export const angle=(a)=>Math.atan2(a.y,a.x);
