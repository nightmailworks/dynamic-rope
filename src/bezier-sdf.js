// Inigo Quilez's exact signed distance to a quadratic Bézier (unsigned magnitude).
export function sdBezier(p, A, B, C) {
  const sub=(u,v)=>({x:u.x-v.x,y:u.y-v.y});
  const dot=(u,v)=>u.x*v.x+u.y*v.y;
  const a=sub(B,A), b={x:A.x-2*B.x+C.x, y:A.y-2*B.y+C.y}, d=sub(A,p);
  const bb=dot(b,b);
  if (bb < 1e-12) return sdSegment(p, A, C);          // degenerate → straight
  const kk=1/bb;
  const kx=kk*dot(a,b);
  const ky=kk*(2*dot(a,a)+dot(d,b))/3;
  const kz=kk*dot(d,a);
  const P=ky-kx*kx, P3=P*P*P;
  const q=kx*(2*kx*kx-3*ky)+kz;
  let h=q*q+4*P3, res;
  const cx=(t)=>{const a2=1-t;return {x:a2*a2*A.x+2*a2*t*B.x+t*t*C.x,y:a2*a2*A.y+2*a2*t*B.y+t*t*C.y};};
  const dpt=(t)=>{const q2=cx(clamp01(t));return Math.hypot(p.x-q2.x,p.y-q2.y);};
  if (h>=0){
    h=Math.sqrt(h);
    const x1=(-h-q)/2, x2=(h-q)/2;
    const u=Math.sign(x1)*Math.cbrt(Math.abs(x1)), v=Math.sign(x2)*Math.cbrt(Math.abs(x2));
    res=dpt(u+v-kx);
  } else {
    const z=Math.sqrt(-P);
    const arg=Math.max(-1,Math.min(1, q/(P*z*2)));     // clamp guards FP drift past ±1 → NaN
    const v=Math.acos(arg)/3, m=Math.cos(v), n=Math.sin(v)*Math.sqrt(3);
    res=Math.min(dpt((m+m)*z-kx), Math.min(dpt((-n-m)*z-kx), dpt((n-m)*z-kx)));
  }
  return res;
}
export function sdSegment(p, A, B) {
  const pa={x:p.x-A.x,y:p.y-A.y}, ba={x:B.x-A.x,y:B.y-A.y};
  const h=clamp01((pa.x*ba.x+pa.y*ba.y)/(ba.x*ba.x+ba.y*ba.y||1e-12));
  return Math.hypot(pa.x-ba.x*h, pa.y-ba.y*h);
}
const clamp01=(t)=>t<0?0:t>1?1:t;
