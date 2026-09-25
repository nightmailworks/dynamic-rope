const VERT=`attribute vec2 a; void main(){ gl_Position=vec4(a,0.0,1.0); }`;
export function runShader(canvas, fragSrc){
  const gl=canvas.getContext('webgl'); if(!gl) return null;
  const prog=link(gl, VERT, fragSrc);
  const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1, 3,-1, -1,3]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(prog,'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return { gl, draw(uniforms){ gl.useProgram(prog); gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    for(const [k,val] of Object.entries(uniforms)){ const u=gl.getUniformLocation(prog,k);
      if(Array.isArray(val)){ ({2:gl.uniform2fv,3:gl.uniform3fv})[val.length].call(gl,u,val);} else gl.uniform1f(u,val); }
    gl.drawArrays(gl.TRIANGLES,0,3); } };
}
function link(gl,vs,fs){ const p=gl.createProgram(); for(const [t,s] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){ const sh=gl.createShader(t); gl.shaderSource(sh,s); gl.compileShader(sh); if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); gl.attachShader(p,sh);} gl.linkProgram(p); return p; }
