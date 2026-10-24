export function makeView(m, o, L, H, px) {
    return {
        m,
        o,
        L,
        H,
        px,
        toScreen: (p)=>{
            const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
            return [
                m[0] * x + m[1] * y + m[2] * z,
                m[3] * x + m[4] * y + m[5] * z
            ];
        },
        depth: (p)=>m[6] * (p[0] - o[0]) + m[7] * (p[1] - o[1]) + m[8] * (p[2] - o[2]),
        dir: (v)=>norm([
                m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
                m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
                m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
            ])
    };
}
export const sub = (a, b)=>[
        a[0] - b[0],
        a[1] - b[1],
        a[2] - b[2]
    ];
export const cross = (a, b)=>[
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
export const dot = (a, b)=>a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (v)=>{
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [
        v[0] / l,
        v[1] / l,
        v[2] / l
    ];
};
const TAU = Math.PI * 2;
export function segs(view, len, lo, hi, quad = 11) {
    return Math.max(lo, Math.min(hi, Math.round(len * view.px / quad)));
}
export function makeMesh(surf, nu, nv, inside, smooth = true) {
    const W = nu + 1, N = W * (nv + 1);
    const pos = new Float64Array(N * 3);
    let ext = 0;
    for(let j = 0, k = 0; j <= nv; j++){
        for(let i = 0; i <= nu; i++, k++){
            const p = surf(i / nu, j / nv);
            pos[k * 3] = p[0];
            pos[k * 3 + 1] = p[1];
            pos[k * 3 + 2] = p[2];
            ext = Math.max(ext, Math.abs(p[0] - pos[0]) + Math.abs(p[1] - pos[1]) + Math.abs(p[2] - pos[2]));
        }
    }
    const P = (k)=>[
            pos[k * 3],
            pos[k * 3 + 1],
            pos[k * 3 + 2]
        ];
    const fn = new Float64Array(nu * nv * 3);
    for(let j = 0; j < nv; j++){
        for(let i = 0; i < nu; i++){
            const a = j * W + i;
            const A = P(a), B = P(a + 1), C = P(a + W + 1), D = P(a + W);
            let n = cross(sub(C, A), sub(D, B));
            const mid = [
                (A[0] + B[0] + C[0] + D[0]) / 4,
                (A[1] + B[1] + C[1] + D[1]) / 4,
                (A[2] + B[2] + C[2] + D[2]) / 4
            ];
            const ins = typeof inside === 'function' ? inside((i + 0.5) / nu, (j + 0.5) / nv) : inside;
            if (dot(n, sub(mid, ins)) < 0) n = [
                -n[0],
                -n[1],
                -n[2]
            ];
            n = norm(n);
            const f = (j * nu + i) * 3;
            fn[f] = n[0];
            fn[f + 1] = n[1];
            fn[f + 2] = n[2];
        }
    }
    const eps = 1e-6 + ext * 1e-5;
    const same = (p, q)=>Math.abs(pos[p * 3] - pos[q * 3]) + Math.abs(pos[p * 3 + 1] - pos[q * 3 + 1]) + Math.abs(pos[p * 3 + 2] - pos[q * 3 + 2]) < eps;
    let closed = true;
    for(let j = 0; j <= nv && closed; j++)closed = same(j * W, j * W + nu);
    let vn = null;
    if (smooth) {
        const acc = new Float64Array(N * 3);
        for(let j = 0; j < nv; j++){
            for(let i = 0; i < nu; i++){
                const f = (j * nu + i) * 3;
                const a = j * W + i;
                for (const k of [
                    a,
                    a + 1,
                    a + W + 1,
                    a + W
                ]){
                    acc[k * 3] += fn[f];
                    acc[k * 3 + 1] += fn[f + 1];
                    acc[k * 3 + 2] += fn[f + 2];
                }
            }
        }
        const join = (ks)=>{
            let x = 0, y = 0, z = 0;
            for (const k of ks){
                x += acc[k * 3];
                y += acc[k * 3 + 1];
                z += acc[k * 3 + 2];
            }
            for (const k of ks){
                acc[k * 3] = x;
                acc[k * 3 + 1] = y;
                acc[k * 3 + 2] = z;
            }
        };
        if (closed) for(let j = 0; j <= nv; j++)join([
            j * W,
            j * W + nu
        ]);
        for (const j of [
            0,
            nv
        ]){
            let pole = true;
            for(let i = 1; i <= nu && pole; i++)pole = same(j * W, j * W + i);
            if (pole) join(Array.from({
                length: W
            }, (_, i)=>j * W + i));
        }
        for(let k = 0; k < N; k++){
            const x = acc[k * 3], y = acc[k * 3 + 1], z = acc[k * 3 + 2];
            const l = Math.hypot(x, y, z) || 1;
            acc[k * 3] = x / l;
            acc[k * 3 + 1] = y / l;
            acc[k * 3 + 2] = z / l;
        }
        vn = acc;
    }
    return {
        nu,
        nv,
        closed,
        pos,
        fn,
        vn
    };
}
export function makeTube(path, up, prof, nu, nv, closed = false) {
    const e = 1e-3;
    const at = (u)=>path(closed ? (u % 1 + 1) % 1 : Math.max(0, Math.min(1, u)));
    return makeMesh((u, v)=>{
        const c = path(u);
        const T = norm(sub(at(u + e), at(u - e)));
        const k = dot(up, T);
        const Nn = norm([
            up[0] - T[0] * k,
            up[1] - T[1] * k,
            up[2] - T[2] * k
        ]);
        const Bn = cross(T, Nn);
        const [a, b] = prof(u, v * TAU);
        return [
            c[0] + Nn[0] * a + Bn[0] * b,
            c[1] + Nn[1] * a + Bn[1] * b,
            c[2] + Nn[2] * a + Bn[2] * b
        ];
    }, nu, nv, (u)=>path(u));
}
export const section = (a, b, p = 1)=>(_u, ph)=>{
        const c = Math.cos(ph), s = Math.sin(ph);
        return [
            a * Math.sign(c) * Math.pow(Math.abs(c), p),
            b * Math.sign(s) * Math.pow(Math.abs(s), p)
        ];
    };
export function projectMesh(view, mesh) {
    const { nu, nv, pos, fn, vn } = mesh;
    const W = nu + 1, N = W * (nv + 1), C = nu * nv;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = view.m;
    const [ox, oy, oz] = view.o;
    const x = new Float64Array(N), y = new Float64Array(N), d = new Float64Array(N);
    for(let k = 0; k < N; k++){
        const X = pos[k * 3] - ox, Y = pos[k * 3 + 1] - oy, Z = pos[k * 3 + 2] - oz;
        x[k] = m0 * X + m1 * Y + m2 * Z;
        y[k] = m3 * X + m4 * Y + m5 * Z;
        d[k] = m6 * X + m7 * Y + m8 * Z;
    }
    const turn = (src, dst, count)=>{
        for(let k = 0; k < count; k++){
            const a = src[k * 3], b = src[k * 3 + 1], c = src[k * 3 + 2];
            const X = m0 * a + m1 * b + m2 * c, Y = m3 * a + m4 * b + m5 * c, Z = m6 * a + m7 * b + m8 * c;
            const l = Math.hypot(X, Y, Z) || 1;
            dst[k * 3] = X / l;
            dst[k * 3 + 1] = Y / l;
            dst[k * 3 + 2] = Z / l;
        }
    };
    let n = null;
    if (vn) turn(vn, n = new Float64Array(N * 3), N);
    const f = new Float64Array(C * 3), cd = new Float64Array(C);
    turn(fn, f, C);
    for(let j = 0, c = 0; j < nv; j++){
        for(let i = 0; i < nu; i++, c++){
            const a = j * W + i;
            cd[c] = (d[a] + d[a + 1] + d[a + W] + d[a + W + 1]) / 4;
        }
    }
    return {
        nu,
        nv,
        closed: mesh.closed,
        x,
        y,
        d,
        n,
        f,
        cd
    };
}
export function boundsOf(ps) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of ps){
        for(let k = 0; k < p.x.length; k++){
            if (p.x[k] < x0) x0 = p.x[k];
            if (p.x[k] > x1) x1 = p.x[k];
            if (p.y[k] < y0) y0 = p.y[k];
            if (p.y[k] > y1) y1 = p.y[k];
        }
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
function monotone(mx, my, s, e) {
    const ax = mx[e] - mx[s], ay = my[e] - my[s];
    let prev = -Infinity;
    for(let k = s; k <= e; k++){
        const t = (mx[k] - mx[s]) * ax + (my[k] - my[s]) * ay;
        if (t < prev - 1e-9) return false;
        prev = t;
    }
    return true;
}
const clampByte = (v)=>v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
export const css = (c)=>`rgb(${clampByte(c[0])},${clampByte(c[1])},${clampByte(c[2])})`;
export function paintLayers(ctx, layers, px) {
    const pieces = [];
    const corners = [];
    for (const l of layers){
        const bias = l.bias ?? 0, keep = l.keep, cull = l.cull !== false;
        for (const P of l.parts){
            const { nu, nv, f, cd, x, y } = P, W = nu + 1;
            const vis = (c)=>(!cull || f[c * 3 + 2] > -0.04) && (!keep || keep(cd[c]));
            for(let j = 0; j < nv; j++){
                if (l.flat) {
                    for(let i = 0; i < nu; i++){
                        const c = j * nu + i;
                        if (!vis(c)) continue;
                        pieces.push({
                            d: cd[c] + bias,
                            l,
                            p: P,
                            j,
                            cols: [
                                i,
                                i + 1
                            ],
                            cells: [
                                c
                            ]
                        });
                        corners.push([
                            x[j * W + i],
                            y[j * W + i]
                        ], [
                            x[(j + 1) * W + i + 1],
                            y[(j + 1) * W + i + 1]
                        ]);
                    }
                    continue;
                }
                const runs = [];
                let cur = null;
                for(let i = 0; i < nu; i++){
                    if (vis(j * nu + i)) {
                        if (!cur) runs.push(cur = []);
                        cur.push(i);
                    } else cur = null;
                }
                if (P.closed && runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][runs[runs.length - 1].length - 1] === nu - 1) {
                    runs[0] = runs.pop().concat(runs[0]);
                }
                for (const run of runs){
                    const cols = run.concat(run[run.length - 1] + 1);
                    const mx = [], my = [];
                    for(let k = 0; k < cols.length; k++){
                        const t = j * W + cols[k], b = t + W;
                        mx.push((x[t] + x[b]) / 2);
                        my.push((y[t] + y[b]) / 2);
                        if (k === 0 || k === cols.length - 1) corners.push([
                            x[t],
                            y[t]
                        ], [
                            x[b],
                            y[b]
                        ]);
                        else if (j === 0) corners.push([
                            x[t],
                            y[t]
                        ]);
                        else if (j === nv - 1) corners.push([
                            x[b],
                            y[b]
                        ]);
                    }
                    let s = 0;
                    while(s < cols.length - 1){
                        let e = s + 1;
                        while(e + 1 < cols.length && monotone(mx, my, s, e + 1))e++;
                        let dd = 0;
                        for(let k = s; k < e; k++)dd += cd[j * nu + run[k]];
                        pieces.push({
                            d: dd / (e - s) + bias,
                            l,
                            p: P,
                            j,
                            cols: cols.slice(s, e + 1),
                            cells: run.slice(s, e)
                        });
                        s = e;
                    }
                }
            }
        }
    }
    pieces.sort((a, b)=>a.d - b.d);
    const grow = 0.5 / px;
    for (const pc of pieces){
        const { p: P, l, j, cols, cells } = pc;
        const { x, y, n, f } = P, W = P.nu + 1;
        const nc = cols.length;
        const tx = [], ty = [], bx = [], by = [];
        const t0 = j * W + cols[0], tn = j * W + cols[nc - 1];
        let ax = (x[tn] + x[tn + W]) / 2 - (x[t0] + x[t0 + W]) / 2, ay = (y[tn] + y[tn + W]) / 2 - (y[t0] + y[t0 + W]) / 2;
        const al = Math.hypot(ax, ay);
        const ux = al > 1e-9 ? ax / al : 0, uy = al > 1e-9 ? ay / al : 0;
        for(let k = 0; k < nc; k++){
            const t = j * W + cols[k], b = t + W;
            let dx = x[t] - x[b], dy = y[t] - y[b];
            const dl = Math.hypot(dx, dy);
            if (dl > 1e-9) dx /= dl, dy /= dl;
            else dx = dy = 0;
            const e = k === 0 ? -grow : k === nc - 1 ? grow : 0;
            tx.push(x[t] + dx * grow + ux * e);
            ty.push(y[t] + dy * grow + uy * e);
            bx.push(x[b] - dx * grow + ux * e);
            by.push(y[b] - dy * grow + uy * e);
        }
        const colour = (k)=>{
            if (n && !l.flat) {
                const t = (j * W + cols[k]) * 3, b = t + W * 3;
                return l.shade(norm([
                    n[t] + n[b],
                    n[t + 1] + n[b + 1],
                    n[t + 2] + n[b + 2]
                ]));
            }
            const c0 = cells[Math.max(0, Math.min(cells.length - 1, k - 1))] * 3, c1 = cells[Math.min(cells.length - 1, k)] * 3;
            return l.shade(l.flat ? [
                f[c1],
                f[c1 + 1],
                f[c1 + 2]
            ] : norm([
                f[c0] + f[c1],
                f[c0 + 1] + f[c1 + 1],
                f[c0 + 2] + f[c1 + 2]
            ]));
        };
        let style;
        if (l.flat || al < 1e-6) style = css(colour(0));
        else {
            const g = ctx.createLinearGradient((x[t0] + x[t0 + W]) / 2, (y[t0] + y[t0 + W]) / 2, (x[tn] + x[tn + W]) / 2, (y[tn] + y[tn + W]) / 2);
            let last = null;
            const m0x = (x[t0] + x[t0 + W]) / 2, m0y = (y[t0] + y[t0 + W]) / 2;
            for(let k = 0; k < nc; k++){
                const c = colour(k);
                if (last && k < nc - 1 && Math.abs(c[0] - last[0]) + Math.abs(c[1] - last[1]) + Math.abs(c[2] - last[2]) < 5) continue;
                const t = j * W + cols[k];
                const off = (((x[t] + x[t + W]) / 2 - m0x) * ax + ((y[t] + y[t + W]) / 2 - m0y) * ay) / (al * al);
                g.addColorStop(off < 0 ? 0 : off > 1 ? 1 : off, css(c));
                last = c;
            }
            style = g;
        }
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.moveTo(tx[0], ty[0]);
        for(let k = 1; k < nc; k++)ctx.lineTo(tx[k], ty[k]);
        for(let k = nc - 1; k >= 0; k--)ctx.lineTo(bx[k], by[k]);
        ctx.closePath();
        ctx.fill();
    }
    return corners;
}
export function hull(pts) {
    const p = pts.slice().sort((a, b)=>a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o, a, b)=>(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p){
        while(lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0)lo.pop();
        lo.push(q);
    }
    for(let i = p.length - 1; i >= 0; i--){
        const q = p[i];
        while(up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0)up.pop();
        up.push(q);
    }
    lo.pop();
    up.pop();
    return lo.concat(up);
}
const clamp01 = (x)=>x < 0 ? 0 : x > 1 ? 1 : x;
export const mix = (a, b, t)=>[
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t
    ];
export const scale = (a, k)=>[
        a[0] * k,
        a[1] * k,
        a[2] * k
    ];
const WHITE = [
    255,
    255,
    255
];
export function felt(view, base, k = 1) {
    const L = view.L;
    return (n)=>{
        const nl = dot(n, L);
        const dif = Math.pow(clamp01((nl + 0.4) / 1.4), 1.35);
        const graze = Math.pow(1 - clamp01(n[2]), 2);
        const lit = (0.22 + 0.95 * dif + 0.22 * graze * clamp01(nl + 0.6)) * k;
        const floor = 26 * dif * k;
        return [
            base[0] * lit + floor,
            base[1] * lit + floor,
            base[2] * lit + floor * 1.05
        ];
    };
}
export function velvet(view, base) {
    const L = view.L, sheen = mix(base, WHITE, 0.3);
    return (n)=>{
        const nl = dot(n, L);
        const dif = clamp01((nl + 0.3) / 1.3);
        const graze = Math.pow(1 - clamp01(n[2]), 1.6);
        return mix(scale(base, 0.2 + 0.7 * dif), sheen, 0.6 * graze * (0.4 + 0.6 * dif));
    };
}
export function paper(view, base) {
    const L = view.L, H = view.H;
    return (n)=>{
        const dif = clamp01((dot(n, L) + 0.2) / 1.2);
        const spec = Math.pow(clamp01(dot(n, H)), 22) * 0.3;
        return mix(scale(base, 0.36 + 0.7 * dif), WHITE, spec);
    };
}
export function plastic(view, base, gloss = 1) {
    const L = view.L, H = view.H;
    return (n)=>{
        const dif = clamp01((dot(n, L) + 0.25) / 1.25);
        const nh = clamp01(dot(n, H));
        const spec = (Math.pow(nh, 16) * 0.2 + Math.pow(nh, 80) * 0.6) * gloss;
        const rim = Math.pow(1 - clamp01(n[2]), 3) * 0.14 * gloss;
        return mix(scale(base, 0.28 + 0.78 * dif), WHITE, clamp01(spec + rim));
    };
}
export function satin(view, base) {
    const L = view.L, H = view.H, deep = scale(base, 0.42), sheen = mix(base, WHITE, 0.55);
    return (n)=>{
        const dif = clamp01((dot(n, L) + 0.35) / 1.35);
        const nh = clamp01(dot(n, H));
        const s = Math.pow(nh, 6) * 0.5 + Math.pow(nh, 40) * 0.35;
        return mix(mix(deep, base, dif), sheen, clamp01(s));
    };
}
export function metal(view, tint, dark, glint) {
    const H = view.H, L = view.L;
    return (n)=>{
        const rz = 2 * n[2] * n[2] - 1, ry = 2 * n[2] * n[1];
        const up = -ry;
        const sky = clamp01(0.45 + up * 0.85 + rz * 0.1);
        const horizon = Math.exp(-Math.pow((up + 0.12) / 0.16, 2)) * 0.55;
        const nl = clamp01(dot(n, L));
        const c = mix(dark, tint, clamp01(0.1 + sky * 0.72 + nl * 0.3));
        const spec = Math.pow(clamp01(dot(n, H)), 70) + horizon * 0.4;
        return mix(c, glint, clamp01(spec));
    };
}
export const gold = (view)=>metal(view, [
        255,
        200,
        88
    ], [
        86,
        50,
        8
    ], [
        255,
        247,
        220
    ]);
export const silver = (view)=>metal(view, [
        232,
        236,
        242
    ], [
        58,
        62,
        72
    ], [
        255,
        255,
        255
    ]);
export function pearl(view) {
    const L = view.L, H = view.H;
    return (n)=>{
        const dif = clamp01((dot(n, L) + 0.4) / 1.4);
        const base = mix([
            238,
            228,
            228
        ], [
            212,
            222,
            242
        ], 1 - clamp01(n[2]));
        return mix(scale(base, 0.62 + 0.42 * dif), WHITE, Math.pow(clamp01(dot(n, H)), 40) * 0.8);
    };
}
export function gem(view, base) {
    const L = view.L, H = view.H, deep = scale(base, 0.22), clear = mix(base, WHITE, 0.3);
    return (n)=>{
        const c = mix(deep, clear, clamp01(clamp01(n[2]) * 0.75 + dot(n, L) * 0.4));
        return mix(c, WHITE, Math.pow(clamp01(dot(n, H)), 24) * 0.95);
    };
}
const SPRITE = {
    gold: [
        [
            0,
            '#fffbe8'
        ],
        [
            0.08,
            '#ffe7a0'
        ],
        [
            0.3,
            '#eeb546'
        ],
        [
            0.62,
            '#ad7214'
        ],
        [
            0.87,
            '#5a3806'
        ],
        [
            1,
            '#8c5c18'
        ]
    ],
    silver: [
        [
            0,
            '#ffffff'
        ],
        [
            0.08,
            '#f3f5f9'
        ],
        [
            0.32,
            '#c6ccd6'
        ],
        [
            0.64,
            '#7a808c'
        ],
        [
            0.88,
            '#3d4149'
        ],
        [
            1,
            '#6b717c'
        ]
    ],
    pearl: [
        [
            0,
            '#ffffff'
        ],
        [
            0.1,
            '#fdf9f7'
        ],
        [
            0.45,
            '#ebe4e6'
        ],
        [
            0.8,
            '#c6bccb'
        ],
        [
            1,
            '#a89db5'
        ]
    ]
};
export function sphereSprite(ctx, view, c, rad, kind) {
    const s = view.toScreen(c);
    const H = view.H;
    const g = ctx.createRadialGradient(s[0] + H[0] * rad * 0.85, s[1] + H[1] * rad * 0.85, 0, s[0], s[1], rad);
    if (typeof kind === 'string') for (const [t, col] of SPRITE[kind])g.addColorStop(t, col);
    else {
        g.addColorStop(0, css(mix(kind, WHITE, 0.8)));
        g.addColorStop(0.1, css(mix(kind, WHITE, 0.3)));
        g.addColorStop(0.35, css(kind));
        g.addColorStop(0.85, css(scale(kind, 0.5)));
        g.addColorStop(1, css(scale(kind, 0.62)));
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s[0], s[1], rad, 0, TAU);
    ctx.fill();
}
export function cutGem(ctx, view, c, N, T, rad, col) {
    const B = cross(N, T);
    const at = (r, a, h)=>{
        const x = r * Math.cos(a), y = r * Math.sin(a);
        return [
            c[0] + x * T[0] + y * B[0] + h * N[0],
            c[1] + x * T[1] + y * B[1] + h * N[1],
            c[2] + x * T[2] + y * B[2] + h * N[2]
        ];
    };
    const K = 8, tr = 0.55, th = 0.36 * rad;
    const girdle = [], table = [];
    for(let k = 0; k < K; k++){
        const a = (k + 0.5) / K * TAU;
        girdle.push(at(rad, a, 0));
        table.push(at(rad * tr, a, th));
    }
    const shade = gem(view, col);
    const poly = (pts, n)=>{
        const nv = view.dir(n);
        if (nv[2] <= 0.02) return;
        ctx.fillStyle = css(shade(nv));
        ctx.beginPath();
        pts.forEach((p, i)=>{
            const s = view.toScreen(p);
            if (i) ctx.lineTo(s[0], s[1]);
            else ctx.moveTo(s[0], s[1]);
        });
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.stroke();
    };
    ctx.lineWidth = Math.min(0.3, 1 / view.px);
    ctx.lineJoin = 'round';
    for(let k = 0; k < K; k++){
        const g0 = girdle[k], g1 = girdle[(k + 1) % K], t1 = table[(k + 1) % K], t0 = table[k];
        let n = cross(sub(t1, g0), sub(t0, g1));
        if (dot(n, N) < 0) n = [
            -n[0],
            -n[1],
            -n[2]
        ];
        poly([
            g0,
            g1,
            t1,
            t0
        ], norm(n));
    }
    poly(table, N);
    const nv = view.dir(N);
    if (nv[2] > 0.1) {
        const s0 = view.toScreen(at(0, 0, th));
        const L = view.L;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        const s1 = view.toScreen(at(rad * tr * 0.8, Math.atan2(-L[1], -L[0]) + 2.2, th));
        const s2 = view.toScreen(at(rad * tr * 0.9, Math.atan2(-L[1], -L[0]) + Math.PI, th));
        const s3 = view.toScreen(at(rad * tr * 0.8, Math.atan2(-L[1], -L[0]) + Math.PI + 0.94, th));
        ctx.moveTo(s0[0], s0[1]);
        ctx.lineTo(s1[0], s1[1]);
        ctx.lineTo(s2[0], s2[1]);
        ctx.lineTo(s3[0], s3[1]);
        ctx.closePath();
        ctx.fill();
    }
}
