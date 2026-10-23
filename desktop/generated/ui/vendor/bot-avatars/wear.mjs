import { rasterize, PAD, SPAN } from './plastic.mjs';
import { shade, parseColor } from './color.mjs';
import { makeMesh, makeTube, makeView, projectMesh, section, paintLayers, boundsOf, hull, norm, cross, sub, segs, felt, velvet, paper, plastic, satin, gold, silver, metal, sphereSprite, cutGem, scale } from './mesh.mjs';
function seat(m, frac) {
    const W = m.right - m.left;
    for(let i = 0; i < m.widths.length; i++)if (m.widths[i] >= frac * W) return i * m.step - PAD;
    return m.top;
}
const marks = new WeakMap();
function marksFor(path) {
    const hit = marks.get(path);
    if (hit) return hit;
    const N = 128;
    const cov = rasterize(path, N);
    if (!cov) return null;
    const u = SPAN / N;
    const toX = (i)=>(i + 0.5) * u - PAD;
    const inside = (x, y)=>cov[y * N + x] >= 128;
    const c0 = Math.floor((42 + PAD) / u), c1 = Math.ceil((58 + PAD) / u);
    let top = N, bottom = -1;
    for(let x = c0; x <= c1; x++){
        for(let y = 0; y < N; y++)if (inside(x, y)) {
            if (y < top) top = y;
            break;
        }
        for(let y = N - 1; y >= 0; y--)if (inside(x, y)) {
            if (y > bottom) bottom = y;
            break;
        }
    }
    const row = (y)=>{
        let l = -1, r = -1;
        for(let x = 0; x < N; x++)if (inside(x, y)) {
            if (l < 0) l = x;
            r = x;
        }
        return [
            l,
            r
        ];
    };
    const yT = Math.min(N - 1, top + Math.round(8 / u));
    const [tl, tr] = row(yT);
    let best = -1, bl = 0, br = 0, by = 0;
    for(let y = Math.round((33 + PAD) / u); y <= Math.round((67 + PAD) / u); y++){
        const [l, r] = row(y);
        if (l >= 0 && r - l > best) {
            best = r - l;
            bl = l;
            br = r;
            by = y;
        }
    }
    const widths = new Float32Array(N);
    const edge = [];
    for(let y = 0; y < N; y++){
        const [l, r] = row(y);
        widths[y] = l < 0 ? 0 : (r - l + 1) * u;
        if (l >= 0) edge.push([
            toX(l) - 0.5 * u,
            toX(y)
        ], [
            toX(r) + 0.5 * u,
            toX(y)
        ]);
    }
    const m = {
        top: toX(top) - 0.5 * u,
        topL: toX(tl),
        topR: toX(tr),
        mid: toX(by),
        left: toX(bl) - 0.5 * u,
        right: toX(br) + 0.5 * u,
        bottom: toX(bottom) + 0.5 * u,
        widths,
        step: u,
        hull: hull(edge)
    };
    marks.set(path, m);
    return m;
}
function project(r, p) {
    const X = p[0] - 50, Y = p[1] - 50;
    return [
        r.cy * X + r.sy * p[2],
        r.sy * r.sp * X + r.cp * Y - r.cy * r.sp * p[2]
    ];
}
function depthOf(r, p) {
    return -r.sy * r.cp * (p[0] - 50) + r.sp * (p[1] - 50) + r.cy * r.cp * p[2];
}
function tilt(v, roll, lean) {
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const x = v[0] * cr - v[1] * sr, y = v[0] * sr + v[1] * cr;
    const cl = Math.cos(lean), sl = Math.sin(lean);
    return [
        x,
        y * cl - v[2] * sl,
        y * sl + v[2] * cl
    ];
}
const add = (a, b)=>[
        a[0] + b[0],
        a[1] + b[1],
        a[2] + b[2]
    ];
const along = (a, d, k)=>[
        a[0] + d[0] * k,
        a[1] + d[1] * k,
        a[2] + d[2] * k
    ];
function polyPath(pts, close = true) {
    const p = new Path2D();
    pts.forEach((q, i)=>i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]));
    if (close) p.closePath();
    return p;
}
function bounds(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts){
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
    }
    return {
        x0,
        y0,
        x1,
        y1,
        cx: (x0 + x1) / 2,
        cy: (y0 + y1) / 2,
        w: x1 - x0,
        h: y1 - y0
    };
}
const rnd = (i, k = 0)=>{
    let h = i * 2654435761 + k * 40503 | 0;
    h = Math.imul(h ^ h >>> 15, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
};
let grain = null;
function grainTile() {
    if (grain) return grain;
    const n = 48;
    const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(n, n) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), {
        width: n,
        height: n
    }) : null;
    const g = c && c.getContext('2d');
    if (!c || !g) return null;
    const img = g.createImageData(n, n);
    for(let i = 0; i < n * n; i++){
        const x = i % n, y = i / n | 0;
        let v = 0;
        for(let k = -2; k <= 2; k++)v += rnd((x + k + n) % n + (y + k + n) % n * n, 5);
        v /= 5;
        const m = Math.round(255 * (0.82 + 0.36 * v));
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.min(255, m);
        img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grain = c;
    return c;
}
const patterns = new WeakMap();
function grainOver(ctx, outline, alpha, scaleK = 0.18) {
    const tile = grainTile();
    if (!tile || outline.length < 3) return;
    let byScale = patterns.get(ctx);
    if (!byScale) patterns.set(ctx, byScale = new Map());
    let pat = byScale.get(scaleK);
    if (pat === undefined) {
        pat = ctx.createPattern(tile, 'repeat');
        pat?.setTransform?.(new DOMMatrix().scale(scaleK));
        byScale.set(scaleK, pat);
    }
    if (!pat) return;
    const b = bounds(outline);
    ctx.save();
    ctx.clip(polyPath(outline));
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pat;
    ctx.fillRect(b.x0 - 1, b.y0 - 1, b.w + 2, b.h + 2);
    ctx.restore();
}
function fuzz(ctx, outline, base, seed, len, px = 2.4) {
    const n = outline.length;
    if (n < 3) return;
    let total = 0;
    const seg = [];
    for(let i = 0; i < n; i++){
        const a = outline[i], c = outline[(i + 1) % n];
        const d = Math.hypot(c[0] - a[0], c[1] - a[1]);
        seg.push(d);
        total += d;
    }
    const count = Math.min(360, Math.max(24, Math.round(total * Math.min(2.4, px * 0.5))));
    const b = bounds(outline);
    const lightP = new Path2D(), darkP = new Path2D();
    let si = 0, acc = 0;
    for(let k = 0; k < count; k++){
        const want = (k + rnd(k, seed) * 0.8) * (total / count);
        while(si < n - 1 && acc + seg[si] < want)acc += seg[si++];
        const a = outline[si], c = outline[(si + 1) % n];
        const t = seg[si] ? (want - acc) / seg[si] : 0;
        const x = a[0] + (c[0] - a[0]) * t, y = a[1] + (c[1] - a[1]) * t;
        let ox = x - b.cx, oy = y - b.cy;
        const ol = Math.hypot(ox, oy) || 1;
        ox /= ol;
        oy /= ol;
        const ang = (rnd(k, seed + 1) - 0.5) * 0.9;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const hx = ox * ca - oy * sa, hy = ox * sa + oy * ca;
        const l = len * (0.35 + rnd(k, seed + 2));
        const p = rnd(k, seed + 3) > 0.5 ? lightP : darkP;
        p.moveTo(x - hx * 0.4, y - hy * 0.4);
        p.lineTo(x + hx * l, y + hy * l);
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.4;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = shade(base, 0.14);
    ctx.stroke(lightP);
    ctx.strokeStyle = shade(base, -0.06);
    ctx.stroke(darkP);
    ctx.restore();
}
function contact(ctx, clip, cx, cy, rx, ry, a) {
    if (!(rx > 0) || !(ry > 0)) return;
    ctx.save();
    if (clip) ctx.clip(clip);
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.55, `rgba(0,0,0,${a * 0.45})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
const EL = 48 * Math.PI / 180;
function lightOf(lx, ly) {
    const le = Math.cos(EL), lz = Math.sin(EL);
    const L = norm([
        lx * le,
        ly * le,
        lz
    ]);
    return {
        L,
        H: norm([
            L[0],
            L[1],
            L[2] + 1
        ])
    };
}
function pxOf(ctx) {
    const t = ctx.getTransform?.();
    return t ? Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1 : 2;
}
function viewOf(r, px) {
    const { L, H } = lightOf(r.lx, r.ly);
    return makeView([
        r.cy,
        0,
        r.sy,
        r.sy * r.sp,
        r.cp,
        -r.cy * r.sp,
        -r.sy * r.cp,
        r.sp,
        r.cy * r.cp
    ], [
        50,
        50,
        0
    ], L, H, px);
}
const kept = new WeakMap();
let owner = kept;
function keep(key, make) {
    let c = kept.get(owner);
    if (!c) kept.set(owner, c = new Map());
    let g = c.get(key);
    if (!g) {
        if (c.size > 240) c.clear();
        g = make();
        c.set(key, g);
    }
    return g;
}
function surface(view, key, surf, nu, nv, inside, smooth = true) {
    return projectMesh(view, keep(`${key}|${nu}x${nv}`, ()=>makeMesh(surf, nu, nv, inside, smooth)));
}
function tube(view, key, path, up, prof, nu, nv, closed = false) {
    return projectMesh(view, keep(`${key}|${nu}x${nv}`, ()=>makeTube(path, up, prof, nu, nv, closed)));
}
const rgbOf = (c, fallback = [
    40,
    40,
    44
])=>parseColor(c) ?? fallback;
const TAU = Math.PI * 2;
const smooth01 = (t)=>t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const spow = (c, e)=>Math.sign(c) * Math.pow(Math.abs(c), e);
function sphereMesh(view, key, c, rad, nu, nv) {
    return surface(view, key, (u, v)=>{
        const th = u * TAU, ph = v * Math.PI;
        return [
            c[0] + rad * Math.sin(ph) * Math.cos(th),
            c[1] - rad * Math.cos(ph),
            c[2] + rad * Math.sin(ph) * Math.sin(th)
        ];
    }, nu, nv, c);
}
function ringMesh(view, key, place, R, y, t, zScale, nu, nv) {
    return surface(view, key, (u, v)=>{
        const th = u * TAU, ph = v * TAU;
        const rr = R + t * Math.cos(ph);
        return place([
            rr * Math.cos(th),
            y - t * Math.sin(ph),
            rr * zScale * Math.sin(th)
        ]);
    }, nu, nv, (u)=>place([
            R * Math.cos(u * TAU),
            y,
            R * zScale * Math.sin(u * TAU)
        ]));
}
function offsetPath(path, up, off) {
    return (u)=>{
        const e = 1e-3;
        const T = norm(sub(path(Math.min(1, u + e)), path(Math.max(0, u - e))));
        const B = cross(T, up);
        return along(path(u), B, off(u));
    };
}
function yarnBall(ctx, view, c, rad, base, seed) {
    const rgb = rgbOf(base);
    const n = segs(view, TAU * rad, 12, 20);
    const vis = paintLayers(ctx, [
        {
            parts: [
                sphereMesh(view, `ball${seed}`, c, rad * 0.86, n, Math.max(6, n >> 1))
            ],
            shade: felt(view, rgb, 0.92)
        }
    ], view.px);
    const centre = view.toScreen(c);
    const b = bounds(vis);
    const R = Math.max(b.w, b.h) / 2;
    const count = Math.round(Math.min(340, 50 + R * view.px * 5));
    const light = new Path2D(), dark = new Path2D();
    for(let k = 0; k < count; k++){
        const a = rnd(k, seed) * TAU;
        const r0 = R * (0.25 + 0.7 * Math.sqrt(rnd(k, seed + 1)));
        const len = R * (0.25 + 0.35 * rnd(k, seed + 2));
        const x0 = centre[0] + Math.cos(a) * r0, y0 = centre[1] + Math.sin(a) * r0;
        const bend = (rnd(k, seed + 3) - 0.5) * 0.6;
        const ex = Math.cos(a + bend), ey = Math.sin(a + bend);
        const p = rnd(k, seed + 4) > 0.45 ? light : dark;
        p.moveTo(x0, y0);
        p.quadraticCurveTo(x0 + Math.cos(a) * len * 0.5, y0 + Math.sin(a) * len * 0.5, x0 + ex * len, y0 + ey * len);
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.3, R * 0.06);
    const L = view.L;
    const g = ctx.createLinearGradient(centre[0] + L[0] * R, centre[1] + L[1] * R, centre[0] - L[0] * R, centre[1] - L[1] * R);
    g.addColorStop(0, shade(base, 0.2, -0.03));
    g.addColorStop(1, shade(base, -0.12, 0.02));
    ctx.strokeStyle = g;
    ctx.globalAlpha = 0.85;
    ctx.stroke(light);
    ctx.strokeStyle = shade(base, -0.18, 0.03);
    ctx.globalAlpha = 0.6;
    ctx.stroke(dark);
    ctx.restore();
}
function drawBeret(ctx, view, m, base, bodyClip) {
    const W = m.right - m.left;
    const R = 0.46 * W, Hh = 0.21 * W, Rb = 0.33 * W, lift = 0.05 * W;
    const C = [
        50 - 0.07 * W,
        Math.max(m.top + 0.22 * W, seat(m, 0.5) + 0.1 * W),
        0
    ];
    const roll = -0.24, lean = -0.2;
    const place = (p)=>add(C, tilt(p, roll, lean));
    const nu = segs(view, TAU * R, 32, 56), nv = segs(view, 1.2 * R, 10, 32, 6);
    const surf = (u, v)=>{
        const th = u * TAU;
        let rr, hh;
        const E = 0.74;
        if (v <= E) {
            const phi = v / E * (Math.PI / 2);
            rr = R * Math.sin(phi);
            hh = -(lift + Hh * Math.pow(Math.cos(phi), 0.8));
        } else {
            const f = smooth01((v - E) / (1 - E));
            rr = R + (Rb - R) * f;
            hh = -lift * (1 - f);
        }
        const band = Math.sin(Math.min(1, v / E) * Math.PI * 0.9);
        rr *= 1 + 0.035 * Math.sin(th * 7 + 0.4) * band;
        return place([
            rr * Math.cos(th),
            hh,
            rr * 0.93 * Math.sin(th)
        ]);
    };
    const dome = surface(view, 'beret:dome', surf, nu, nv, place([
        0,
        -lift - Hh * 0.4,
        0
    ]));
    const under = surface(view, 'beret:under', (u, v)=>{
        const th = u * TAU, rr = Rb * (1 - v);
        return place([
            rr * Math.cos(th),
            -0.004 * W * v,
            rr * 0.93 * Math.sin(th)
        ]);
    }, 24, 2, place([
        0,
        -lift - Hh * 0.4,
        0
    ]));
    const rgb = rgbOf(base);
    const bandMid = view.toScreen(place([
        0,
        0.02 * W,
        0
    ]));
    contact(ctx, bodyClip, bandMid[0] + 0.02 * W, bandMid[1] + 0.045 * W, Rb * 1.25, 0.08 * W, 0.4);
    const binding = ringMesh(view, 'beret:binding', place, Rb, -0.005 * W, 0.022 * W, 0.93, segs(view, TAU * Rb, 24, 48), 5);
    const leather = rgbOf(shade(base, -0.06));
    const vis = paintLayers(ctx, [
        {
            parts: [
                under
            ],
            shade: felt(view, rgb, 0.7)
        },
        {
            parts: [
                binding
            ],
            shade: plastic(view, leather, 0.45)
        },
        {
            parts: [
                dome
            ],
            shade: felt(view, rgb)
        }
    ], view.px);
    const outline = hull(vis);
    grainOver(ctx, outline, 0.5, 0.14);
    fuzz(ctx, outline, base, 11, 0.4, view.px);
    const x0 = 0.02 * W, y0 = -lift - Hh + 0.006 * W;
    const stalk = tube(view, 'beret:stalk', (u)=>place([
            x0 + 0.014 * W * u * u,
            y0 - 0.045 * W * u,
            0
        ]), [
        0,
        0,
        1
    ], (u, ph)=>[
            0.016 * W * (1 - 0.25 * u) * Math.cos(ph),
            0.016 * W * (1 - 0.25 * u) * Math.sin(ph)
        ], 8, 3);
    paintLayers(ctx, [
        {
            parts: [
                stalk
            ],
            shade: felt(view, rgb, 0.95)
        }
    ], view.px);
    sphereSprite(ctx, view, place([
        x0 + 0.014 * W,
        y0 - 0.047 * W,
        0
    ]), 0.019 * W, scale(rgb, 1.15));
}
function drawBeanie(ctx, view, m, base, bodyClip) {
    const W = m.right - m.left;
    const headW = Math.max(0.5 * W, m.topR - m.topL);
    const Rd = 0.53 * headW + 0.08 * W, Hd = 0.32 * W, cuffH = 0.1 * W, Rc = Rd * 1.05;
    const C = [
        50,
        seat(m, 0.72) + 0.06 * W,
        0
    ];
    const roll = 0, lean = -0.14;
    const place = (p)=>add(C, tilt(p, roll, lean));
    const domeSurf = (u, v)=>{
        const th = u * TAU, phi = v * (Math.PI / 2);
        const rr = Rd * Math.sin(phi) * (1 - 0.03 * (1 - v));
        const hh = -(cuffH + Hd * Math.cos(phi));
        return place([
            rr * Math.cos(th),
            hh,
            rr * 0.92 * Math.sin(th)
        ]);
    };
    const inDome = place([
        0,
        -cuffH - Hd * 0.4,
        0
    ]);
    const dome = surface(view, 'beanie:dome', domeSurf, segs(view, TAU * Rd, 28, 48), segs(view, 1.3 * Hd, 9, 24, 6), inDome);
    const cuffSurf = (u, v)=>{
        const th = u * TAU;
        const e = 2 * v - 1;
        const rr = Rc * (1 - 0.07 * e * e * e * e) * 1.01;
        return place([
            rr * Math.cos(th),
            -cuffH * (1 - v),
            rr * 0.92 * Math.sin(th)
        ]);
    };
    const cuff = surface(view, 'beanie:cuff', cuffSurf, segs(view, TAU * Rc, 28, 56), 4, place([
        0,
        -cuffH / 2,
        0
    ]));
    const rgb = rgbOf(base), cuffRgb = rgbOf(shade(base, 0.03));
    const bb = boundsOf([
        cuff
    ]);
    contact(ctx, bodyClip, bb.cx, bb.y1 - 0.01 * W, bb.w * 0.5, 0.06 * W, 0.34);
    const visDome = paintLayers(ctx, [
        {
            parts: [
                dome
            ],
            shade: felt(view, rgb, 0.96)
        }
    ], view.px);
    const NU = 40, NV = 11;
    const cell = Rd * TAU / NU * view.px;
    if (cell >= 2.2) {
        const grid = surface(view, 'beanie:stitch', domeSurf, NU, NV, inDome, false);
        const dark = new Path2D(), light = new Path2D();
        const GW = NU + 1;
        for(let c = 0; c < NU * NV; c++){
            if (grid.f[c * 3 + 2] < 0.12) continue;
            const k = Math.floor(c / NU) * GW + c % NU;
            const A = [
                grid.x[k],
                grid.y[k]
            ], B = [
                grid.x[k + 1],
                grid.y[k + 1]
            ];
            const Cq = [
                grid.x[k + GW + 1],
                grid.y[k + GW + 1]
            ], D = [
                grid.x[k + GW],
                grid.y[k + GW]
            ];
            const at = (s, t)=>{
                const top = [
                    A[0] + (B[0] - A[0]) * s,
                    A[1] + (B[1] - A[1]) * s
                ];
                const bot = [
                    D[0] + (Cq[0] - D[0]) * s,
                    D[1] + (Cq[1] - D[1]) * s
                ];
                return [
                    top[0] + (bot[0] - top[0]) * t,
                    top[1] + (bot[1] - top[1]) * t
                ];
            };
            for (const [p, dx] of [
                [
                    dark,
                    0
                ],
                [
                    light,
                    -0.06
                ]
            ]){
                const a = at(0.14 + dx, 0.12), b = at(0.5 + dx, 0.88), c = at(0.86 + dx, 0.12);
                p.moveTo(a[0], a[1]);
                p.lineTo(b[0], b[1]);
                p.lineTo(c[0], c[1]);
            }
        }
        const cw = Rd * TAU / NU;
        ctx.save();
        ctx.clip(polyPath(hull(visDome)));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(0.35, cw * 0.2);
        ctx.strokeStyle = shade(base, -0.22, 0.03);
        ctx.globalAlpha = 0.5;
        ctx.stroke(dark);
        ctx.lineWidth = Math.max(0.3, cw * 0.12);
        ctx.strokeStyle = shade(base, 0.2, -0.03);
        ctx.globalAlpha = 0.35;
        ctx.stroke(light);
        ctx.restore();
    }
    const visCuff = paintLayers(ctx, [
        {
            parts: [
                cuff
            ],
            shade: felt(view, cuffRgb, 0.98)
        }
    ], view.px);
    const ribGap = TAU * Rc / 30;
    if (ribGap * view.px >= 3) {
        const groove = new Path2D(), ridge = new Path2D();
        for(let k = 0; k < 60; k++){
            const u = k / 60;
            const th = u * TAU;
            if (view.dir(tilt([
                Math.cos(th),
                0,
                0.92 * Math.sin(th)
            ], roll, lean))[2] < 0.08) continue;
            const a = view.toScreen(cuffSurf(u, 0.1)), b = view.toScreen(cuffSurf(u, 0.9));
            const p = k % 2 ? groove : ridge;
            p.moveTo(a[0], a[1]);
            p.lineTo(b[0], b[1]);
        }
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = ribGap * 0.34;
        ctx.strokeStyle = shade(base, -0.2, 0.03);
        ctx.globalAlpha = 0.45;
        ctx.stroke(groove);
        ctx.lineWidth = ribGap * 0.22;
        ctx.strokeStyle = shade(base, 0.16, -0.02);
        ctx.globalAlpha = 0.4;
        ctx.stroke(ridge);
        ctx.restore();
    }
    const outline = hull(visDome.concat(visCuff));
    fuzz(ctx, outline, base, 23, 0.35, view.px);
    yarnBall(ctx, view, place([
        0,
        -cuffH - Hd - 0.055 * W,
        0
    ]), 0.085 * W, shade(base, 0.06), 31);
}
function drawParty(ctx, view, m, base, bodyClip) {
    const W = m.right - m.left;
    const C = [
        50 + 0.06 * W,
        seat(m, 0.3) + 0.04 * W,
        0
    ];
    const R = 0.18 * W, H = Math.max(0.3 * W, Math.min(0.46 * W, C[1] + 31 - 0.1 * W));
    const roll = 0.18, lean = -0.12;
    const place = (p)=>add(C, tilt(p, roll, lean));
    const coneAt = (u, v, grow = 1)=>{
        const th = u * TAU;
        const rr = R * (1 - v) * (1 + 0.04 * Math.sin(v * Math.PI)) * grow;
        return place([
            rr * Math.cos(th),
            -H * v,
            rr * Math.sin(th)
        ]);
    };
    const inCone = (_u, v)=>place([
            0,
            -H * Math.min(0.97, v),
            0
        ]);
    const nAround = segs(view, TAU * R, 20, 40), nUp = segs(view, H, 10, 24, 6);
    const cone = surface(view, 'party:cone', (u, v)=>coneAt(u, v), nAround, nUp, inCone);
    const a = rgbOf(base), b = [
        252,
        246,
        234
    ];
    const bb = boundsOf([
        cone
    ]);
    contact(ctx, bodyClip, bb.cx, bb.y1, R * 1.15, 0.04 * W, 0.3);
    const trim = ringMesh(view, 'party:trim', place, R * 1.02, 0.004 * W, 0.016 * W, 1, segs(view, TAU * R, 20, 40), 5);
    const stripes = [];
    const K = 6, twist = 3.2;
    for(let k = 0; k < K; k += 1){
        stripes.push(surface(view, `party:stripe${k}`, (s, t)=>coneAt((k + 0.5 * t - twist * s * 0.97) / K, s * 0.97, 1.004), nUp + 3, 1, inCone));
    }
    const vis = paintLayers(ctx, [
        {
            parts: [
                cone
            ],
            shade: paper(view, b)
        },
        {
            parts: [
                trim
            ],
            shade: gold(view)
        }
    ], view.px);
    paintLayers(ctx, [
        {
            parts: stripes,
            shade: paper(view, a)
        }
    ], view.px);
    grainOver(ctx, hull(vis), 0.18, 0.1);
    yarnBall(ctx, view, place([
        0,
        -H - 0.035 * W,
        0
    ]), 0.06 * W, '#f4efe6', 37);
}
function drawCrown(ctx, view, m, bodyClip) {
    const W = m.right - m.left;
    const headW = Math.max(0.45 * W, m.topR - m.topL);
    const R = 0.44 * headW + 0.07 * W, bandH = 0.11 * W, pointH = 0.15 * W, ez = 0.9;
    const C = [
        50,
        seat(m, 0.42) + 0.05 * W,
        0
    ];
    const roll = 0.05, lean = -0.22;
    const place = (p)=>add(C, tilt(p, roll, lean));
    const dirOf = (v)=>norm(tilt(v, roll, lean));
    const on = (th, rr, y)=>place([
            rr * Math.cos(th),
            y,
            rr * ez * Math.sin(th)
        ]);
    const axis = (y)=>place([
            0,
            y,
            0
        ]);
    const nu = segs(view, TAU * R, 32, 64);
    const band = surface(view, 'crown:band', (u, v)=>on(u * TAU, R * (1 - 0.018 * Math.sin(v * Math.PI)), -bandH * (1 - v)), nu, 2, (_u, v)=>axis(-bandH * (1 - v)));
    const rimT = 0.017 * W;
    const rimTop = ringMesh(view, 'crown:rimTop', place, R + 0.004 * W, -bandH, rimT, ez, nu, 5);
    const rimBot = ringMesh(view, 'crown:rimBot', place, R + 0.004 * W, 0, rimT * 1.15, ez, nu, 5);
    const capBase = -bandH * 0.55;
    const capH = Math.max(0.12 * W, C[1] - m.top + 0.04 * W + capBase);
    const P0 = Math.PI / 2;
    const cap = surface(view, 'crown:cap', (u, v)=>{
        const th = u * TAU, phi = v * (Math.PI / 2);
        const puff = 0.08 * Math.sin(2 * phi) * (0.55 + 0.45 * Math.cos(5 * (th - P0 - Math.PI / 5)));
        return on(th, R * (0.9 * Math.sin(phi) + puff), capBase - capH * Math.cos(phi));
    }, segs(view, TAU * R, 24, 48), segs(view, 1.4 * capH, 8, 20, 6), axis(capBase - capH * 0.4));
    const points = [], buds = [];
    const pearls = [], budTops = [];
    const plate = (key, a0, w, h, ridge, flare, out)=>{
        out.push(surface(view, key, (u, v)=>{
            const s = u * 2 - 1;
            const th = a0 + s * w * Math.pow(1 - v, 1.3);
            const rr = R + 0.004 * W + ridge * (1 - Math.abs(s)) * (1 - 0.5 * v) + flare * v * v;
            return on(th, rr, -bandH - h * v);
        }, 2, segs(view, h, 3, 5), (_u, v)=>on(a0, R * 0.5, -bandH - h * v), false));
    };
    for(let i = 0; i < 5; i++){
        const a0 = P0 + i / 5 * TAU;
        plate(`crown:point${i}`, a0, TAU / 5 * 0.34, pointH, 0.05 * W, 0.03 * W, points);
        pearls.push(on(a0, R + 0.004 * W + 0.03 * W + 0.02 * W, -bandH - pointH - 0.018 * W));
        const b0 = a0 + Math.PI / 5;
        plate(`crown:bud${i}`, b0, TAU / 5 * 0.12, pointH * 0.36, 0.02 * W, 0.01 * W, buds);
        budTops.push(on(b0, R + 0.004 * W + 0.012 * W, -bandH - pointH * 0.36 - 0.012 * W));
    }
    const bb = boundsOf([
        band
    ]);
    contact(ctx, bodyClip, bb.cx, bb.y1, bb.w * 0.5, 0.045 * W, 0.34);
    const mid = view.depth(axis(capBase));
    const g = gold(view);
    const facet = metal(view, [
        255,
        196,
        80
    ], [
        92,
        54,
        10
    ], [
        255,
        222,
        150
    ]);
    const goldBoth = (n)=>facet(n[2] < 0 ? [
            -n[0],
            -n[1],
            -n[2]
        ] : n);
    const pearlR = 0.024 * W, budR = 0.019 * W;
    for (const p of pearls)if (view.depth(p) < mid) sphereSprite(ctx, view, p, pearlR, 'pearl');
    for (const p of budTops)if (view.depth(p) < mid) sphereSprite(ctx, view, p, budR, 'gold');
    paintLayers(ctx, [
        {
            parts: [
                cap
            ],
            shade: velvet(view, [
                150,
                22,
                44
            ])
        },
        {
            parts: [
                band
            ],
            shade: g,
            bias: 0.01 * W
        },
        {
            parts: [
                rimTop
            ],
            shade: g,
            bias: 0.012 * W
        },
        {
            parts: [
                rimBot
            ],
            shade: g,
            bias: 0.012 * W
        },
        {
            parts: points,
            shade: goldBoth,
            cull: false,
            flat: true
        },
        {
            parts: buds,
            shade: goldBoth,
            cull: false,
            flat: true
        }
    ], view.px);
    const stones = [
        [
            208,
            20,
            60
        ],
        [
            30,
            150,
            92
        ],
        [
            36,
            90,
            220
        ],
        [
            36,
            90,
            220
        ],
        [
            30,
            150,
            92
        ]
    ];
    for(let i = 0; i < 5; i++){
        for (const [th, kind] of [
            [
                P0 + i / 5 * TAU,
                'stone'
            ],
            [
                P0 + i / 5 * TAU + Math.PI / 5,
                'stud'
            ]
        ]){
            const N = dirOf([
                Math.cos(th),
                0,
                ez * Math.sin(th)
            ]);
            if (view.dir(N)[2] < 0.12) continue;
            const c = on(th, R + 0.01 * W, -bandH * 0.5);
            if (kind === 'stud') {
                sphereSprite(ctx, view, c, 0.013 * W, 'gold');
                continue;
            }
            const size = (i === 0 ? 0.034 : 0.027) * W;
            sphereSprite(ctx, view, c, size * 1.3, 'gold');
            const T = dirOf([
                -Math.sin(th),
                0,
                ez * Math.cos(th)
            ]);
            cutGem(ctx, view, along(c, N, 0.006 * W), N, T, size, stones[i]);
        }
    }
    for (const p of pearls)if (view.depth(p) >= mid) sphereSprite(ctx, view, p, pearlR, 'pearl');
    for (const p of budTops)if (view.depth(p) >= mid) sphereSprite(ctx, view, p, budR, 'gold');
    const orbR = 0.034 * W;
    const orb = axis(capBase - capH - orbR * 0.75);
    const up = dirOf([
        0,
        -1,
        0
    ]);
    const bar = (key, a, b)=>tube(view, key, (u)=>[
                a[0] + (b[0] - a[0]) * u,
                a[1] + (b[1] - a[1]) * u,
                a[2] + (b[2] - a[2]) * u
            ], dirOf([
            0,
            0,
            1
        ]), section(0.009 * W, 0.009 * W, 0.5), 2, 6);
    const c0 = along(orb, up, orbR * 0.8), c1 = along(orb, up, orbR * 0.8 + 0.075 * W);
    const cm = along(orb, up, orbR * 0.8 + 0.05 * W), side = dirOf([
        1,
        0,
        0
    ]);
    sphereSprite(ctx, view, orb, orbR, 'gold');
    paintLayers(ctx, [
        {
            parts: [
                bar('crown:barV', c0, c1)
            ],
            shade: g
        },
        {
            parts: [
                bar('crown:barH', along(cm, side, -0.026 * W), along(cm, side, 0.026 * W))
            ],
            shade: g
        }
    ], view.px);
}
function phonesOf(view, m, base) {
    const W = m.right - m.left;
    const rc = 0.15 * W, oval = 1.1, pad = 0.05 * W, tc = 0.068 * W;
    const yc = m.mid - 0.07 * W;
    const tilt = 0.5;
    const shellRgb = rgbOf(base), padRgb = rgbOf(shade(base, -0.12)), plateRgb = rgbOf(shade(base, 0.08));
    const nu = segs(view, TAU * rc, 20, 40);
    const layers = [];
    const pivots = [];
    const tops = [];
    const seats = [];
    const g = silver(view);
    for (const s of [
        -1,
        1
    ]){
        const A = [
            s * Math.cos(tilt),
            0,
            Math.sin(tilt)
        ];
        const E1 = [
            0,
            1,
            0
        ];
        const E2 = [
            -Math.sin(tilt),
            0,
            s * Math.cos(tilt)
        ];
        const O = [
            (s < 0 ? m.left : m.right) - s * 0.02 * W,
            yc,
            0.01 * W
        ];
        const at = (t, rho, th)=>{
            const c = Math.cos(th) * oval * rho, sn = Math.sin(th) * rho;
            return [
                O[0] + A[0] * t + E1[0] * c + E2[0] * sn,
                O[1] + A[1] * t + E1[1] * c + E2[1] * sn,
                O[2] + A[2] * t + E1[2] * c + E2[2] * sn
            ];
        };
        const axis = (t)=>along(O, A, t);
        seats.push({
            c: O,
            ry: rc * oval
        });
        const rho0 = rc * 0.9 - pad * 0.5;
        const creases = nu >= 48 ? 1 : 0;
        const cushion = surface(view, `phones:cushion${s}`, (u, v)=>{
            const th = u * TAU, a = v * Math.PI;
            const crease = 1 + 0.006 * creases * Math.sin(th * 24) * Math.sin(a);
            return at(pad * 0.5 * (1 - Math.cos(a)), (rho0 + pad * 0.62 * Math.sin(a)) * crease, th);
        }, nu, 5, (_u, v)=>axis(pad * 0.5 * (1 - Math.cos(v * Math.PI))));
        const shell = surface(view, `phones:shell${s}`, (u, v)=>{
            const a = v * (Math.PI / 2);
            return at(pad + tc * Math.pow(Math.sin(a), 0.55), rc * (0.7 + 0.3 * Math.pow(Math.cos(a), 0.55)), u * TAU);
        }, nu, 5, axis(pad + tc * 0.5));
        const ringR = 0.66 * rc, ringT = 0.017 * W;
        const ring = surface(view, `phones:ring${s}`, (u, v)=>at(pad + tc + ringT * 0.45 * Math.sin(v * TAU), ringR + ringT * Math.cos(v * TAU), u * TAU), nu, 5, (u)=>at(pad + tc, ringR, u * TAU));
        const plateR = ringR - ringT * 0.5;
        const plate = surface(view, `phones:plate${s}`, (u, v)=>at(pad + tc + 0.013 * W * (1 - v * v), plateR * v, u * TAU), nu, 3, axis(pad + tc - 0.02 * W));
        const ty = pad + tc * 0.45, ry = rc * 1.04 + 0.022 * W;
        const yokeAt = (u)=>{
            const a = u * Math.PI;
            const c = -Math.sin(a) * oval * ry, sn = Math.cos(a) * ry;
            return [
                O[0] + A[0] * ty + E1[0] * c + E2[0] * sn,
                O[1] + A[1] * ty + E1[1] * c + E2[1] * sn,
                O[2] + A[2] * ty + E1[2] * c + E2[2] * sn
            ];
        };
        const yoke = tube(view, `phones:yoke${s}`, yokeAt, A, section(0.013 * W, 0.008 * W, 0.6), segs(view, Math.PI * ry, 12, 24), 6);
        pivots.push(yokeAt(0), yokeAt(1));
        tops.push(yokeAt(0.5));
        layers.push({
            parts: [
                cushion
            ],
            shade: plastic(view, padRgb, 0.35)
        }, {
            parts: [
                shell
            ],
            shade: plastic(view, shellRgb, 0.8)
        }, {
            parts: [
                ring
            ],
            shade: g,
            bias: 0.02 * W
        }, {
            parts: [
                plate
            ],
            shade: plastic(view, plateRgb, 1.3),
            bias: 0.01 * W
        }, {
            parts: [
                yoke
            ],
            shade: g
        });
    }
    const [PL, PR] = tops;
    const zb = (PL[2] + PR[2]) / 2, cx = (PL[0] + PR[0]) / 2, ax = (PR[0] - PL[0]) / 2, yEnd = (PL[1] + PR[1]) / 2;
    const padT = (u)=>0.005 * W + 0.022 * W * Math.pow(Math.sin(Math.PI * u), 0.35);
    const e = 2 / 2.2;
    const topAt = (x)=>{
        let y = Infinity;
        const h = m.hull;
        for(let i = 0; i < h.length; i++){
            const p = h[i], q = h[(i + 1) % h.length];
            if (p[0] === q[0] || x < Math.min(p[0], q[0]) || x > Math.max(p[0], q[0])) continue;
            y = Math.min(y, p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]));
        }
        return y;
    };
    let lift = yEnd - m.top;
    for(let i = 1; i < 64; i++){
        const t = Math.PI * (1 - i / 64);
        const s = Math.pow(Math.abs(Math.sin(t)), e);
        const yt = topAt(cx + ax * spow(Math.cos(t), e));
        if (s > 0.05 && Number.isFinite(yt)) lift = Math.max(lift, (yEnd - yt + 2 * padT(i / 64) + 0.006 * W) / s);
    }
    const arch = (u)=>{
        const t = Math.PI * (1 - u);
        return [
            cx + ax * spow(Math.cos(t), e),
            yEnd - lift * Math.pow(Math.abs(Math.sin(t)), e),
            zb
        ];
    };
    const part = (u0, u1)=>(u)=>arch(u0 + (u1 - u0) * u);
    const Z = [
        0,
        0,
        1
    ];
    const span = ax * 2 + lift * 2;
    const nb = segs(view, span, 24, 48);
    const us = 0.09;
    const shellOff = 0.016 * W;
    const shellPath = offsetPath(part(us, 1 - us), Z, ()=>shellOff);
    const taper = (u)=>smooth01(Math.min(u, 1 - u) / 0.07);
    const bandShell = tube(view, 'phones:bandShell', shellPath, Z, (u, ph)=>{
        const k = taper(u);
        return [
            (0.024 + 0.016 * k) * W * spow(Math.cos(ph), 0.4),
            (0.008 + 0.008 * k) * W * spow(Math.sin(ph), 0.4)
        ];
    }, nb, 6);
    const cushionPath = offsetPath(part(us + 0.02, 1 - us - 0.02), Z, (u)=>-padT(us + 0.02 + (1 - 2 * us - 0.04) * u));
    const bandPad = tube(view, 'phones:bandPad', cushionPath, Z, (u, ph)=>[
            0.034 * W * spow(Math.cos(ph), 0.5),
            padT(us + 0.02 + (1 - 2 * us - 0.04) * u) * spow(Math.sin(ph), 0.7)
        ], nb, 6);
    const sliders = [
        part(0, us + 0.03),
        part(1 - us - 0.03, 1)
    ].map((p, i)=>tube(view, `phones:slider${i}`, p, Z, section(0.022 * W, 0.006 * W, 0.4), 4, 6));
    layers.push({
        parts: [
            bandShell
        ],
        shade: plastic(view, shellRgb, 0.9)
    }, {
        parts: [
            bandPad
        ],
        shade: plastic(view, padRgb, 0.3)
    }, {
        parts: sliders,
        shade: g
    });
    const stitch = [];
    for(let i = 0; i <= 48; i++)stitch.push(along(cushionPath(0.04 + 0.92 * i / 48), Z, 0.034 * W + 0.001 * W));
    return {
        layers,
        pivots,
        pivotR: 0.017 * W,
        stitch,
        seats
    };
}
let lastPhones = null;
function drawPhones(ctx, view, m, base, pass, bodyClip) {
    const key = `${view.m.join()}|${view.px}|${view.L.join()}|${base}`;
    if (!lastPhones || lastPhones.m !== m || lastPhones.key !== key) lastPhones = {
        m,
        key,
        ph: phonesOf(view, m, base)
    };
    const ph = lastPhones.ph;
    const W = m.right - m.left;
    const near = (d)=>pass === 'front' ? d >= 0 : d < 0;
    if (pass === 'front') {
        for (const s of ph.seats){
            if (view.depth(s.c) < 0) continue;
            const c = view.toScreen(s.c);
            contact(ctx, bodyClip, c[0], c[1] + 0.01 * W, 0.06 * W, s.ry * 1.05, 0.26);
        }
    }
    paintLayers(ctx, ph.layers.map((l)=>({
            ...l,
            keep: near
        })), view.px);
    for (const p of ph.pivots)if (near(view.depth(p))) sphereSprite(ctx, view, p, ph.pivotR, 'silver');
    if (pass === 'front' && W * view.px > 120 && view.dir([
        0,
        0,
        1
    ])[2] > 0.3) {
        const pts = ph.stitch.map((p)=>view.toScreen(p));
        ctx.save();
        ctx.setLineDash([
            0.022 * W,
            0.014 * W
        ]);
        ctx.lineCap = 'round';
        ctx.lineWidth = 0.0045 * W;
        ctx.strokeStyle = shade(base, 0.12);
        ctx.globalAlpha = 0.55;
        ctx.stroke(polyPath(pts, false));
        ctx.restore();
    }
}
function drawBowTie(ctx, view, r, m, base, bodyZ, bodyClip, face, fabricBow = false) {
    if (r.facing < 0.05) return;
    const W = m.right - m.left;
    const clear = face.y + 22 * face.scale;
    const cyB = Math.max(clear, m.bottom - 0.15 * W);
    const room = Math.max(0, m.bottom - 3 - cyB);
    const k = Math.min(W, 100) * Math.max(0.5, Math.min(1, room / 15));
    const zFront = bodyZ(50, cyB);
    const Q = (x, y, z)=>[
            50 + x * k,
            cyB + y * k,
            zFront + z * k
        ];
    const rgb = rgbOf(base);
    const corners = [
        Q(-0.36, -0.18, 0),
        Q(0.36, 0.18, 0),
        Q(-0.36, 0.18, 0),
        Q(0.36, -0.18, 0)
    ].map((p)=>view.toScreen(p));
    const bb = bounds(corners);
    const sh = view.toScreen(Q(0.01, 0.08, 0));
    contact(ctx, bodyClip, sh[0], sh[1], bb.w * 0.52, bb.h * 0.5, 0.3);
    const nu = segs(view, 0.32 * k, 8, 16), nv = segs(view, 0.3 * k, 8, 16, 6);
    const at = `${zFront.toFixed(2)},${cyB.toFixed(2)},${k.toFixed(2)}`;
    const soft = !!fabricBow;
    const wingShade = soft ? felt(view, rgb) : satin(view, rgb);
    const layers = [];
    for (const dir of [
        -1,
        1
    ]){
        const wing = (u, v)=>{
            const x = 0.058 + 0.3 * u - 0.035 * Math.pow(u, 4) * Math.sin(Math.PI * v);
            const h = 0.05 + 0.12 * Math.pow(u, 0.8);
            const y = -h * Math.cos(Math.PI * v) + 0.012 * u * u;
            const bulge = 0.018 + 0.058 * Math.sin(Math.PI * (0.12 + 0.88 * u));
            const fold = 0.016 * Math.sin(3 * Math.PI * v) * Math.pow(1 - u, 1.3);
            return Q(dir * x, y, (bulge + fold) * Math.sin(Math.PI * v) + 0.004);
        };
        layers.push({
            parts: [
                surface(view, `bow:wing${dir}@${at}`, wing, nu, nv, (u)=>Q(dir * (0.058 + 0.3 * u), 0, -0.03))
            ],
            shade: wingShade
        });
        layers.push({
            parts: [
                surface(view, `bow:end${dir}@${at}`, (s, t)=>{
                    const p = wing(1, t);
                    return [
                        p[0],
                        p[1],
                        p[2] - (p[2] - zFront) * s
                    ];
                }, 1, nv, Q(dir * 0.2, 0, -0.03))
            ],
            shade: wingShade
        });
    }
    const knot = surface(view, `bow:knot@${at}`, (u, v)=>{
        const x = 0.068 * (2 * u - 1) * (1 - 0.12 * Math.sin(Math.PI * v));
        const y = 0.075 * (2 * v - 1);
        const zx = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), 3)), 0.5);
        const zy = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * v - 1), 5)), 0.4);
        return Q(x, y, 0.012 + 0.075 * zx * zy);
    }, 6, 6, Q(0, 0, -0.02));
    layers.push({
        parts: [
            knot
        ],
        shade: soft ? felt(view, rgb, 0.9) : satin(view, scale(rgb, 0.9))
    });
    if (!soft) {
        paintLayers(ctx, layers, view.px);
        return;
    }
    for(let i = 0; i < layers.length; i += 2){
        const part = layers.slice(i, i + 2);
        const outline = hull(paintLayers(ctx, part, view.px));
        grainOver(ctx, outline, 0.5, 0.1);
        fuzz(ctx, outline, base, 41 + i, 0.3, view.px);
    }
}
const FRAMES = {
    round: {
        rx: 10.8,
        ry: 10.8,
        n: 2,
        tr: 1.15,
        td: 1.2
    },
    square: {
        rx: 12,
        ry: 9.6,
        n: 4.2,
        tr: 1.45,
        td: 1.4
    },
    shades: {
        rx: 12.6,
        ry: 10,
        n: 3.4,
        tr: 1.6,
        td: 1.5
    }
};
export function drawGlasses(ctx, kind, eyes, light, pass, turn = {
    yaw: 0,
    pitch: 0
}) {
    if (kind === 'none') return;
    owner = FRAMES;
    const F = FRAMES[kind];
    const cy = Math.cos(turn.yaw), sy = Math.sin(turn.yaw), cp = Math.cos(turn.pitch), sp = Math.sin(turn.pitch);
    const { L: lightL, H: lightH } = lightOf(light.lx, light.ly);
    const view = makeView([
        cy,
        0,
        sy,
        sp * sy,
        cp,
        -sp * cy,
        -cp * sy,
        sp,
        cp * cy
    ], [
        0,
        0,
        0
    ], lightL, lightH, pxOf(ctx));
    const zPlane = Math.max(eyes[0].fz, eyes[1].fz) + 3.2;
    const zAt = (x)=>zPlane - 0.0045 * x * x;
    const e2 = 2 / F.n;
    const rimAt = (e, grow)=>(u)=>{
            const t = u * TAU;
            const x = e.ox + (F.rx + grow) * spow(Math.cos(t), e2), y = e.oy + (F.ry + grow) * spow(Math.sin(t), e2);
            return [
                x,
                y,
                zAt(x)
            ];
        };
    const ring = (e, grow, n = 48)=>{
        const f = rimAt(e, grow);
        const pts = [];
        for(let i = 0; i < n; i++)pts.push(view.toScreen(f(i / n)));
        return pts;
    };
    const vis = eyes.map((e)=>Math.max(0, Math.min(1, (e.z - 0.18) * 3.2)));
    if (pass === 'shadow') {
        for(let i = 0; i < 2; i++){
            if (vis[i] <= 0) continue;
            ctx.save();
            ctx.globalAlpha = 0.22 * vis[i];
            ctx.translate(-light.lx * 1.6, -light.ly * 1.6 + 0.8);
            ctx.lineWidth = F.tr * 2 + 0.6;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#000';
            ctx.stroke(polyPath(ring(eyes[i], 0)));
            ctx.restore();
        }
        return;
    }
    const frame = [
        22,
        22,
        26
    ];
    const rimShade = plastic(view, frame, 1.1);
    for(let i = 0; i < 2; i++){
        if (vis[i] <= 0) continue;
        const lens = polyPath(ring(eyes[i], -F.tr * 0.5));
        const b = bounds(ring(eyes[i], 0, 16));
        ctx.save();
        ctx.globalAlpha = vis[i];
        if (kind === 'shades') {
            const g = ctx.createLinearGradient(b.cx, b.y0, b.cx, b.y1);
            g.addColorStop(0, 'rgba(58,60,78,0.97)');
            g.addColorStop(0.55, 'rgba(18,18,26,0.98)');
            g.addColorStop(1, 'rgba(30,26,44,0.98)');
            ctx.fillStyle = g;
        } else {
            const g = ctx.createLinearGradient(b.cx, b.y0, b.cx, b.y1);
            g.addColorStop(0, 'rgba(236,244,255,0.26)');
            g.addColorStop(0.45, 'rgba(214,230,255,0.08)');
            g.addColorStop(1, 'rgba(214,230,255,0.14)');
            ctx.fillStyle = g;
        }
        ctx.fill(lens);
        ctx.clip(lens);
        const w = b.w, h = b.h;
        const streak = (x0, width, a)=>{
            ctx.globalAlpha = vis[i] * a;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(b.x0 + w * x0, b.y1 + h * 0.1);
            ctx.lineTo(b.x0 + w * (x0 + 0.55), b.y0 - h * 0.1);
            ctx.lineTo(b.x0 + w * (x0 + 0.55 + width), b.y0 - h * 0.1);
            ctx.lineTo(b.x0 + w * (x0 + width), b.y1 + h * 0.1);
            ctx.closePath();
            ctx.fill();
        };
        const k = kind === 'shades' ? 1.4 : 1;
        streak(-0.28, 0.26, 0.16 * k);
        streak(0.06, 0.07, 0.3 * k);
        ctx.restore();
    }
    const nr = segs(view, TAU * F.rx * 1.1, 28, 56, 8);
    const rim = (e)=>tube(view, `rim:${kind}:${e.ox},${e.oy},${e.fz.toFixed(2)}`, rimAt(e, 0), [
            0,
            0,
            1
        ], section(F.td, F.tr, 0.55), nr, 6, true);
    const [L, R] = eyes;
    const bridgeAt = (u)=>{
        const round = kind === 'round';
        const a = [
            L.ox + F.rx * (round ? 0.9 : 0.98),
            L.oy - F.ry * (round ? 0.32 : 0.42),
            0
        ];
        const b = [
            R.ox - F.rx * (round ? 0.9 : 0.98),
            R.oy - F.ry * (round ? 0.32 : 0.42),
            0
        ];
        const c = [
            0,
            (L.oy + R.oy) / 2 - F.ry * (round ? 0.8 : 0.6),
            0
        ];
        const m1 = 1 - u;
        const x = m1 * m1 * a[0] + 2 * m1 * u * c[0] + u * u * b[0], y = m1 * m1 * a[1] + 2 * m1 * u * c[1] + u * u * b[1];
        return [
            x,
            y,
            zAt(x) + 0.3
        ];
    };
    const bridge = tube(view, `bridge:${kind}:${L.ox},${L.oy},${R.ox},${zPlane.toFixed(2)}`, bridgeAt, [
        0,
        0,
        1
    ], section(F.td * 0.8, F.tr * 0.75, 0.7), 8, 6);
    const parts = [
        {
            part: rim(L),
            a: vis[0],
            d: view.depth([
                L.ox,
                L.oy,
                zPlane
            ])
        },
        {
            part: rim(R),
            a: vis[1],
            d: view.depth([
                R.ox,
                R.oy,
                zPlane
            ])
        },
        {
            part: bridge,
            a: Math.min(vis[0], vis[1]),
            d: view.depth([
                0,
                L.oy,
                zPlane
            ])
        }
    ].sort((p, q)=>p.d - q.d);
    for (const p of parts){
        if (p.a <= 0) continue;
        ctx.save();
        ctx.globalAlpha = p.a;
        paintLayers(ctx, [
            {
                parts: [
                    p.part
                ],
                shade: rimShade
            }
        ], view.px);
        ctx.restore();
    }
    for (const [e, s, a] of [
        [
            L,
            -1,
            vis[0]
        ],
        [
            R,
            1,
            vis[1]
        ]
    ]){
        if (a <= 0) continue;
        ctx.save();
        ctx.globalAlpha = a;
        const x = e.ox + s * F.rx * 0.93;
        sphereSprite(ctx, view, [
            x,
            e.oy - F.ry * 0.5,
            zAt(x) + F.td
        ], 0.75, 'silver');
        ctx.restore();
    }
}
export function drawWearBehind(ctx, path, r, wear) {
    if (!wear.headphones) return;
    const m = marksFor(path);
    if (!m) return;
    owner = m;
    drawPhones(ctx, viewOf(r, pxOf(ctx)), m, wear.color, 'behind', null);
}
export function drawWearFront(ctx, path, r, wear, bodyClip, bodyZ, face) {
    const m = marksFor(path);
    if (!m) return;
    owner = m;
    const view = viewOf(r, pxOf(ctx));
    if (wear.bowTie) drawBowTie(ctx, view, r, m, wear.color, bodyZ, bodyClip, face, wear.fabric);
    if (wear.headphones) drawPhones(ctx, view, m, wear.color, 'front', bodyClip);
    switch(wear.hat){
        case 'beret':
            drawBeret(ctx, view, m, wear.color, bodyClip);
            break;
        case 'beanie':
            drawBeanie(ctx, view, m, wear.color, bodyClip);
            break;
        case 'party':
            drawParty(ctx, view, m, wear.color, bodyClip);
            break;
        case 'crown':
            drawCrown(ctx, view, m, bodyClip);
            break;
    }
}
