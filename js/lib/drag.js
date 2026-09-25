import { pxToWorld } from './canvas2d.js';
export function makeDraggable(canvas, getView, handles, onChange){
  let active=null;
  const pos=(e)=>{const r=canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)*canvas.width/r.width, y:(e.clientY-r.top)*canvas.height/r.height};};
  canvas.addEventListener('pointerdown',e=>{ const m=pos(e);
    for(const h of handles){ const hp=worldPx(getView(),h.get()); if(Math.hypot(hp.x-m.x,hp.y-m.y)<=(h.r??12)){active=h;canvas.setPointerCapture(e.pointerId);break;} } });
  canvas.addEventListener('pointermove',e=>{ if(!active)return; active.set(pxToWorld(getView(),pos(e))); onChange&&onChange(); });
  canvas.addEventListener('pointerup',()=>active=null);
  canvas.addEventListener('pointercancel',()=>active=null);
}
function worldPx(v,p){ return { x:v.w/2+(p.x-v.center.x)*v.scale, y:v.h/2-(p.y-v.center.y)*v.scale }; }
