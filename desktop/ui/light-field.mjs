// GLSL translation of NotchLuma.swift; same light equations and state glides.
const fragment = `precision highp float;
uniform float time, energy, scan, depth, flow;
uniform vec2 res, cardMin, cardMax;
uniform vec3 tint;
    float lhash(vec2 p) {
        p = fract(p * vec2(123.34, 345.45));
        p += vec2(dot(p, p + 34.345));
        return fract(p.x * p.y);
    }

    float lnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(lhash(i), lhash(i + vec2(1, 0)), u.x),
                   mix(lhash(i + vec2(0, 1)), lhash(i + vec2(1, 1)), u.x), u.y);
    }

    void main() {
        // p = 0…1 inside the card (top-left origin, matching the flipped view).
        vec2 span = max(cardMax - cardMin, vec2(1.0));
        vec2 p = (vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) - cardMin) / span;
        if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) { gl_FragColor = vec4(0); return; }

        float T = time;
        float aspect = span.x / span.y;
        vec2 w = vec2(p.x * aspect, p.y);

        // ① Screen-light pool along the lower face — the machined glass catching the display's
        //    glow. Breathes slowly on its own; brighter with energy (the model at work).
        float pool = exp(-(1.0 - p.y) * 3.4);
        pool *= 0.62 + 0.20 * sin(T * 0.55 + p.x * 2.3) + 0.18 * sin(T * 0.23 + 1.7);
        pool *= smoothstep(0.0, 0.10, p.x) * (1.0 - smoothstep(0.90, 1.0, p.x));

        // ② Caustic drift — one slow warped current through the body, biased to the lower half.
        vec2 q = vec2(lnoise(w * 1.3 + vec2(0.0, T * 0.045)),
                          lnoise(w * 1.3 + vec2(3.7, -T * 0.038)));
        float ca = lnoise(w * 1.8 + q * 1.6 + vec2(T * 0.02, 0.0));
        ca = smoothstep(0.52, 0.95, ca) * smoothstep(0.18, 0.70, p.y);

        // ③ Thinking sweep — a soft band of focus crossing the slab, like attention moving.
        float sx = fract(T * 0.30);
        float band = exp(-pow((p.x - mix(-0.25, 1.25, sx)) * 7.5, 2.0));
        float sweep = band * scan * smoothstep(0.15, 0.6, p.y);

        // ④ Token pulse — streaming deltas ripple through the pool from the left.
        float fx = fract(T * 0.9);
        float ripple = exp(-pow((p.x - fx) * 4.0, 2.0)) * flow * exp(-(1.0 - p.y) * 2.5);

        vec3 col = tint * (pool * 0.34 + ca * 0.13 + sweep * 0.22 + ripple * 0.18) * energy;

        // Seam guard: top third stays essentially black so the slab keeps fusing with the
        // hardware cutout; collapsed (depth→0) dims the whole field to a whisper.
        col *= smoothstep(0.04, 0.38, p.y);
        col *= mix(0.30, 1.0, depth);

        // Triangular-PDF dither so the dim gradients never band.
        float dn = lhash(vec2(gl_FragCoord.x, res.y - gl_FragCoord.y)) + lhash(vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) + 13.1) - 1.0;
        col = clamp(col + dn / 255.0, 0.0, 0.85);

        // Premultiplied over the black slab (source-over ≈ additive); col ≤ a keeps it legal.
        float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 0.85);
        gl_FragColor = vec4(col, a);
    }
`;
export function lightTarget(status) {
  const accent = [.48*.7+.25, .63*.7+.28, 1*.7+.30];
  if (status === 'running') return {energy:.58,scan:1,tint:accent};
  if (status === 'streaming') return {energy:.44,scan:0,tint:accent};
  if (status === 'error') return {energy:.30,scan:0,tint:[1,.55,.22]};
  return {energy:.11,scan:0,tint:[.55,.62,.85]};
}
export class LightField {
  constructor(parent) {
    this.canvas=document.createElement('canvas');this.canvas.className='light-field';this.canvas.setAttribute('aria-hidden','true');parent.append(this.canvas);
    this.gl=this.canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false});
    this.shown=lightTarget('ready');this.target=lightTarget('ready');this.flow=0;this.depth=0;this.status='ready';this.start=performance.now();this.frame=null;
    this.reduce=matchMedia('(prefers-reduced-motion:reduce)');
    const gl=this.gl;if(!gl){this.canvas.dataset.renderer='unavailable';return;}
    const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    try {
      const vertex=compile(gl.VERTEX_SHADER,'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}');
      const frag=compile(gl.FRAGMENT_SHADER,fragment);this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,frag);gl.linkProgram(this.program);
      gl.deleteShader(vertex);gl.deleteShader(frag);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
      gl.useProgram(this.program);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      const a=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
      this.u=Object.fromEntries(['time','energy','scan','depth','flow','res','cardMin','cardMax','tint'].map(k=>[k,gl.getUniformLocation(this.program,k)]));
      this.canvas.dataset.renderer='webgl';
    } catch(error) {this.canvas.dataset.renderer='unavailable';this.canvas.hidden=true;this.program=null;console.warn('Notch light field unavailable:',error.message);return;}
    this.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(this.frame);this.frame=null;this.program=null;this.canvas.dataset.renderer='unavailable';});
    this.reduce.addEventListener('change',()=>this.wake());
    document.addEventListener('visibilitychange',()=>this.wake());
  }
  update(status,depth,width,height,pulse=false) {
    this.status=status;this.target=lightTarget(status);this.depth=Math.max(0,Math.min(1,depth));this.width=width;this.height=height;
    if(pulse&&!this.reduce.matches)this.flow=Math.min(1.2,this.flow+.55);
    this.wake();
  }
  wake() {
    if(!this.program)return;
    if(document.hidden){cancelAnimationFrame(this.frame);this.frame=null;return;}
    if(this.reduce.matches){cancelAnimationFrame(this.frame);this.frame=null;this.shown={...this.target,tint:[...this.target.tint]};this.flow=0;this.draw(this.start+1000);return;}
    if(this.frame===null)this.frame=requestAnimationFrame(now=>this.step(now));
  }
  step(now) {
    this.frame=null;
    if(!this.program||document.hidden)return;
    // Native display link caps expanded light at 60 Hz and collapsed settling at 30 Hz.
    const interval = this.depth < .05 ? 1000/30 : 1000/60;
    if (this.lastTick != null && now-this.lastTick < interval-.5) { this.wake(); return; }
    this.lastTick=now;
    this.shown.energy+=(this.target.energy-this.shown.energy)*.07;
    this.shown.scan+=(this.target.scan-this.shown.scan)*.09;
    this.shown.tint=this.shown.tint.map((v,i)=>v+(this.target.tint[i]-v)*.07);this.flow*=.90;
    this.draw(now);
    if(this.depth>.02||['running','streaming'].includes(this.status)||Math.abs(this.shown.energy-this.target.energy)>.004||this.flow>.01||Math.abs(this.shown.scan-this.target.scan)>.01)this.wake();
  }
  draw(now) {
    if(!this.width||!this.height)return;
    const gl=this.gl,dpr=Math.min(devicePixelRatio||1,1),w=Math.max(1,Math.round(this.width*dpr)),h=Math.max(1,Math.round(this.height*dpr));
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    gl.viewport(0,0,w,h);gl.useProgram(this.program);
    for(const [k,v] of Object.entries({time:(now-this.start)/1000,energy:this.shown.energy,scan:this.shown.scan,depth:this.depth,flow:this.flow}))gl.uniform1f(this.u[k],v);
    gl.uniform2f(this.u.res,w,h);gl.uniform2f(this.u.cardMin,0,0);gl.uniform2f(this.u.cardMax,w,h);gl.uniform3fv(this.u.tint,this.shown.tint);gl.drawArrays(gl.TRIANGLES,0,3);
  }
}
