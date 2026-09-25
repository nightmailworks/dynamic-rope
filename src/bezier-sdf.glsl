// Quadratic-Bézier SDF stroke shader for WebGL.
// Inputs as uniforms (these can be packed per instance when batching):
//   uniform vec2 p0, p1, p2;     // control points in PIXELS
//   or b0/b1/b2 arrays when MULTI_BEZIER is defined
//   uniform float half_px;       // half stroke width in pixels
//   uniform vec3 rope_color;     // linear; *glow_boost folded in by the caller
// Fragment position is gl_FragCoord.xy. NOTE: this 2D demo evaluates everything in
// pixel space, so the `v_px` self-consistency trick (projecting control points
// the same way as the fragment to dodge FRAGCOORD's backend Y-flip) is not needed here.
precision highp float;
#ifdef MULTI_BEZIER
#define MAXB 80
uniform vec2 b0[MAXB]; uniform vec2 b1[MAXB]; uniform vec2 b2[MAXB];
#else
uniform vec2 p0, p1, p2;
#endif
uniform float half_px; uniform float aa_px; uniform vec3 rope_color;
float dot2(vec2 v){ return dot(v,v); }
float sdSegment(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0); return length(pa-ba*h); }
float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C){
  vec2 a=B-A, b=A-2.0*B+C, d=A-pos;
  float bb=dot(b,b); if(bb<1e-6) return sdSegment(pos,A,C);
  float kk=1.0/bb, kx=kk*dot(a,b), ky=kk*(2.0*dot(a,a)+dot(d,b))/3.0, kz=kk*dot(d,a);
  float p=ky-kx*kx, p3=p*p*p, q=kx*(2.0*kx*kx-3.0*ky)+kz, h=q*q+4.0*p3; float res;
  if(h>=0.0){ h=sqrt(h); vec2 x=(vec2(h,-h)-q)/2.0; vec2 uv=sign(x)*pow(abs(x),vec2(1.0/3.0)); float t=clamp(uv.x+uv.y-kx,0.0,1.0);
    vec2 qp=(1.0-t)*(1.0-t)*A+2.0*(1.0-t)*t*B+t*t*C; res=length(pos-qp);
  } else { float z=sqrt(-p), v=acos(clamp(q/(p*z*2.0),-1.0,1.0))/3.0, m=cos(v), n=sin(v)*1.732050808;
    vec3 t=clamp(vec3(m+m,-n-m,n-m)*z-kx,0.0,1.0);
    vec2 q0=(1.0-t.x)*(1.0-t.x)*A+2.0*(1.0-t.x)*t.x*B+t.x*t.x*C;
    vec2 q1=(1.0-t.y)*(1.0-t.y)*A+2.0*(1.0-t.y)*t.y*B+t.y*t.y*C;
    vec2 q2=(1.0-t.z)*(1.0-t.z)*A+2.0*(1.0-t.z)*t.z*B+t.z*t.z*C;   // 3rd root, must not be dropped
    res=min(length(pos-q0), min(length(pos-q1), length(pos-q2)));
  } return res;
}
void main(){
#ifdef MULTI_BEZIER
  vec2 p=gl_FragCoord.xy; float d=1e9;
  for(int i=0;i<MAXB;i++){
    vec2 bq=b0[i]-2.0*b1[i]+b2[i];
    float di;
    if(dot(bq,bq) < 1e-6*max(dot2(b2[i]-b0[i]),1.0)) di=sdSegment(p,b0[i],b2[i]);
    else di=sdBezier(p,b0[i],b1[i],b2[i]);
    d=min(d,di);
  }
#else
  vec2 bq=p0-2.0*p1+p2; float d;
  if(dot(bq,bq) < 1e-6*max(dot2(p2-p0),1.0)) d=sdSegment(gl_FragCoord.xy,p0,p2);   // collinear guard
  else d=sdBezier(gl_FragCoord.xy,p0,p1,p2);
#endif
  // aa_px is the AA half-width in PHYSICAL px (caller passes ≈ dpr, i.e. ~1 CSS px).
  // Ramp the edge INSIDE the radius (half_px − aa_px → half_px) so the outer edge sits
  // exactly at half_px. A straddle (half_px ± aa_px) would place the outer edge at
  // half_px + aa_px, making the tube ~1px fatter than intended.
  float alpha = 1.0 - smoothstep(half_px - aa_px, half_px, d);
  if(alpha <= 0.0) discard;
  gl_FragColor=vec4(rope_color, alpha);
  // For 3D ortho + reverse-Z, gl_FragDepth can be written as
  // project(view_z + sqrt(half² - d²)/px_per_m) for a tube-depth imposter.
}
