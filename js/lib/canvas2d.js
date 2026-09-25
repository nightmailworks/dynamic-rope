export const worldToPx=(v,p)=>({ x:v.w/2 + (p.x - v.center.x)*v.scale,
                                 y:v.h/2 - (p.y - v.center.y)*v.scale });
export const pxToWorld=(v,p)=>({ x:(p.x - v.w/2)/v.scale + v.center.x,
                                 y:-(p.y - v.h/2)/v.scale + v.center.y });
export function makeView(canvas,{center={x:0,y:0},scale=20}={}){
  const ctx=canvas.getContext('2d');
  const v={ w:canvas.width, h:canvas.height, center, scale };
  const P=(p)=>worldToPx(v,p);
  return {
    view:v, ctx, toPx:P, toWorld:(p)=>pxToWorld(v,p),
    clear(){ ctx.clearRect(0,0,v.w,v.h); },
    line(a,b,{color='#888',width=2,dash=null}={}){ ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=width; if(dash)ctx.setLineDash(dash); const A=P(a),B=P(b); ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.stroke(); ctx.restore(); },
    polyline(pts,{color='#996EFF',width=3}={}){ ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.beginPath(); pts.forEach((p,i)=>{const q=P(p); i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}); ctx.stroke(); ctx.restore(); },
    circleFill(c,r,{color='#3a6b4a'}={}){ ctx.save(); ctx.fillStyle=color; const C=P(c); ctx.beginPath(); ctx.arc(C.x,C.y,r*v.scale,0,7); ctx.fill(); ctx.restore(); },
    dot(p,{color='#e6edf3',r=5}={}){ ctx.save(); ctx.fillStyle=color; const C=P(p); ctx.beginPath(); ctx.arc(C.x,C.y,r,0,7); ctx.fill(); ctx.restore(); },
    arrow(a,b,opts){ this.line(a,b,opts); /* arrowhead optional */ },
    arcStroke(center,r,a0,a1,{color='#996EFF',width=3}={}){ ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=width; const C=P(center); ctx.beginPath(); ctx.arc(C.x,C.y,r*v.scale,-a0, -a1, a1>a0); ctx.stroke(); ctx.restore(); }
  };
}
