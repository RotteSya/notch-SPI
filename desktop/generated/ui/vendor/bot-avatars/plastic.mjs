import { parseColor } from './color.mjs';
export const PAD = 3;
export const SPAN = 100 + 2 * PAD;
const M = 64;
export const MATCAP_SIZE = M;
const MM = M * M;
const CONIC_STOPS = 24;
const INF = 1e12;
const EL = 48 * Math.PI / 180;
const E_XY = Math.cos(EL), E_Z = Math.sin(EL);
function edt1d(f, n, d, s, v, z) {
    let k = 0;
    v[0] = 0;
    z[0] = -1e30;
    z[1] = 1e30;
    for(let q = 1; q < n; q++){
        let x = 0;
        for(;;){
            const vk = v[k];
            x = (f[q] + q * q - f[vk] - vk * vk) / (2 * (q - vk));
            if (x > z[k]) break;
            k--;
        }
        k++;
        v[k] = q;
        z[k] = x;
        z[k + 1] = 1e30;
    }
    k = 0;
    for(let q = 0; q < n; q++){
        while(z[k + 1] < q)k++;
        const vk = v[k];
        d[q] = (q - vk) * (q - vk) + f[vk];
        s[q] = vk;
    }
}
function edt2d(mask, site, N, out, near) {
    const f = new Float32Array(N), d = new Float32Array(N), s = new Int32Array(N), v = new Int32Array(N), z = new Float32Array(N + 1);
    const g = new Float32Array(N * N), row = new Int32Array(N * N);
    for(let x = 0; x < N; x++){
        for(let y = 0; y < N; y++)f[y] = mask[y * N + x] === site ? 0 : INF;
        edt1d(f, N, d, s, v, z);
        for(let y = 0; y < N; y++){
            g[y * N + x] = d[y];
            row[y * N + x] = s[y];
        }
    }
    for(let y = 0; y < N; y++){
        const o = y * N;
        for(let x = 0; x < N; x++)f[x] = g[o + x];
        edt1d(f, N, d, s, v, z);
        for(let x = 0; x < N; x++){
            out[o + x] = d[x];
            if (near) near[o + x] = row[o + s[x]] * N + s[x];
        }
    }
}
function blur5(a, N, tmp) {
    for(let y = 0; y < N; y++){
        const o = y * N;
        for(let x = 0; x < N; x++){
            const x0 = x < 2 ? 0 : x - 2, x1 = x < 1 ? 0 : x - 1, x3 = x > N - 2 ? N - 1 : x + 1, x4 = x > N - 3 ? N - 1 : x + 2;
            tmp[o + x] = (a[o + x0] + 4 * a[o + x1] + 6 * a[o + x] + 4 * a[o + x3] + a[o + x4]) * 0.0625;
        }
    }
    for(let x = 0; x < N; x++){
        for(let y = 0; y < N; y++){
            const y0 = y < 2 ? 0 : y - 2, y1 = y < 1 ? 0 : y - 1, y3 = y > N - 2 ? N - 1 : y + 1, y4 = y > N - 3 ? N - 1 : y + 2;
            a[y * N + x] = (tmp[y0 * N + x] + 4 * tmp[y1 * N + x] + 6 * tmp[y * N + x] + 4 * tmp[y3 * N + x] + tmp[y4 * N + x]) * 0.0625;
        }
    }
}
function poisson(cov, N, u) {
    const levels = [];
    for(let n = N, f = 1; f <= 4 && n % 2 === 0 || f === 1; n >>= 1, f <<= 1){
        const mask = new Uint8Array(n * n);
        for(let y = 0; y < n; y++){
            for(let x = 0; x < n; x++){
                let sum = 0;
                for(let j = 0; j < f; j++)for(let i = 0; i < f; i++)sum += cov[(y * f + j) * N + x * f + i];
                mask[y * n + x] = sum >= 128 * f * f ? 1 : 0;
            }
        }
        levels.push({
            n,
            mask,
            phi: new Float32Array(n * n)
        });
        if (f === 4) break;
    }
    const sweep = (L, s, iters, om)=>{
        const { n, mask, phi } = L, s2 = s * s;
        for(let it = 0; it < iters; it++){
            for(let y = 1; y < n - 1; y++){
                const o = y * n;
                for(let x = 1; x < n - 1; x++){
                    const i = o + x;
                    if (!mask[i]) continue;
                    const v = (phi[i - 1] + phi[i + 1] + phi[i - n] + phi[i + n] + s2) * 0.25;
                    phi[i] += om * (v - phi[i]);
                }
            }
        }
    };
    for(let l = levels.length - 1; l >= 0; l--){
        const L = levels[l], f = 1 << l;
        if (l < levels.length - 1) {
            const C = levels[l + 1], n = L.n, cn = C.n;
            for(let y = 0; y < n; y++){
                const fy = Math.min(cn - 1, Math.max(0, (y + 0.5) / 2 - 0.5)), y0 = fy | 0, y1 = Math.min(cn - 1, y0 + 1), ty = fy - y0;
                for(let x = 0; x < n; x++){
                    const i = y * n + x;
                    if (!L.mask[i]) continue;
                    const fx = Math.min(cn - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), x0 = fx | 0, x1 = Math.min(cn - 1, x0 + 1), tx = fx - x0;
                    L.phi[i] = (C.phi[y0 * cn + x0] * (1 - tx) + C.phi[y0 * cn + x1] * tx) * (1 - ty) + (C.phi[y1 * cn + x0] * (1 - tx) + C.phi[y1 * cn + x1] * tx) * ty;
                }
            }
        }
        const om = Math.min(1.9, 2 / (1 + Math.sin(Math.PI / L.n)) - 0.05);
        sweep(L, u * f, 4, 1);
        sweep(L, u * f, l === 2 ? 100 : l === 1 ? 30 : 16, om);
        sweep(L, u * f, 8, 1);
    }
    return levels[0].phi;
}
const DX = [
    1,
    1,
    0,
    -1,
    -1,
    -1,
    0,
    1
], DY = [
    0,
    1,
    1,
    1,
    0,
    -1,
    -1,
    -1
];
const DL = [
    1,
    Math.SQRT2,
    1,
    Math.SQRT2,
    1,
    Math.SQRT2,
    1,
    Math.SQRT2
];
export function buildForm(cov, N, halfDepth) {
    const u = SPAN / N, NN = N * N;
    const mask = new Uint8Array(NN);
    for(let i = 0; i < NN; i++)mask[i] = cov[i] >= 128 ? 1 : 0;
    const dIn = new Float32Array(NN), dOut = new Float32Array(NN), nearIn = new Int32Array(NN);
    edt2d(mask, 0, N, dIn, null);
    edt2d(mask, 1, N, dOut, nearIn);
    const sd = new Float32Array(NN), tmp = new Float32Array(NN);
    for(let i = 0; i < NN; i++){
        const a = cov[i] / 255;
        sd[i] = u * (a > 0 && a < 1 ? a - 0.5 : mask[i] ? Math.sqrt(dIn[i]) - 0.5 : 0.5 - Math.sqrt(dOut[i]));
    }
    blur5(sd, N, tmp);
    blur5(sd, N, tmp);
    const phi = poisson(cov, N, u);
    let phiMax = 0;
    for(let i = 0; i < NN; i++)if (phi[i] > phiMax) phiMax = phi[i];
    const rIn = 2 * Math.sqrt(phiMax);
    const hMax = Math.min(1.5 * halfDepth + 0.32 * rIn, 1.4 * rIn);
    const kh = phiMax > 0 ? hMax / Math.sqrt(phiMax) : 0;
    const h = new Float32Array(NN);
    for(let i = 0; i < NN; i++)h[i] = phi[i] > 0 ? kh * Math.sqrt(phi[i]) : 0;
    blur5(h, N, tmp);
    const form = {
        N,
        i00: new Uint16Array(NN),
        wx: new Uint8Array(NN),
        wy: new Uint8Array(NN),
        ao: new Uint8Array(NN),
        sd,
        h
    };
    const { i00, wx, wy, ao } = form;
    const STEPS = N <= 64 ? [
        1,
        2,
        3,
        5,
        8
    ] : N <= 96 ? [
        1,
        2,
        4,
        7,
        11
    ] : [
        1,
        2,
        4,
        7,
        11,
        15
    ];
    const halo = 64;
    const last = N - 1;
    for(let y = 0; y < N; y++){
        for(let x = 0; x < N; x++){
            const i = y * N + x;
            const src = mask[i] ? i : dOut[i] <= halo ? nearIn[i] : -1;
            if (src < 0) continue;
            const sx = src % N, sy = (src - sx) / N;
            const xl = sx > 0 ? sx - 1 : 0, xr = sx < last ? sx + 1 : last, yu = sy > 0 ? sy - 1 : 0, yd = sy < last ? sy + 1 : last;
            let nx = -(h[sy * N + xr] - h[sy * N + xl]) / (2 * u);
            let ny = -(h[yd * N + sx] - h[yu * N + sx]) / (2 * u);
            let nz = 1;
            let len = Math.sqrt(nx * nx + ny * ny + 1);
            nx /= len;
            ny /= len;
            nz /= len;
            const dd = Math.max(0, sd[src]);
            if (dd < 2) {
                let gx = sd[sy * N + xr] - sd[sy * N + xl], gy = sd[yd * N + sx] - sd[yu * N + sx];
                const gl = Math.hypot(gx, gy) || 1;
                gx /= gl;
                gy /= gl;
                const w = 0.7 * (1 - dd / 2);
                nx += w * (-gx - nx);
                ny += w * (-gy - ny);
                nz += w * (0 - nz);
                len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                nx /= len;
                ny /= len;
                nz /= len;
            }
            const h0 = h[src];
            let occ = 0;
            for(let d = 0; d < 8; d++){
                let m = 0;
                for(let k = 0; k < STEPS.length; k++){
                    const r = STEPS[k];
                    let qx = sx + DX[d] * r, qy = sy + DY[d] * r;
                    if (qx < 0) qx = 0;
                    else if (qx > last) qx = last;
                    if (qy < 0) qy = 0;
                    else if (qy > last) qy = last;
                    const t = (h[qy * N + qx] - h0) / (r * u * DL[d]);
                    if (t > m) m = t;
                }
                occ += m / Math.sqrt(1 + m * m);
            }
            const e = 1 - Math.min(1, dd / 3);
            const edge = 1 - 0.2 * e * e;
            const aoLin = Math.pow(1 - 0.9 * occ / 8, 1.5) * edge;
            ao[i] = Math.max(1, Math.round(255 * Math.pow(aoLin, 1 / 2.2)));
            const fx = (nx * 0.5 + 0.5) * (M - 1), fy = (ny * 0.5 + 0.5) * (M - 1);
            const cx = Math.min(M - 2, Math.max(0, fx | 0)), cy = Math.min(M - 2, Math.max(0, fy | 0));
            i00[i] = cy * M + cx;
            wx[i] = Math.round(255 * Math.min(1, Math.max(0, fx - cx)));
            wy[i] = Math.round(255 * Math.min(1, Math.max(0, fy - cy)));
        }
    }
    return form;
}
function makeCanvas(n) {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(n, n);
    if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = c.height = n;
        return c;
    }
    return null;
}
function ctx2d(c, readBack) {
    return c.getContext('2d', readBack ? {
        willReadFrequently: true
    } : undefined);
}
export function rasterize(path, N) {
    const c = makeCanvas(N);
    const g = c && ctx2d(c, true);
    if (!g) return null;
    const u = SPAN / N;
    g.setTransform(1 / u, 0, 0, 1 / u, PAD / u, PAD / u);
    g.fillStyle = '#fff';
    g.fill(path);
    const px = g.getImageData(0, 0, N, N).data;
    const cov = new Uint8ClampedArray(N * N);
    for(let i = 0; i < N * N; i++)cov[i] = px[i * 4 + 3];
    return cov;
}
const forms = new Map();
const pending = new Set();
const pathIds = new WeakMap();
let nextPathId = 0;
function pathId(p) {
    let id = pathIds.get(p);
    if (!id) pathIds.set(p, id = `p${nextPathId++}`);
    return id;
}
const queue = [];
let scheduled = false;
const FORCED_MS = 6;
const clock = ()=>typeof performance !== 'undefined' ? performance.now() : Date.now();
const HURRY_MS = 20;
let hurrying = 0;
function pump(deadline) {
    scheduled = false;
    const t0 = clock();
    let fn = queue.shift();
    while(fn){
        fn();
        const room = hurrying > 0 ? HURRY_MS - (clock() - t0) : deadline && !deadline.didTimeout ? deadline.timeRemaining() - 6 : FORCED_MS - (clock() - t0);
        if (room <= 0) break;
        fn = queue.shift();
    }
    if (queue.length) schedule();
}
function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (hurrying > 0) {
        setTimeout(()=>pump(), 0);
        return;
    }
    const ric = globalThis.requestIdleCallback;
    if (ric) ric(pump, {
        timeout: 60
    });
    else setTimeout(()=>pump(), 24);
}
export function hurry(on) {
    hurrying = Math.max(0, hurrying + (on ? 1 : -1));
    if (on && queue.length) setTimeout(()=>pump(), 0);
}
export function bakesPending() {
    return pending.size > 0 || furPending.size > 0;
}
function idle(fn) {
    queue.push(fn);
    schedule();
}
const landed = new Set();
let missed = false;
let landing = false;
function land() {
    if (landing || !landed.size) return;
    landing = true;
    setTimeout(()=>{
        landing = false;
        for (const fn of [
            ...landed
        ])fn();
    }, 0);
}
export function onLanded(fn) {
    landed.add(fn);
    return ()=>{
        landed.delete(fn);
    };
}
export function takeMissed() {
    const m = missed;
    missed = false;
    return m;
}
function formFor(key, path, N, halfDepth, sync) {
    const id = `${key}|${N}|${Math.round(halfDepth)}`;
    const hit = forms.get(id);
    if (hit) return hit;
    const build = ()=>{
        pending.delete(id);
        if (forms.has(id)) return;
        const cov = rasterize(path, N);
        if (!cov) return;
        if (forms.size >= 48) forms.clear();
        forms.set(id, buildForm(cov, N, halfDepth));
        land();
    };
    if (sync) {
        build();
        return forms.get(id) ?? null;
    }
    if (!pending.has(id)) {
        pending.add(id);
        idle(build);
    }
    missed = true;
    return null;
}
export function warmPlastic(key, path, devicePx = 192, depth = 0.65, fabric = false, style = FUR_STOCK, light = 295, lights) {
    const form = formFor(key, path, tierFor(devicePx), 15 * depth, true);
    if (fabric && form) {
        const a = light * Math.PI / 180;
        furReady(form, key, 15 * depth, Math.ceil(SPAN * devicePx / 100), false, Math.sin(a), -Math.cos(a), style, lights ?? stockLights(Math.sin(a), -Math.cos(a)));
    }
}
export function tierFor(devicePx) {
    return devicePx <= 100 ? 64 : devicePx <= 224 ? 96 : 128;
}
const reliefs = new WeakMap();
export function reliefFor(form, K, round) {
    const q = Math.max(0.05, Math.min(1, round));
    const key = `${K}|${q.toFixed(2)}`;
    let byKey = reliefs.get(form);
    if (!byKey) reliefs.set(form, byKey = new Map());
    const hit = byKey.get(key);
    if (hit) return hit;
    const { N, h, sd } = form;
    let top = 0;
    for(let i = 0; i < N * N; i++)if (h[i] > top) top = h[i];
    const u = SPAN / N;
    const z = new Float32Array(K);
    const scale = new Float32Array(K), cx = new Float32Array(K), cy = new Float32Array(K), inset = new Float32Array(K);
    inset[0] = 1.2;
    const measure = (inside)=>{
        let n = 0, sx = 0, sy = 0;
        for(let j = 0, i = 0; j < N; j++)for(let x = 0; x < N; x++, i++)if (inside(i)) n += 1, sx += x, sy += j;
        return n ? [
            n,
            (sx / n + 0.5) * u - PAD,
            (sy / n + 0.5) * u - PAD
        ] : [
            0,
            50,
            50
        ];
    };
    const [a0, x0, y0] = measure((i)=>sd[i] >= 0);
    scale[0] = 1;
    cx[0] = x0;
    cy[0] = y0;
    for(let k = 1; k < K; k++){
        const s = k / K;
        z[k] = top * s;
        const tau = top * Math.pow(s, 1 / q);
        const [ak, xk, yk] = measure((i)=>sd[i] >= 0 && h[i] >= tau);
        scale[k] = Math.min(scale[k - 1], a0 ? Math.sqrt(ak / a0) : 1);
        cx[k] = xk;
        cy[k] = yk;
        const band = top / (2 * K);
        let n = 0, sum = 0;
        for(let i = 0; i < N * N; i++){
            if (sd[i] > 0 && Math.abs(h[i] - tau) < band) {
                sum += sd[i];
                n++;
            }
        }
        inset[k] = Math.max(inset[k - 1], n ? sum / n : inset[k - 1]);
    }
    const r = {
        top,
        z,
        q,
        scale,
        cx,
        cy,
        inset
    };
    if (byKey.size > 6) byKey.clear();
    byKey.set(key, r);
    return r;
}
export function surfaceAt(key, halfDepth, x, y, round = 1) {
    const prefix = `${key}|`, suffix = `|${Math.round(halfDepth)}`;
    let form = null;
    for (const [id, f] of forms)if (id.startsWith(prefix) && id.endsWith(suffix)) form = f;
    if (!form) return null;
    const { N, h } = form;
    const u = SPAN / N;
    const fx = Math.min(N - 1, Math.max(0, (x + PAD) / u - 0.5)), fy = Math.min(N - 1, Math.max(0, (y + PAD) / u - 0.5));
    const x0 = Math.min(N - 2, fx | 0), y0 = Math.min(N - 2, fy | 0), tx = fx - x0, ty = fy - y0, i = y0 * N + x0;
    const v = (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - ty) + (h[i + N] * (1 - tx) + h[i + N + 1] * tx) * ty;
    let top = 0;
    for(let k = 0; k < N * N; k++)if (h[k] > top) top = h[k];
    if (top <= 0) return 0;
    const q = Math.max(0.05, Math.min(1, round));
    return top * Math.pow(Math.max(0, v) / top, q);
}
const toLin = (v)=>v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const linCache = new Map();
function linearColor(color) {
    let c = linCache.get(color);
    if (!c) {
        let rgb = parseColor(color);
        if (!rgb) {
            const cv = makeCanvas(1);
            const g = cv && ctx2d(cv, true);
            if (g) {
                g.fillStyle = color;
                g.fillRect(0, 0, 1, 1);
                const p = g.getImageData(0, 0, 1, 1).data;
                rgb = [
                    p[0],
                    p[1],
                    p[2]
                ];
            } else rgb = [
                128,
                128,
                128
            ];
        }
        c = [
            toLin(rgb[0] / 255),
            toLin(rgb[1] / 255),
            toLin(rgb[2] / 255)
        ];
        if (linCache.size > 200) linCache.clear();
        linCache.set(color, c);
    }
    return c;
}
const TONE_N = 2048, TONE_MAX = 2.5, TONE_SCALE = TONE_N / TONE_MAX;
const toneLut = new Float32Array(TONE_N);
for(let i = 0; i < TONE_N; i++){
    const v = (i + 0.5) / TONE_SCALE;
    const y = v <= 0.75 ? v : 0.75 + 0.25 * (1 - Math.exp(-(v - 0.75) / 0.25));
    toneLut[i] = 255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
}
const tone = (v)=>toneLut[v <= 0 ? 0 : v >= TONE_MAX ? TONE_N - 1 : v * TONE_SCALE | 0];
const srgb = (v)=>v <= 0 ? 0 : v >= 1 ? 255 : 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const POW_N = 1024;
const powLuts = new Map();
function powLut(e) {
    let t = powLuts.get(e);
    if (!t) {
        t = new Float32Array(POW_N + 1);
        for(let i = 0; i <= POW_N; i++)t[i] = Math.pow(i / POW_N, e);
        if (powLuts.size > 16) powLuts.clear();
        powLuts.set(e, t);
    }
    return t;
}
function vivify(c, v, cap = Infinity) {
    if (!(v > 0)) return;
    const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const mn = Math.min(c[0], c[1], c[2]), mx = Math.max(c[0], c[1], c[2]);
    let k = 1 + 3 * v;
    if (mn < y) k = Math.min(k, y / (y - mn));
    if (mx > y) k = Math.min(k, Math.max(1, (cap - y) / (mx - y)));
    c[0] = y + (c[0] - y) * k;
    c[1] = y + (c[1] - y) * k;
    c[2] = y + (c[2] - y) * k;
}
const ENV = [
    0.92,
    0.96,
    1.0
];
const WARM = [
    1,
    0.98,
    0.95
];
const smooth = (a, b, v)=>{
    const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
    return t * t * (3 - 2 * t);
};
const soft = (w, s, x)=>1 - smooth(w - s, w + s, x);
export function buildMatcap(out, c, f, p) {
    const { L, V, H, U, W, A, B } = f;
    const vivid = p.vivid ?? 0, px = [
        0,
        0,
        0
    ];
    const mx = Math.max(c[0], c[1], c[2], 0.05);
    const tint = [
        c[0] / mx,
        c[1] / mx,
        c[2] / mx
    ];
    const amb = Math.max(0.03, 0.30 - 0.15 * p.shadow);
    const wrap = 0.15 + 0.14 * p.spread;
    const kd = 0.85;
    const e1 = Math.min(90, Math.round(110 / Math.pow(p.spread, 1.3))), e2 = Math.max(2, Math.round(8 / p.spread));
    const lut1 = powLut(e1), lut2 = powLut(e2);
    const ks1 = 0.45 * p.highlight, ks2 = 0.10 * p.highlight, winK = 0.11 * p.highlight, rimK = 0.30 * p.rim;
    const ambT = [
        amb * tint[0],
        amb * tint[1],
        amb * tint[2]
    ];
    for(let j = 0; j < M; j++){
        for(let i = 0; i < M; i++){
            let nx = i / (M - 1) * 2 - 1, ny = j / (M - 1) * 2 - 1;
            let r2 = nx * nx + ny * ny;
            if (r2 > 1.14) continue;
            if (r2 > 1) {
                const s = 1 / Math.sqrt(r2);
                nx *= s;
                ny *= s;
                r2 = 1;
            }
            const nz = Math.sqrt(1 - r2);
            const nl = nx * L[0] + ny * L[1] + nz * L[2];
            const nv = Math.max(0, nx * V[0] + ny * V[1] + nz * V[2]);
            const nh = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]);
            const dif = Math.min(1, Math.max(0, (nl + wrap) / (1 + wrap)));
            const q = 1 - nv, q2 = q * q, f3 = q2 * q, f5 = f3 * q2;
            const ni = nh * POW_N | 0;
            const spec = (ks1 * lut1[ni] + ks2 * lut2[ni]) * (1 + 3 * f5);
            const rx = 2 * nv * nx - V[0], ry = 2 * nv * ny - V[1], rz = 2 * nv * nz - V[2];
            const sky = 0.45 + 0.55 * smooth(-0.4, 0.6, rx * U[0] + ry * U[1] + rz * U[2]);
            const rw = rx * W[0] + ry * W[1] + rz * W[2];
            let win = 0;
            if (rw > 0.5) {
                const ra = (rx * A[0] + ry * A[1] + rz * A[2]) / rw, rb = (rx * B[0] + ry * B[1] + rz * B[2]) / rw;
                win = soft(0.34, 0.12, Math.abs(ra)) * soft(0.12, 0.06, Math.abs(rb));
            }
            const env = rimK * f3 * sky + winK * win;
            const k = (j * M + i) * 3;
            px[0] = c[0] * (ambT[0] + kd * dif);
            px[1] = c[1] * (ambT[1] + kd * dif);
            px[2] = c[2] * (ambT[2] + kd * dif);
            vivify(px, vivid);
            out[k] = tone(px[0] + spec * WARM[0] + env * ENV[0]);
            out[k + 1] = tone(px[1] + spec * WARM[1] + env * ENV[1]);
            out[k + 2] = tone(px[2] + spec * WARM[2] + env * ENV[2]);
        }
    }
}
function sampleMatcap(mc, nx, ny, out) {
    const fx = (nx * 0.5 + 0.5) * (M - 1), fy = (ny * 0.5 + 0.5) * (M - 1);
    const cx = Math.min(M - 2, Math.max(0, fx | 0)), cy = Math.min(M - 2, Math.max(0, fy | 0));
    const x = fx - cx, y = fy - cy, b = (cy * M + cx) * 3, R = M * 3;
    const w00 = (1 - x) * (1 - y), w10 = x * (1 - y), w01 = (1 - x) * y, w11 = x * y;
    for(let ch = 0; ch < 3; ch++)out[ch] = mc[b + ch] * w00 + mc[b + 3 + ch] * w10 + mc[b + R + ch] * w01 + mc[b + R + 3 + ch] * w11;
}
const lifts = new WeakMap();
export function edgeLift(form) {
    let l = lifts.get(form);
    if (l) return l;
    const { N, sd, ao } = form;
    l = {
        ao: new Uint8Array(N * N),
        k: new Float32Array(N * N)
    };
    for(let i = 0; i < N * N; i++){
        if (ao[i] === 0) continue;
        const dd = Math.max(0, sd[i]);
        const e = 1 - Math.min(1, dd / 3);
        const edge = 1 - 0.2 * e * e;
        const lin = Math.min(1, Math.pow(ao[i] / 255, 2.2) / edge);
        l.ao[i] = Math.max(1, Math.round(255 * Math.pow(lin, 1 / 2.2)));
        l.k[i] = 1;
    }
    lifts.set(form, l);
    return l;
}
const FRONT_FADE = 5;
export function shadeTexels(form, mc, px, aoMul, lift) {
    const { N, i00, wx, wy, ao, sd } = form;
    const R = M * 3;
    for(let i = 0, k = 0; i < N * N; i++, k += 4){
        const a = ao[i];
        if (a === 0) {
            px[k + 3] = 0;
            continue;
        }
        let m = lift ? aoMul[lift.ao[i]] * lift.k[i] : aoMul[a];
        const b = i00[i] * 3, x = wx[i] * (1 / 255), y = wy[i] * (1 / 255);
        if (lift) {
            const g = (mc[b + 1] * (1 - x) + mc[b + 4] * x) * (1 - y) + (mc[b + R + 1] * (1 - x) + mc[b + R + 4] * x) * y;
            m = 1 - (1 - m) * (1.1 - 0.75 * Math.min(1, g / 235));
        }
        const w00 = (1 - x) * (1 - y) * m, w10 = x * (1 - y) * m, w01 = (1 - x) * y * m, w11 = x * y * m;
        px[k] = mc[b] * w00 + mc[b + 3] * w10 + mc[b + R] * w01 + mc[b + R + 3] * w11;
        px[k + 1] = mc[b + 1] * w00 + mc[b + 4] * w10 + mc[b + R + 1] * w01 + mc[b + R + 4] * w11;
        px[k + 2] = mc[b + 2] * w00 + mc[b + 5] * w10 + mc[b + R + 2] * w01 + mc[b + R + 5] * w11;
        const t = sd[i] / FRONT_FADE;
        px[k + 3] = t >= 1 ? 255 : t <= 0 ? 0 : Math.round(255 * t * t * (3 - 2 * t));
    }
}
const softs = new WeakMap();
function softMask(form, R) {
    let byR = softs.get(form);
    if (!byR) softs.set(form, byR = new Map());
    if (byR.has(R)) return byR.get(R);
    const c = makeCanvas(R), g = c && ctx2d(c, false);
    if (!c || !g) {
        byR.set(R, null);
        return null;
    }
    const { N, sd } = form;
    const img = new ImageData(R, R), px = R / SPAN;
    for(let y = 0; y < R; y++){
        for(let x = 0; x < R; x++){
            const d = bilerp(sd, N, (x + 0.5) / px / SPAN * N - 0.5, (y + 0.5) / px / SPAN * N - 0.5);
            const t = (d + 0.2) / 0.6;
            const k = (y * R + x) * 4;
            img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
            img.data[k + 3] = t >= 1 ? 255 : t <= 0 ? 0 : Math.round(255 * t * t * (3 - 2 * t));
        }
    }
    g.putImageData(img, 0, 0);
    byR.set(R, c);
    return c;
}
const rims = new WeakMap();
function rimOf(form) {
    let r = rims.get(form);
    if (r) return r;
    const { N, sd } = form;
    const u = SPAN / N;
    const pts = [];
    for(let j = 0, i = 0; j < N; j++)for(let x = 0; x < N; x++, i++)if (sd[i] >= 0 && sd[i] < 2 * u) pts.push((x + 0.5) * u - PAD, (j + 0.5) * u - PAD, sd[i]);
    r = Float32Array.from(pts);
    rims.set(form, r);
    return r;
}
const rings = new WeakMap();
function ringOf(form) {
    let r = rings.get(form);
    if (r) return r;
    const rim = rimOf(form);
    const all = [];
    let mx = 0, my = 0;
    for(let i = 0; i < rim.length; i += 3)mx += rim[i], my += rim[i + 1];
    mx /= rim.length / 3 || 1;
    my /= rim.length / 3 || 1;
    for(let i = 0; i < rim.length; i += 3)all.push([
        rim[i],
        rim[i + 1],
        Math.atan2(rim[i + 1] - my, rim[i] - mx),
        rim[i + 2]
    ]);
    all.sort((p, q)=>p[2] - q[2]);
    const step = Math.max(1, Math.floor(all.length / 96));
    const pts = all.filter((_, i)=>i % step === 0);
    r = {
        x: Float32Array.from(pts, (p)=>p[0]),
        y: Float32Array.from(pts, (p)=>p[1]),
        d: Float32Array.from(pts, (p)=>p[3])
    };
    rings.set(form, r);
    return r;
}
function ringOrder(n, a, k) {
    const start = Math.round((a + Math.PI) / (2 * Math.PI) * n);
    const off = k & 1 ? k + 1 >> 1 : -(k >> 1);
    return ((start + off) % n + n) % n;
}
function reach(rim, ex, ey) {
    let m = -INF;
    for(let i = 0; i < rim.length; i += 3){
        const v = rim[i] * ex + rim[i + 1] * ey + rim[i + 2];
        if (v > m) m = v;
    }
    return m;
}
const furs = new Map();
const furPending = new Set();
const lightBin = (lx, ly)=>Math.round(Math.atan2(ly, lx) / (Math.PI / 12));
const furTier = (capPx)=>capPx <= 200 ? 192 : capPx <= 360 ? 320 : 512;
export const FUR_STOCK = {
    length: 1,
    density: 1.6,
    fuzz: 0.9,
    clumps: 0.4,
    curl: 0.7,
    gravity: 0.9
};
const styleId = (s)=>`${s.length.toFixed(2)},${s.density.toFixed(2)},${s.fuzz.toFixed(2)},${s.clumps.toFixed(2)},${s.curl.toFixed(2)},${(s.gravity ?? FUR_STOCK.gravity).toFixed(2)}`;
const furKey = (key, halfDepth, R, bin, style, lights)=>`${key}|${Math.round(halfDepth)}|${R}|${bin}|${styleId(style)}|${lightsId(lights)}`;
const queuedFor = new Map();
const dropped = new Set();
const FUR_MID = 128;
const LOCK_COVER = 3.2;
const LOCK_DENSE = 1 / 2.56;
const LOCK_TAPER = 1 / (2 / 3 * Math.sqrt(1 / 3));
const LOCK_PART = 0.6;
const PILE_AMB = 0.07;
const PILE_FILL = 0.14;
const PILE_WRAP = 0.3;
const PILE_SHADOW = 0.6;
const PILE_AO = 0.35;
const PILE_ROOT = 0.3;
const PILE_KK = 0.3;
const PILE_GAIN = 1.26;
const PILE_LIFT = 1.6;
const PILE_BIAS = 0.045;
const PILE_STAND = 0.5;
const PILE_COS = Math.cos(PILE_STAND), PILE_SIN = Math.sin(PILE_STAND);
const PILE_CREASE = 0.22;
const PILE_H = 0.5;
const GAP_REF = 0.36;
const PILE_LIT = 1.1;
const TIP_TOP = 1.625;
const STRAND_TAPER = 0.5;
const STRAND_RISE = 0.9;
const STRAND_SHORT = 0.7;
const STRAND_CAST_H = 0.15;
const STRAND_CAST = 1.3;
const FILM_M = 20;
const FILM_SPAN = SPAN + 2 * FILM_M;
const HALO_A = 0.8;
const HALO_STREAK = 0.3;
const HALO_HAIR = 0.8;
const HALO_LIFT = 0.7;
const HALO_SHADE = 0.5;
const HALO_FIT = 2.5;
const HALO_CORE = 1.2;
const HALO_INSET = 3;
const HALO_VEIL = 0.8;
const HALO_BLEND = 0.3;
const HALO_EASE = 0.1;
const KEY_EL = 32 * Math.PI / 180;
const BACK_SOFT = 1;
function fabricKey(U, V, front = KEY_EL) {
    const c = Math.cos(front), s = Math.sin(front);
    return norm3([
        U[0] * c + V[0] * s,
        U[1] * c + V[1] * s,
        U[2] * c + V[2] * s
    ]);
}
function fabricBack(K, V) {
    return norm3([
        0.94 * K[0] - 0.34 * V[0],
        0.94 * K[1] - 0.34 * V[1],
        0.94 * K[2] - 0.34 * V[2]
    ]);
}
export function backFromKey(lx, ly) {
    const x = -0.5 * lx, y = -0.5 * ly - 0.87;
    const l = Math.hypot(x, y) || 1;
    return [
        x / l,
        y / l
    ];
}
export const stockLights = (lx, ly)=>{
    const [bx, by] = backFromKey(lx, ly);
    return {
        bx,
        by,
        front: KEY_EL
    };
};
const lightsId = (s)=>`${Math.round(Math.atan2(s.by, s.bx) / (Math.PI / 36))}|${Math.round(s.front / (Math.PI / 90))}`;
function hash2(x, y) {
    let h = x * 374761393 + y * 668265263 | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
function bilerp(f, N, x, y) {
    const last = N - 1;
    const fx = Math.min(last, Math.max(0, x)), fy = Math.min(last, Math.max(0, y));
    const x0 = Math.min(last - 1, fx | 0), y0 = Math.min(last - 1, fy | 0);
    const tx = fx - x0, ty = fy - y0, i = y0 * N + x0;
    return (f[i] * (1 - tx) + f[i + 1] * tx) * (1 - ty) + (f[i + N] * (1 - tx) + f[i + N + 1] * tx) * ty;
}
function furReady(form, key, halfDepth, capPx, sync, lx, ly, style = FUR_STOCK, lights = stockLights(lx, ly)) {
    const R = furTier(capPx), bin = lightBin(lx, ly);
    const id = furKey(key, halfDepth, R, bin, style, lights);
    const hit = furs.get(id);
    if (hit) return hit;
    if (sync) return furFor(form, key, halfDepth, capPx, lx, ly, style, lights);
    const prefix = `${key}|${Math.round(halfDepth)}|`;
    if (R > 192 && !hurrying && !furPending.has(id)) {
        let any = false;
        for (const k of furs.keys())if (k.startsWith(prefix)) any = true;
        for (const k of furPending)if (k.startsWith(prefix)) any = true;
        if (!any) furReady(form, key, halfDepth, 1, false, lx, ly, style, lights);
    }
    if (!furPending.has(id)) {
        furPending.add(id);
        dropped.delete(id);
        const shape = `${key}|${Math.round(halfDepth)}|${R}|${bin}`;
        const line = queuedFor.get(shape) ?? [];
        line.push(id);
        while(line.length > 2){
            const old = line.shift();
            dropped.add(old);
            furPending.delete(old);
        }
        queuedFor.set(shape, line);
        const job = furJob(form, id, R, lx, ly, style, lights);
        if (job) for (const step of job.steps)idle(()=>dropped.has(id) ? undefined : step());
    }
    missed = true;
    for (const [k, f] of furs)if (k.startsWith(prefix)) return f;
    return null;
}
function rng(seed) {
    let a = seed >>> 0;
    return ()=>{
        a = a + 0x6d2b79f5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
function valueNoise(scale, seed) {
    return (x, y)=>{
        const fx = x / scale, fy = y / scale;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const h = (i, j)=>hash2(i + seed * 131, j - seed * 71);
        const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
        return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    };
}
function hash3(x, y, z) {
    let h = x * 374761393 + y * 668265263 + z * 1274126177 | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
function valueNoise3(scale, seed) {
    return (x, y, z)=>{
        const fx = x / scale, fy = y / scale, fz = z / scale;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
        const tx = fx - x0, ty = fy - y0, tz = fz - z0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
        const h = (i, j, k)=>hash3(i + seed * 131, j - seed * 71, k + seed * 17);
        const lerp = (a, b, t)=>a + (b - a) * t;
        const c00 = lerp(h(x0, y0, z0), h(x0 + 1, y0, z0), sx), c10 = lerp(h(x0, y0 + 1, z0), h(x0 + 1, y0 + 1, z0), sx);
        const c01 = lerp(h(x0, y0, z0 + 1), h(x0 + 1, y0, z0 + 1), sx), c11 = lerp(h(x0, y0 + 1, z0 + 1), h(x0 + 1, y0 + 1, z0 + 1), sx);
        return lerp(lerp(c00, c10, sy), lerp(c01, c11, sy), sz);
    };
}
export function furFor(form, key = 'custom', halfDepth = 9.75, capPx = 320, lx = -1, ly = 0, style = FUR_STOCK, lights = stockLights(lx, ly)) {
    const R = furTier(capPx);
    const id = furKey(key, halfDepth, R, lightBin(lx, ly), style, lights);
    const hit = furs.get(id);
    if (hit) return hit;
    const job = furJob(form, id, R, lx, ly, style, lights);
    if (job) for (const step of job.steps)step();
    return furs.get(id) ?? {
        R: 0,
        mask: null,
        haze: null,
        cut: null,
        core: null,
        dark: null,
        light: null,
        glint: null,
        back: null,
        backSoft: null
    };
}
function furJob(form, id, R, lx, ly, style = FUR_STOCK, lights = stockLights(lx, ly)) {
    if (furs.has(id)) return null;
    const file = (f)=>{
        if (furs.size >= 24) furs.delete(furs.keys().next().value);
        furs.set(id, f);
        furPending.delete(id);
        land();
    };
    const { N } = form;
    const px = R / SPAN;
    const at = (f, x, y)=>bilerp(f, N, (x + PAD) / SPAN * N - 0.5, (y + PAD) / SPAN * N - 0.5);
    const sdAt = (x, y)=>at(form.sd, x, y);
    const O = PAD + FILM_M, Rb = Math.round(R * FILM_SPAN / SPAN);
    const fur = {
        R,
        mask: null,
        haze: null,
        cut: null,
        core: null,
        dark: null,
        light: null,
        glint: null,
        back: null,
        backSoft: null
    };
    const dc = makeCanvas(Rb), lc = makeCanvas(Rb), mc = makeCanvas(R), gc = makeCanvas(Rb), bc = makeCanvas(Rb), sc2 = makeCanvas(Rb);
    const dg = dc && ctx2d(dc, false), lg = lc && ctx2d(lc, false), mg = mc && ctx2d(mc, false);
    const gg = gc && ctx2d(gc, false), bg = bc && ctx2d(bc, false), sg2 = sc2 && ctx2d(sc2, false);
    if (!dc || !lc || !mc || !gc || !bc || !sc2 || !dg || !lg || !mg || !gg || !bg || !sg2) {
        file(fur);
        return null;
    }
    const rand = rng(N * 7919 + 17);
    const lean = valueNoise(3.4, 21), tone = valueNoise(22, 9);
    const swirl = valueNoise(13, 57);
    const { length: kLen, density: kDen, fuzz, clumps, curl } = style;
    const gravity = style.gravity ?? FUR_STOCK.gravity;
    const ll = Math.hypot(lx, ly) || 1;
    const Lx = lx / ll, Ly = ly / ll;
    const Uf = [
        Lx,
        Ly,
        0
    ], Vf = [
        0,
        0,
        1
    ], Df = [
        0,
        1,
        0
    ];
    const K3 = fabricKey(Uf, Vf, lights.front), B3 = fabricBack([
        lights.bx,
        lights.by,
        0
    ], Vf), H3 = norm3([
        K3[0],
        K3[1],
        K3[2] + 1
    ]);
    const F3 = norm3([
        -0.55 * Uf[0] + 0.85 * Vf[0] + 0.15 * Df[0],
        -0.55 * Uf[1] + 0.85 * Vf[1] + 0.15 * Df[1],
        -0.55 * Uf[2] + 0.85 * Vf[2] + 0.15 * Df[2]
    ]);
    let crownY = 12;
    for(let y = -PAD; y < 60; y += 0.5)if (sdAt(50, y) > 0.5) {
        crownY = y + 1;
        break;
    }
    crownY -= 18;
    const crownX = 50;
    const outward = (x, y)=>{
        const e = 0.8;
        const ox = sdAt(x - e, y) - sdAt(x + e, y), oy = sdAt(x, y - e) - sdAt(x, y + e);
        const ol = Math.hypot(ox, oy) || 1;
        return [
            ox / ol,
            oy / ol
        ];
    };
    const flow = (x, y)=>{
        let rx = x - crownX, ry = y - crownY;
        const rl = Math.hypot(rx, ry) || 1;
        rx /= rl;
        ry /= rl;
        const fall = gravity * (1 - 0.6 * Math.exp(-rl / 8));
        let dx = rx * (1 - 0.8 * fall), dy = ry * (1 - 0.8 * fall) + fall;
        const d0 = sdAt(x, y);
        if (d0 < 5) {
            const [ox, oy] = outward(x, y);
            const up = Math.max(0, -oy);
            const ex = ox * (1 - gravity * up), ey = oy * (1 - gravity * up) + 1.2 * gravity;
            const w = Math.max(0, Math.min(1, 1 - d0 / 5)) * 0.75;
            dx = dx * (1 - w) + ex * w * 1.6;
            dy = dy * (1 - w) + ey * w * 1.6;
        }
        const a = (lean(x, y) - 0.5) * (0.5 + 1.6 * curl) + (swirl(x, y) - 0.5) * (0.6 + curl);
        const ca = Math.cos(a), sa = Math.sin(a);
        const qx = dx * ca - dy * sa, qy = dx * sa + dy * ca;
        const m = Math.hypot(qx, qy) || 1;
        return [
            qx / m,
            qy / m
        ];
    };
    const steps = [];
    const rows = (n, chunk, fn)=>{
        for(let y0 = 0; y0 < n; y0 += chunk)steps.push(()=>fn(y0, Math.min(n, y0 + chunk)));
    };
    const hAt = (x, y)=>at(form.h, x, y);
    const slopeAt = (x, y)=>{
        const e = 0.6;
        const gx = (hAt(x + e, y) - hAt(x - e, y)) / (2 * e), gy = (hAt(x, y + e) - hAt(x, y - e)) / (2 * e);
        const m = Math.hypot(gx, gy);
        return [
            m > 1e-6 ? -gx / m : 0,
            m > 1e-6 ? -gy / m : 0,
            m / Math.sqrt(1 + m * m)
        ];
    };
    const G = 112, gu = FILM_SPAN / G;
    const flowX = new Float32Array(G * G), flowY = new Float32Array(G * G), tiltG = new Float32Array(G * G);
    const nXg = new Float32Array(G * G), nYg = new Float32Array(G * G), nZg = new Float32Array(G * G);
    const onG = new Float32Array(G * G);
    const pfX = new Float32Array(G * G), pfY = new Float32Array(G * G), foreG = new Float32Array(G * G);
    const hG = new Float32Array(G * G), creaseG = new Float32Array(G * G);
    const toneG = new Float32Array(G * G);
    rows(G, 28, (j0, j1)=>{
        for(let j = j0, i = j0 * G; j < j1; j++){
            for(let x = 0; x < G; x++, i++){
                const X = (x + 0.5) * gu - O, Y = (j + 0.5) * gu - O;
                let [fx, fy] = flow(X, Y);
                const [dx, dy, tiltS] = slopeAt(X, Y);
                const w = tiltS * (0.25 + 0.5 * (1 - gravity)) * (1 - gravity * Math.max(0, -dy));
                fx = fx * (1 - w) + dx * w;
                fy = fy * (1 - w) + (dy + 0.35 * gravity) * w;
                const fl = Math.hypot(fx, fy) || 1;
                fx /= fl;
                fy /= fl;
                flowX[i] = fx;
                flowY[i] = fy;
                tiltG[i] = tiltS;
                let nx = dx * tiltS, ny = dy * tiltS, nz = Math.sqrt(Math.max(0, 1 - tiltS * tiltS));
                const d0 = sdAt(X, Y);
                if (d0 < 2) {
                    const [ox, oy] = outward(X, Y);
                    const w = d0 >= 0 ? 0.7 * (1 - d0 / 2) : Math.min(1, 0.7 - 0.2 * d0);
                    nx += w * (ox - nx);
                    ny += w * (oy - ny);
                    nz -= w * nz;
                    const nl = Math.hypot(nx, ny, nz) || 1;
                    nx /= nl;
                    ny /= nl;
                    nz /= nl;
                }
                nXg[i] = nx;
                nYg[i] = ny;
                nZg[i] = nz;
                onG[i] = smooth(-3.5, -1.5, d0);
                toneG[i] = tone(X, Y);
                hG[i] = d0 > 0 ? hAt(X, Y) : 0;
                const s = Math.sqrt(nx * nx + ny * ny), gx = s > 1e-4 ? nx / s : 0, gy = s > 1e-4 ? ny / s : 0;
                const a = fx * gx + fy * gy, k = (1 - Math.max(0, nz)) * a;
                let qx = PILE_COS * (fx - k * gx) + PILE_SIN * s * gx, qy = PILE_COS * (fy - k * gy) + PILE_SIN * s * gy;
                const att = smooth(-0.5, 1.5, d0);
                qx = fx + (qx - fx) * att;
                qy = fy + (qy - fy) * att;
                const ql = Math.sqrt(qx * qx + qy * qy) || 1;
                pfX[i] = qx / ql;
                pfY[i] = qy / ql;
                foreG[i] = 1 + (Math.min(1, ql) - 1) * att;
            }
        }
    });
    steps.push(()=>{
        const tmp = new Float32Array(G * G), avg = Float32Array.from(hG);
        for(let pass = 0; pass < 3; pass++){
            for(let y = 0, i = 0; y < G; y++)for(let x = 0; x < G; x++, i++){
                let acc = 0;
                for(let t = -2; t <= 2; t++)acc += avg[y * G + Math.min(G - 1, Math.max(0, x + t))];
                tmp[i] = acc / 5;
            }
            for(let y = 0, i = 0; y < G; y++)for(let x = 0; x < G; x++, i++){
                let acc = 0;
                for(let t = -2; t <= 2; t++)acc += tmp[Math.min(G - 1, Math.max(0, y + t)) * G + x];
                avg[i] = acc / 5;
            }
        }
        for(let j = 0, i = 0; j < G; j++)for(let x = 0; x < G; x++, i++){
            const inside = smooth(0.2, 2, sdAt((x + 0.5) * gu - O, (j + 0.5) * gu - O));
            const valley = smooth(0.3, 3.5, avg[i] - hG[i]) * inside;
            const under = smooth(0.15, 0.85, nYg[i]) * (1 - nZg[i]);
            creaseG[i] = Math.min(1, valley + 0.45 * under) * onG[i];
        }
    });
    const gridAt = (f, X, Y)=>bilerp(f, G, (X + O) / gu - 0.5, (Y + O) / gu - 0.5);
    const dirAt = (X, Y)=>{
        const ux = gridAt(pfX, X, Y), uy = gridAt(pfY, X, Y);
        const ul = Math.sqrt(ux * ux + uy * uy);
        return ul > 1e-4 ? [
            ux / ul,
            uy / ul
        ] : [
            0,
            1
        ];
    };
    const freeDirAt = (X, Y)=>{
        const ux = gridAt(flowX, X, Y), uy = gridAt(flowY, X, Y);
        const ul = Math.sqrt(ux * ux + uy * uy);
        return ul > 1e-4 ? [
            ux / ul,
            uy / ul
        ] : [
            0,
            1
        ];
    };
    const Rl = Rb >> 1, pl = Rl / FILM_SPAN;
    const lock = new Float32Array(Rl * Rl), lockLit = new Float32Array(Rl * Rl);
    const lockAt = (f, X, Y)=>bilerp(f, Rl, (X + O) * pl - 0.5, (Y + O) * pl - 0.5);
    const bump = valueNoise(0.7 + 0.35 * kLen, 61), swell = valueNoise(2.2 + 0.6 * kLen, 67);
    const tuftK = (0.2 + 0.5 * fuzz) * Math.min(1.8, kLen);
    const tuftAt = (X, Y)=>{
        const v = 0.3 * Math.max(-1.6, Math.min(1.6, lockAt(lock, X, Y))) / 1.6 + 0.25 * (bump(X, Y) - 0.5) * 2.4 + 0.45 * (swell(X, Y) - 0.5) * 2.4;
        return tuftK * Math.max(-1, Math.min(1, v));
    };
    const lockW = 0.8 + 0.45 * kLen;
    const lockWd = lockW * (0.65 + 0.4 * clumps), lockLd = 1.5 + 1.6 * kLen;
    const hMax = 0.32 * lockWd * (0.15 + 0.85 * clumps);
    const pileH = new Float32Array(Rb * Rb).fill(-0.25 * hMax), own = new Int32Array(Rb * Rb).fill(-1);
    const LP = 16;
    const cell = Math.sqrt(0.6 * lockWd * lockLd / LOCK_COVER / LOCK_DENSE);
    const gn = Math.ceil(FILM_SPAN / cell);
    const locks = new Float32Array(gn * gn * LP);
    let nLocks = 0;
    const stand0 = 0.45 - 0.2 * gravity;
    const tuftN = valueNoise3(1.6 * lockLd, 79), sizeN = valueNoise(9, 73);
    const tuftH = 1.5 * hMax * (0.25 + clumps);
    steps.push(()=>{
        for(let gy = 0; gy < gn; gy++)for(let gx = 0; gx < gn; gx++){
            const X = (gx + rand()) * cell - O, Y = (gy + rand()) * cell - O;
            const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand(), r5 = rand(), r6 = rand(), r7 = rand();
            let nx = gridAt(nXg, X, Y), ny = gridAt(nYg, X, Y), nz = gridAt(nZg, X, Y);
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl;
            ny /= nl;
            nz /= nl;
            const [fx, fy] = freeDirAt(X, Y);
            const ja = (r1 - 0.5) * (0.2 + 0.45 * curl), cj = Math.cos(ja), sj = Math.sin(ja);
            const ux = fx * cj - fy * sj, uy = fx * sj + fy * cj;
            const a = ux * nx + uy * ny;
            let tx = ux - a * nx, ty = uy - a * ny, tz = -a * nz;
            let tl = Math.hypot(tx, ty, tz);
            if (tl < 0.05) {
                tx = nz * nx;
                ty = nz * ny;
                tz = nz * nz - 1;
                tl = Math.hypot(tx, ty, tz) || 1;
            }
            tx /= tl;
            ty /= tl;
            tz /= tl;
            let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
            const st = stand0 + 0.2 * r2, cs = Math.cos(st), sn = Math.sin(st);
            const grow = 0.8 + 0.45 * sizeN(X, Y);
            const Wd = lockWd * grow * (0.8 + 0.4 * r3), Ld = lockLd * grow * (0.75 + 0.5 * r4);
            let ax = (tx * cs + nx * sn) * Ld * px, ay = (ty * cs + ny * sn) * Ld * px;
            let La = Math.hypot(ax, ay);
            if (La < 1.5) {
                ax = ux;
                ay = uy;
                La = 1.5;
            } else {
                ax /= La;
                ay /= La;
            }
            let across = -bx * ay + by * ax;
            if (across < 0) {
                bx = -bx;
                by = -by;
                bz = -bz;
                across = -across;
            }
            const Wa = Math.max(0.6, 0.5 * Wd * px * Math.max(0.15, across));
            const seen = La / (Ld * px) * (Wa / (0.5 * Wd * px));
            const tn = tuftN(X, Y, hAt(X, Y));
            if (r5 > LOCK_DENSE / Math.max(LOCK_DENSE, seen) * (1 - LOCK_PART * clumps * (1 - smooth(0.25, 0.65, tn)))) continue;
            const b = nLocks++ * LP;
            locks[b] = (X + O) * px;
            locks[b + 1] = (Y + O) * px;
            locks[b + 2] = ax;
            locks[b + 3] = ay;
            locks[b + 4] = La;
            locks[b + 5] = Wa;
            locks[b + 6] = 0.1 * hMax * r6 + tuftH * tn;
            locks[b + 7] = (r7 - 0.5) * 1.2 * curl;
            locks[b + 8] = tx;
            locks[b + 9] = ty;
            locks[b + 10] = tz;
            locks[b + 11] = bx;
            locks[b + 12] = by;
            locks[b + 13] = bz;
            locks[b + 14] = Ld;
            locks[b + 15] = Wd;
        }
    });
    const lockAlong = (s)=>(s < 0.25 ? 4 * s : 1) * (1 - 0.5 * s);
    const SPLAT_PARTS = 6;
    for(let part = 0; part < SPLAT_PARTS; part++)steps.push(()=>{
        const k0 = Math.floor(nLocks * part / SPLAT_PARTS), k1 = Math.floor(nLocks * (part + 1) / SPLAT_PARTS);
        for(let k = k0; k < k1; k++){
            const b = k * LP;
            const ox = locks[b], oy = locks[b + 1], ax = locks[b + 2], ay = locks[b + 3], La = locks[b + 4], Wa = locks[b + 5], z0 = locks[b + 6], bend = locks[b + 7];
            const ext = Wa * (1 + Math.abs(bend)) + 1, ex = ox + ax * La, ey = oy + ay * La;
            const xa = Math.max(0, Math.floor(Math.min(ox, ex) - ext)), xb = Math.min(Rb - 1, Math.ceil(Math.max(ox, ex) + ext));
            const ya = Math.max(0, Math.floor(Math.min(oy, ey) - ext)), yb = Math.min(Rb - 1, Math.ceil(Math.max(oy, ey) + ext));
            const iLa = 1 / La, iWa = 1 / Wa;
            for(let y = ya; y <= yb; y++){
                const dy = y + 0.5 - oy;
                for(let x = xa, i = y * Rb + xa; x <= xb; x++, i++){
                    const dx = x + 0.5 - ox;
                    const s = (dx * ax + dy * ay) * iLa;
                    if (s <= 0 || s >= 1) continue;
                    const w = LOCK_TAPER * Math.sqrt(s) * (1 - s);
                    const v = (dy * ax - dx * ay) * iWa - bend * s * s;
                    if (v >= w || v <= -w) continue;
                    const q = v / w;
                    const h = z0 + hMax * lockAlong(s) * (1 - q * q);
                    if (h > pileH[i]) {
                        pileH[i] = h;
                        own[i] = k;
                    }
                }
            }
        }
    });
    const pileB = new Float32Array(Rb * Rb);
    const rB = Math.max(1, Math.round(0.3 * lockWd * px));
    const line = new Float32Array(Rb);
    const box = (src, dst, r, k, stride)=>{
        const step = stride === 1 ? Rb : 1, inv = 1 / (2 * r + 1);
        const at = (t)=>line[t < 0 ? 0 : t >= Rb ? Rb - 1 : t];
        const o = k * step;
        for(let t = 0; t < Rb; t++)line[t] = src[o + t * stride];
        let acc = 0;
        for(let t = -r; t <= r; t++)acc += at(t);
        for(let t = 0; t < Rb; t++){
            dst[o + t * stride] = acc * inv;
            acc += at(t + r + 1) - at(t - r);
        }
    };
    steps.push(()=>{
        for(let y = 0; y < Rb; y++)box(pileH, pileB, rB, y, 1);
        for(let y = 0; y < Rb; y++)box(pileB, pileB, rB, y, 1);
    });
    steps.push(()=>{
        for(let x = 0; x < Rb; x++)box(pileB, pileB, rB, x, Rb);
        for(let x = 0; x < Rb; x++)box(pileB, pileB, rB, x, Rb);
    });
    steps.push(()=>{
        for(let y = 0; y < Rb; y++)box(pileH, pileH, 1, y, 1);
        for(let x = 0; x < Rb; x++)box(pileH, pileH, 1, x, Rb);
    });
    const darkImg = new ImageData(Rb, Rb), lightImg = new ImageData(Rb, Rb);
    const glintImg = new ImageData(Rb, Rb), backImg = new ImageData(Rb, Rb), softImg = new ImageData(Rb, Rb);
    const white = new Float32Array(Rb * Rb);
    const fib = new Float32Array(11);
    const fibreLight = (X, Y, ux, uy, stand)=>{
        const fx = Math.min(G - 1, Math.max(0, (X + O) / gu - 0.5)), fy = Math.min(G - 1, Math.max(0, (Y + O) / gu - 0.5));
        const x0 = Math.min(G - 2, fx | 0), y0 = Math.min(G - 2, fy | 0);
        const u = fx - x0, v = fy - y0, j = y0 * G + x0;
        const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
        const read = (f)=>f[j] * w00 + f[j + 1] * w10 + f[j + G] * w01 + f[j + G + 1] * w11;
        let nx = read(nXg), ny = read(nYg), nz = read(nZg);
        const nn = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nn;
        ny /= nn;
        nz /= nn;
        const nK = nx * K3[0] + ny * K3[1] + nz * K3[2];
        fib[4] = nx;
        fib[5] = ny;
        fib[6] = nz;
        fib[7] = nK;
        fib[8] = read(creaseG);
        const on = read(onG);
        fib[9] = on;
        fib[10] = read(toneG);
        if (on <= 0) {
            fib[0] = fib[1] = fib[3] = 0;
            fib[2] = 0.7;
            return;
        }
        const key = smooth(-0.2, 0.5, nK);
        const along = ux * nx + uy * ny;
        let tx = ux - along * nx, ty = uy - along * ny, tz = -along * nz;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-3) {
            tx /= tl;
            ty /= tl;
            tz /= tl;
        } else tx = 0, ty = 0, tz = 1;
        const cs = Math.cos(stand), sn = Math.sin(stand);
        tx = tx * cs + nx * sn;
        ty = ty * cs + ny * sn;
        tz = tz * cs + nz * sn;
        const tH = tx * H3[0] + ty * H3[1] + tz * H3[2], nH = nx * H3[0] + ny * H3[1] + nz * H3[2];
        const a1 = tH - 0.12 * nH, a2 = tH + 0.2 * nH;
        const b1 = Math.max(0, 1 - a1 * a1), b2 = b1 * b1, b4 = b2 * b2, b8 = b4 * b4, b16 = b8 * b8;
        const c1 = Math.max(0, 1 - a2 * a2), c2 = c1 * c1;
        fib[0] = key * (0.85 * b16 * b16 * b4 + 0.15 * c2 * c2);
        fib[0] *= (0.4 + 0.6 * (1 - smooth(0.35, 0.85, nK))) * on;
        const side = Math.sqrt(Math.max(0, 1 - tz * tz));
        fib[1] = smooth(-0.3, 0.6, nx * B3[0] + ny * B3[1] + nz * B3[2]) * Math.pow(1 - nz, 1.6) * (0.4 + 0.6 * side) * (1 - 0.6 * Math.max(0, ny)) * on;
        fib[3] = smooth(-0.5, 0.75, nx * B3[0] + ny * B3[1] + nz * B3[2]) * Math.pow(1 - nz, 0.85) * (1 - 0.6 * Math.max(0, ny)) * on;
        fib[2] = key * on + 0.7 * (1 - on);
    };
    steps.push(()=>{
        for(let y = 0, i = 0; y < Rb; y++)for(let x = 0; x < Rb; x++, i++){
            const h = hash2(x + 911, y + 37);
            white[i] = h * h * h;
        }
    });
    const W_MEAN = 0.25, W_SD = Math.sqrt(1 / 7 - 1 / 16);
    const strandHalf = Math.max(1, Math.round((0.35 + 0.4 * kLen) * px));
    const strandW = [], strandMean = new Float32Array(2 * strandHalf + 1), strandSd = new Float32Array(2 * strandHalf + 1);
    for(let L = 0; L <= 2 * strandHalf; L++){
        const w = new Float32Array(L + 1);
        let m1 = 0, v2 = 0;
        for(let t = 0; t <= L; t++){
            const tau = L ? t / L : 0, p = tau <= STRAND_SHORT ? 1 : (1 - tau) / (1 - STRAND_SHORT);
            w[t] = 1 - STRAND_TAPER * tau;
            m1 += w[t] * p * W_MEAN;
            v2 += w[t] * w[t] * (p / 7 - W_MEAN * W_MEAN * p * p);
        }
        strandW.push(w);
        strandMean[L] = m1;
        strandSd[L] = Math.sqrt(Math.max(1e-6, v2));
    }
    const strandK = 0.12 * (R >= 512 ? 1 : R >= 320 ? 0.75 : 0.4) * Math.min(1.4, 0.55 + 0.35 * kDen);
    const reach = Math.max(1, 1.5 * lockWd * px), NSH = Math.max(1, Math.min(5, Math.round(reach)));
    const shX = new Int32Array(NSH), shY = new Int32Array(NSH), shD = new Float32Array(NSH);
    for(let t = 0; t < NSH; t++){
        const d = (t + 1) / NSH * reach;
        shX[t] = Math.round(Lx * d);
        shY[t] = Math.round(Ly * d);
        shD[t] = Math.hypot(shX[t], shY[t]) / px;
    }
    const difLut = powLut(1.35), gamLut = powLut(1 / 2.2);
    const keyOn = (nk)=>{
        const q = (nk + PILE_WRAP) / (1 + PILE_WRAP);
        return q <= 0 ? 0 : q >= 1 ? 1 : difLut[q * POW_N | 0];
    };
    const depthK = R >= 512 ? 1 : R >= 320 ? 0.8 : 0.55;
    const seen = new Float32Array(4);
    const lockSeen = (x, y, X, Y, k)=>{
        if (k < 0) {
            const [ux, uy] = dirAt(X, Y);
            seen[0] = ux;
            seen[1] = uy;
            seen[2] = 0.5;
            seen[3] = 0;
            return;
        }
        const b = k * LP;
        const ax = locks[b + 2], ay = locks[b + 3], La = locks[b + 4], Wa = locks[b + 5], bend = locks[b + 7];
        const dx = x + 0.5 - locks[b], dy = y + 0.5 - locks[b + 1];
        const s = Math.min(0.995, Math.max(0.005, (dx * ax + dy * ay) / La));
        const ss = Math.sqrt(s), w = LOCK_TAPER * ss * (1 - s), dw = LOCK_TAPER * (0.5 * (1 - s) / ss - ss);
        const q = Math.max(-1, Math.min(1, ((dy * ax - dx * ay) / Wa - bend * s * s) / w));
        const sl = Math.max(-1.2, Math.min(1.2, q * dw + 2 * bend * s));
        const ux = La * ax - sl * Wa * ay, uy = La * ay + sl * Wa * ax;
        const ul = Math.sqrt(ux * ux + uy * uy) || 1;
        seen[0] = ux / ul;
        seen[1] = uy / ul;
        seen[2] = s;
        seen[3] = lockAlong(s) * (1 - q * q);
    };
    const strandBuf = new Float32Array(Rb * Rb);
    rows(Rb, 32, (y0, y1)=>{
        for(let y = y0; y < y1; y++){
            const Y = (y + 0.5) / px - O;
            for(let x = 0, i = y * Rb; x < Rb; x++, i++){
                const X = (x + 0.5) / px - O;
                lockSeen(x, y, X, Y, own[i]);
                const ux = seen[0], uy = seen[1];
                const gx = Math.min(G - 1, Math.max(0, (X + O) / gu - 0.5)), gy = Math.min(G - 1, Math.max(0, (Y + O) / gu - 0.5));
                const gx0 = Math.min(G - 2, gx | 0), gy0 = Math.min(G - 2, gy | 0), gtx = gx - gx0, gty = gy - gy0, gj = gy0 * G + gx0;
                const tilt = (tiltG[gj] * (1 - gtx) + tiltG[gj + 1] * gtx) * (1 - gty) + (tiltG[gj + G] * (1 - gtx) + tiltG[gj + G + 1] * gtx) * gty;
                const fore = (foreG[gj] * (1 - gtx) + foreG[gj + 1] * gtx) * (1 - gty) + (foreG[gj + G] * (1 - gtx) + foreG[gj + G + 1] * gtx) * gty;
                const L = 2 * Math.max(1, Math.min(strandHalf, Math.round(strandHalf * (0.5 + 0.5 * tilt) * fore / PILE_COS)));
                const sw = strandW[L];
                let acc = 0, accR = 0;
                for(let t = 0; t <= L; t++){
                    const sx = Math.round(x - ux * t), sy = Math.round(y - uy * t);
                    if (sx < 0 || sy < 0 || sx >= Rb || sy >= Rb) {
                        acc += strandMean[L] / (L + 1);
                        continue;
                    }
                    const m = white[sy * Rb + sx], f = m * 53.7, Ls = L * (STRAND_SHORT + (1 - STRAND_SHORT) * (f - Math.floor(f)));
                    if (t <= Ls) {
                        acc += m * sw[t];
                        accR += m * sw[t] * t / (Ls || 1);
                    }
                }
                const strand = (acc - strandMean[L]) / strandSd[L];
                const along = acc > 1e-4 ? accR / acc : 0.5;
                strandBuf[i] = strand + STRAND_RISE * Math.min(2.5, Math.max(0, strand)) * (along - 0.45);
            }
        }
    });
    let lsum = 0, lsum2 = 0;
    rows(Rb, 16, (y0, y1)=>{
        const dd = darkImg.data, ld = lightImg.data, gd = glintImg.data, bd = backImg.data, sd2 = softImg.data;
        for(let y = y0; y < y1; y++){
            const Y = (y + 0.5) / px - O;
            for(let x = 0; x < Rb; x++){
                const X = (x + 0.5) / px - O;
                const i = y * Rb + x, k = own[i], b = k * LP;
                lockSeen(x, y, X, Y, k);
                const ux = seen[0], uy = seen[1], s = seen[2], hgt = seen[3];
                fibreLight(X, Y, ux, uy, 0.25 + 0.2 * hgt);
                const nx = fib[4], ny = fib[5], nz = fib[6], nKb = fib[7];
                const xl0 = x > 0 ? i - 1 : i, xr0 = x < Rb - 1 ? i + 1 : i, yu0 = y > 0 ? i - Rb : i, yd0 = y < Rb - 1 ? i + Rb : i;
                const gx = (pileH[xr0] - pileH[xl0]) * px / (xr0 - xl0 || 1), gy = (pileH[yd0] - pileH[yu0]) * px * Rb / (yd0 - yu0 || 1);
                const l1 = Math.sqrt(nx * nx + ny * ny);
                let t1x = 1, t1y = 0, t2x = 0, t2y = 1, t2z = 0;
                if (l1 > 1e-3) {
                    t1x = -ny / l1;
                    t1y = nx / l1;
                    t2x = -nz * nx / l1;
                    t2y = -nz * ny / l1;
                    t2z = l1;
                }
                const g1 = Math.max(-1.5, Math.min(1.5, gx * t1x + gy * t1y)), g2 = Math.max(-1.5, Math.min(1.5, gx * t2x + gy * t2y));
                let mx = nx - g1 * t1x - g2 * t2x, my = ny - g1 * t1y - g2 * t2y, mz = nz - g2 * t2z;
                const ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
                mx /= ml;
                my /= ml;
                mz /= ml;
                let kk = 1;
                if (k >= 0) {
                    const tx = locks[b + 8], ty = locks[b + 9], tz = locks[b + 10];
                    const fx = 0.9 * tx + 0.44 * nx, fy = 0.9 * ty + 0.44 * ny, fz = 0.9 * tz + 0.44 * nz;
                    const fK = (fx * K3[0] + fy * K3[1] + fz * K3[2]) / (Math.sqrt(fx * fx + fy * fy + fz * fz) || 1);
                    kk = 1 - PILE_KK + PILE_KK * Math.min(1.2, Math.sqrt(Math.max(0, 1 - fK * fK)) / 0.85);
                }
                const nKp = mx * K3[0] + my * K3[1] + mz * K3[2];
                const h0 = pileH[i];
                let sh = 1;
                if (nKb > -0.25) {
                    const sinE = Math.min(0.97, Math.max(0.05, nKb)), tanE = sinE / Math.sqrt(1 - sinE * sinE);
                    let occ = 0;
                    for(let t = 0; t < NSH; t++){
                        const sx = x + shX[t], sy = y + shY[t];
                        if (sx < 0 || sy < 0 || sx >= Rb || sy >= Rb) break;
                        const o = pileH[sy * Rb + sx] - h0 - shD[t] * tanE;
                        if (o > occ) occ = o;
                    }
                    sh = 1 - PILE_SHADOW * smooth(0, 0.35 * hMax, occ);
                }
                let ao = 1 - PILE_AO * smooth(0, 0.6 * hMax, pileB[i] - h0);
                if (k >= 0) ao *= 1 - PILE_ROOT * (1 - smooth(0, 0.35, s));
                const fillP = PILE_AMB + PILE_FILL * Math.max(0, mx * F3[0] + my * F3[1] + mz * F3[2]);
                const fillB = PILE_AMB + PILE_FILL * Math.max(0, nx * F3[0] + ny * F3[1] + nz * F3[2]);
                let r = ao * (fillP + keyOn(nKp) * sh * kk) * PILE_GAIN / (fillB + keyOn(nKb));
                if (k >= 0) r *= (1 + 0.15 * s * s) * (1 + 0.08 * (hash2(k, 5) - 0.5));
                const crease = fib[8];
                r *= 1 - PILE_CREASE * crease * (0.6 + 0.4 * smooth(0, 0.6 * hMax, pileB[i] - h0));
                r = 1 + (r - 1) * depthK;
                const on = fib[9], lq = (fillB + keyOn(nKb)) / PILE_LIT;
                const lbs = (lq >= 1 ? 1 : gamLut[lq * POW_N | 0]) * on + 0.75 * (1 - on);
                let m0 = Math.sqrt(r > 2.4 ? 2.4 : r);
                if (m0 > 1) m0 = 1 + (m0 - 1) / (1 + 2.5 * lbs * (m0 - 1));
                const strand = strandBuf[i];
                let cast = 0;
                if (nKb > 0) {
                    const kx = K3[0] - nKb * nx, ky = K3[1] - nKb * ny, kt = Math.sqrt(1 - nKb * nKb);
                    const reachS = kt > 1e-3 ? STRAND_CAST_H * px * Math.min(3, kt / Math.max(0.2, nKb)) / kt : 0;
                    const cx = Math.min(Rb - 1.001, Math.max(0, x + kx * reachS)), cy = Math.min(Rb - 1.001, Math.max(0, y + ky * reachS));
                    const cx0 = cx | 0, cy0 = cy | 0, tx = cx - cx0, ty = cy - cy0, ci = cy0 * Rb + cx0;
                    const caster = (strandBuf[ci] * (1 - tx) + strandBuf[ci + 1] * tx) * (1 - ty) + (strandBuf[ci + Rb] * (1 - tx) + strandBuf[ci + Rb + 1] * tx) * ty;
                    cast = Math.max(0, caster - Math.max(0, strand)) * smooth(0, 0.3, nKb);
                }
                let m = m0 * (1 + strandK * (strand * (0.45 + 0.55 * fib[2]) * (0.75 + 0.5 * s) - STRAND_CAST * cast)) + 0.04 * (fib[10] - 0.5) + PILE_BIAS * depthK * on;
                const edgeD = Math.min(X + O, FILM_SPAN - O - X, Y + O, FILM_SPAN - O - Y);
                const fadeE = edgeD >= 8 ? 1 : edgeD <= 0 ? 0 : edgeD / 8 * (edgeD / 8) * (3 - 2 * edgeD / 8);
                m = 1 + (m - 1) * fadeE;
                const k4 = i * 4;
                if (m < 1) dd[k4 + 3] = Math.round(255 * Math.min(1, (1 - m) * lbs / Math.max(0.4, lbs - GAP_REF)));
                else {
                    ld[k4] = ld[k4 + 1] = ld[k4 + 2] = 255;
                    ld[k4 + 3] = Math.round(255 * Math.min(1, PILE_LIFT * (TIP_TOP - 1) * lbs / (TIP_TOP - lbs) * (m - 1) * (1 - 0.7 * crease)));
                }
                const lit = Math.max(-2, Math.min(2, 4 * (m0 - 1)));
                const xl = x >> 1, yl = y >> 1;
                if (xl < Rl && yl < Rl) {
                    const j = yl * Rl + xl;
                    lock[j] += 0.25 * h0;
                    lockLit[j] += 0.25 * lit;
                }
                const tipK = smooth(-0.4, 1, lit) * Math.max(0, Math.min(1.4, 0.65 + 0.25 * strand));
                gd[k4] = gd[k4 + 1] = gd[k4 + 2] = bd[k4] = bd[k4 + 1] = bd[k4 + 2] = 255;
                gd[k4 + 3] = Math.round(255 * Math.min(1, fib[0] * tipK));
                bd[k4 + 3] = Math.round(255 * Math.min(1, fib[1] * Math.max(0, Math.min(1.6, 0.5 + 0.4 * strand))));
                const onPile = Math.max(0.55, Math.min(1.3, 0.85 + 0.15 * strand + 0.12 * lit));
                sd2[k4] = sd2[k4 + 1] = sd2[k4 + 2] = 255;
                sd2[k4 + 3] = Math.round(255 * Math.min(1, 0.85 * fib[3] * onPile));
            }
        }
    });
    steps.push(()=>{
        const n = Rl * Rl;
        for(let i = 0; i < n; i++){
            lsum += lock[i];
            lsum2 += lock[i] * lock[i];
        }
        const mean = lsum / n, sdv = Math.sqrt(Math.max(1e-9, lsum2 / n - mean * mean));
        for(let i = 0; i < n; i++)lock[i] = Math.max(-2.5, Math.min(2.5, (lock[i] - mean) / sdv));
    });
    steps.push(()=>{
        dg.putImageData(darkImg, 0, 0);
        lg.putImageData(lightImg, 0, 0);
        gg.putImageData(glintImg, 0, 0);
        sg2.putImageData(softImg, 0, 0);
        bg.putImageData(backImg, 0, 0);
        for (const g of [
            dg,
            lg,
            gg,
            bg
        ]){
            g.setTransform(1, 0, 0, 1, FILM_M * px, FILM_M * px);
            g.lineCap = 'round';
            g.lineJoin = 'round';
        }
    });
    const SHADES = 16;
    const area = FILM_SPAN * FILM_SPAN;
    const fine = R >= 512 ? 1 : R >= 320 ? 0.45 : 0;
    const kinds = [
        {
            count: 0.12,
            len: 1.2,
            vary: 1.0,
            endOn: 0.6,
            width: 0.09,
            spread: 30,
            alpha: 0.4,
            deep: 1,
            lift: 0.25,
            light: 0.46,
            dark: 0.34,
            bend: 0.93,
            clump: [
                1,
                0
            ],
            clumpW: 0,
            shadow: 0,
            shadowW: 1,
            over: 0,
            crowd: false,
            short: 0
        },
        {
            count: 0.4 * fine,
            len: 0.9,
            vary: 1.2,
            endOn: 0.35,
            width: 0.13,
            spread: 100,
            alpha: 0.26,
            deep: 0.2,
            lift: 0.18,
            light: 0.55,
            dark: 0.06,
            bend: 1.2,
            clump: [
                1,
                Math.round(1 + 2 * clumps)
            ],
            clumpW: 0.08 + 0.07 * clumps,
            shadow: 0.25,
            shadowW: 2,
            over: 0.25,
            crowd: true,
            short: 1
        }
    ];
    const shadeOf = (v)=>Math.min(SHADES - 1, Math.max(0, Math.round((Math.max(-1, Math.min(1, v)) + 1) / 2 * (SHADES - 1))));
    const GLINTS = 6;
    const glintOf = (v)=>Math.min(GLINTS - 1, v * GLINTS | 0);
    const SEGS = 4;
    const hx = new Float32Array(SEGS + 1), hy = new Float32Array(SEGS + 1);
    for (const L of kinds){
        if (L.count <= 0) continue;
        const perRoot = L.clump[0] + 0.5 * L.clump[1];
        const parts = Math.max(1, Math.ceil(area * L.count * kDen * (L.crowd ? 2 : 1) * (0.5 + 0.5 * perRoot) / 9000));
        for(let part = 0; part < parts; part++)steps.push(()=>{
            const buckets = [], glints = [], backs = [], shades = [];
            for(let i = 0; i < SHADES; i++)buckets.push(new Path2D());
            for(let i = 0; i < GLINTS; i++)glints.push(new Path2D()), backs.push(new Path2D());
            for(let i = 0; i < 3; i++)shades.push(new Path2D());
            const over = new Path2D();
            const count = Math.round(area * L.count * kDen * (L.crowd ? 2 : 1) / parts);
            for(let n = 0; n < count; n++){
                const X = rand() * FILM_SPAN - O, Y = rand() * FILM_SPAN - O;
                const r0 = rand(), r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand(), r5 = rand();
                if (r5 * 8 > Math.min(X + O, FILM_SPAN - O - X, Y + O, FILM_SPAN - O - Y)) continue;
                if (L.crowd && r5 > (sdAt(X, Y) > 0 ? 0.5 / Math.max(0.25, gridAt(nZg, X, Y)) : 0.5)) continue;
                const [fx, fy] = dirAt(X, Y);
                const tiltS = gridAt(tiltG, X, Y), vl = gridAt(foreG, X, Y) / PILE_COS;
                const ang = (r1 - 0.5) * (0.6 + 0.8 * curl) * (1 - 0.5 * tiltS);
                const ca = Math.cos(ang), sa = Math.sin(ang);
                const ux = fx * ca - fy * sa, uy = fx * sa + fy * ca;
                const longer = r2 < 0.1 ? 1.35 + 0.6 * r3 : 1;
                const len = (L.len + L.vary * r3 * r3) * px * kLen * longer * vl * (1 - L.endOn + 1.25 * L.endOn * tiltS);
                fibreLight(X, Y, ux, uy, 0.1 + 0.5 * hash2(n, 7 + part));
                let v = 0.22 * lockAt(lock, X, Y) + 0.3 * lockAt(lockLit, X, Y);
                const lit = r0 < L.light * (0.4 + 0.6 * fib[2]);
                if (lit) v += 0.2 + 0.28 * r4;
                else if (r0 < L.light + L.dark) v -= 0.2 + 0.28 * r4;
                v += L.lift;
                v += 0.45 * (fib[2] - 0.5) - 0.35 * fib[8];
                if (v > 0) v *= 0.3 + 0.7 * fib[2];
                const deepen = 0.15 * (1 - fib[2]);
                const x0 = (X + PAD) * px, y0 = (Y + PAD) * px;
                const b1 = (rand() - 0.5) * L.bend * curl * len, b2 = r4 < 0.3 ? -0.6 * b1 : b1 * (0.6 + 0.8 * rand());
                const hairs = L.clump[0] + (rand() * (L.clump[1] + 1) | 0);
                const wC = L.clumpW * px * Math.min(1.5, kLen);
                for(let k = 0; k < hairs; k++){
                    const o = hairs > 1 ? rand() - 0.5 : 0, f = hairs > 1 ? 0.7 + 0.3 * rand() : 1, j = hairs > 1 ? (rand() - 0.5) * 0.3 : 0;
                    const rx = x0 - uy * o * wC, ry = y0 + ux * o * wC;
                    const lk = len * f, e1 = b1 + j * lk, e2 = b2 + j * lk - o * wC * 0.7;
                    const c1x = rx + ux * lk * 0.33 - uy * e1, c1y = ry + uy * lk * 0.33 + ux * e1;
                    const c2x = rx + ux * lk * 0.67 - uy * e2, c2y = ry + uy * lk * 0.67 + ux * e2;
                    const x1 = rx + ux * lk - uy * (b2 - o * wC * 0.75), y1 = ry + uy * lk + ux * (b2 - o * wC * 0.75);
                    const sg = lk < 4 ? 2 : lk < 10 ? 3 : SEGS;
                    for(let s = 0; s <= sg; s++){
                        const t = s / sg, q = 1 - t;
                        const a = q * q * q, b = 3 * q * q * t, c = 3 * q * t * t, d = t * t * t;
                        hx[s] = a * rx + b * c1x + c * c2x + d * x1;
                        hy[s] = a * ry + b * c1y + c * c2y + d * y1;
                    }
                    const vh = v + (hairs > 1 ? (rand() - 0.5) * 0.25 : 0), rise = 0.3 + 0.15 * fib[2];
                    for(let s = 0; s < sg; s++){
                        const bk = buckets[shadeOf(vh - 0.3 - deepen * (1 - s / sg) + rise * (s + 0.5) / sg)];
                        bk.moveTo(hx[s], hy[s]);
                        bk.lineTo(hx[s + 1], hy[s + 1]);
                    }
                    if (lit && L.over > 0) {
                        over.moveTo(hx[1], hy[1]);
                        for(let s = 2; s <= sg; s++)over.lineTo(hx[s], hy[s]);
                    }
                    if (k === 0 && L.shadow > 0 && fib[2] > 0.25 && v > -0.2) {
                        const kk = L.shadow * px * Math.min(1, kLen), sh = shades[Math.min(2, (fib[2] - 0.25) * 4 | 0)];
                        for(let s = 1; s <= sg; s++){
                            const t = s / sg, ox = -Lx * kk * t, oy = -Ly * kk * t + 0.3 * kk * t;
                            if (s === 1) sh.moveTo(hx[0], hy[0]);
                            sh.lineTo(hx[s] + ox, hy[s] + oy);
                        }
                    }
                    const h = sg >> 1;
                    if (fib[0] > 0.3) {
                        const gb = glints[glintOf(fib[0])];
                        gb.moveTo(hx[h], hy[h]);
                        for(let s = h + 1; s <= sg; s++)gb.lineTo(hx[s], hy[s]);
                    }
                    if (fib[1] > 0.1) {
                        const bb = backs[glintOf(fib[1])];
                        bb.moveTo(hx[h], hy[h]);
                        for(let s = h + 1; s <= sg; s++)bb.lineTo(hx[s], hy[s]);
                    }
                }
            }
            const shortK = Math.min(1, kLen) ** L.short;
            const lw = Math.max(0.45, L.width * px * (0.5 + 0.5 * shortK));
            if (L.over > 0) {
                dg.globalCompositeOperation = 'destination-out';
                dg.lineWidth = lw;
                dg.globalAlpha = L.over * shortK;
                dg.strokeStyle = '#000';
                dg.stroke(over);
                dg.globalCompositeOperation = 'source-over';
            }
            if (L.shadow > 0) {
                dg.lineWidth = lw * L.shadowW;
                dg.strokeStyle = '#000';
                for(let i = 0; i < 3; i++){
                    dg.globalAlpha = 0.03 * (i + 1) * shortK;
                    dg.stroke(shades[i]);
                }
            }
            for(let i = 0; i < SHADES; i++){
                const v = FUR_MID + (i / (SHADES - 1) * 2 - 1) * L.spread;
                const g = v < FUR_MID ? dg : lg;
                g.lineWidth = lw;
                g.globalAlpha = L.alpha * shortK * (v < FUR_MID ? L.deep * (1 - v / FUR_MID) : (v - FUR_MID) / (255 - FUR_MID));
                g.strokeStyle = v < FUR_MID ? '#000' : '#fff';
                g.stroke(buckets[i]);
            }
            for (const g of [
                gg,
                bg
            ]){
                g.lineWidth = lw;
                g.strokeStyle = '#fff';
            }
            for(let i = 0; i < GLINTS; i++){
                gg.globalAlpha = 0.4 * (i + 0.5) / GLINTS;
                bg.globalAlpha = 0.8 * (i + 0.5) / GLINTS;
                gg.stroke(glints[i]);
                bg.stroke(backs[i]);
            }
            dg.globalAlpha = lg.globalAlpha = gg.globalAlpha = bg.globalAlpha = 1;
        });
    }
    const fringe = new Path2D();
    const fringeBack = [];
    for(let i = 0; i < GLINTS; i++)fringeBack.push(new Path2D());
    const cells = [];
    const cu = SPAN / N;
    let edgeTries = 0;
    const FRINGE_PARTS = 2;
    for(let part = 0; part < FRINGE_PARTS; part++)steps.push(()=>{
        if (part === 0) {
            for(let i = 0; i < N * N; i++)if (form.sd[i] > -1.6 && form.sd[i] < 2.2) cells.push(i);
            edgeTries = Math.round(cells.length * cu * cu * 24 * (0.3 + 1.4 * fuzz) * Math.sqrt(kDen) * (0.5 + 0.5 * Math.min(1, R / 512)) * (1 - 0.55 * fine));
        }
        const n1 = Math.floor(edgeTries * (part + 1) / FRINGE_PARTS);
        for(let n = Math.floor(edgeTries * part / FRINGE_PARTS); n < n1; n++){
            const c = cells[rand() * cells.length | 0];
            const X = (c % N + rand()) * cu - PAD, Y = ((c / N | 0) + rand()) * cu - PAD;
            const d0 = sdAt(X, Y);
            if (d0 < -1.2 || d0 > 1.8) continue;
            const d = d0 + tuftAt(X, Y);
            if (d < -0.2 || d > 1.2) continue;
            const [fx, fy] = flow(X, Y);
            const [ox, oy] = outward(X, Y);
            const ang = (rand() - 0.5) * 1.1;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            let ux = fx * ca - fy * sa, uy = fx * sa + fy * ca;
            const r1 = rand();
            const hang = 1 + 0.5 * gravity * Math.max(0, oy) - 0.35 * gravity * Math.max(0, -oy);
            let fl = (0.3 + 1.5 * r1 * r1 * r1) * px * kLen * (0.5 + fuzz) * hang;
            const x0 = (X + PAD) * px, y0 = (Y + PAD) * px;
            let bend = (rand() - 0.5) * 1.17 * curl * fl;
            if (oy < -0.3 && rand() < 0.06 * (0.3 + fuzz)) {
                ux = ox * 0.8 + (rand() - 0.5) * 0.6;
                uy = oy * 0.8;
                fl *= 1.2;
                bend = (rand() < 0.5 ? -1 : 1) * (0.25 + 0.3 * gravity) * fl;
            }
            fringe.moveTo(x0, y0);
            const qx = x0 + ux * fl * 0.5 - uy * bend, qy = y0 + uy * fl * 0.5 + ux * bend, ex = x0 + ux * fl, ey = y0 + uy * fl + gravity * fl * 0.25;
            fringe.quadraticCurveTo(qx, qy, ex, ey);
            fibreLight(X, Y, ux, uy, 0.3);
            if (fib[1] > 0.08) {
                const fb = fringeBack[glintOf(fib[1])];
                fb.moveTo(x0, y0);
                fb.quadraticCurveTo(qx, qy, ex, ey);
            }
        }
    });
    const tufts = new Path2D(), tuftTips = [
        new Path2D(),
        new Path2D(),
        new Path2D()
    ];
    const tuftBack = [];
    for(let i = 0; i < GLINTS; i++)tuftBack.push(new Path2D());
    steps.push(()=>{
        const band = cells.length * cu * cu, around = band / 3.8;
        const count = Math.round(around / (0.45 + 0.3 * kLen) * (0.3 + 0.8 * fuzz) * Math.sqrt(kDen) * (1 + 0.6 * fine));
        for(let n = 0, tries = 0; n < count && tries < 6 * count; tries++){
            const c = cells[rand() * cells.length | 0];
            const X = (c % N + rand()) * cu - PAD, Y = ((c / N | 0) + rand()) * cu - PAD;
            const r0 = rand(), r1 = rand(), r2 = rand(), r3 = rand();
            const d0 = sdAt(X, Y);
            if (d0 < -0.5 || d0 > 1.6) continue;
            const d = d0 + tuftAt(X, Y);
            if (d < 0 || d > 0.9) continue;
            if (lockAt(lock, X, Y) < -0.4 + 0.8 * r3) continue;
            n++;
            const [fx, fy] = flow(X, Y);
            const [ox, oy] = outward(X, Y);
            const a = (r0 - 0.5) * 0.8 * (0.5 + curl), ca = Math.cos(a), sa = Math.sin(a);
            let sx = 0.75 * ox + 0.25 * fx, sy = 0.75 * oy + 0.25 * fy;
            let ex = 0.55 * fx + 0.45 * ox, ey = 0.55 * fy + 0.45 * oy + 0.35 * gravity;
            const sl = Math.hypot(sx, sy) || 1, el = Math.hypot(ex, ey) || 1;
            [sx, sy] = [
                (sx * ca - sy * sa) / sl,
                (sx * sa + sy * ca) / sl
            ];
            [ex, ey] = [
                (ex * ca - ey * sa) / el,
                (ex * sa + ey * ca) / el
            ];
            const hang = 1 + 0.5 * gravity * Math.max(0, oy) - 0.35 * gravity * Math.max(0, -oy);
            const Lt = (0.5 + 1.1 * r1 * r1) * px * kLen * (0.5 + fuzz) * hang;
            const wT = (0.3 + 0.35 * r2) * px * Math.min(1.5, kLen);
            const x0 = (X + PAD) * px, y0 = (Y + PAD) * px;
            const cx = x0 + sx * Lt * 0.5, cy = y0 + sy * Lt * 0.5;
            const tx = x0 + (sx * 0.4 + ex * 0.6) * Lt, ty = y0 + (sy * 0.4 + ey * 0.6) * Lt;
            const qx = -sy, qy = sx;
            fibreLight(X, Y, ex, ey, 0.4);
            const fb = fib[1] > 0.08 ? tuftBack[glintOf(fib[1])] : null;
            const tt = tuftTips[Math.min(2, fib[2] * 3 | 0)];
            const hairs = 4 + (rand() * 5 | 0);
            for(let k = 0; k < hairs; k++){
                const o = rand() - 0.5, f = 0.7 + 0.3 * rand(), w = (rand() - 0.5) * 0.35;
                const hx0 = x0 + qx * o * wT, hy0 = y0 + qy * o * wT;
                const hcx = cx + qx * o * wT * 0.6, hcy = cy + qy * o * wT * 0.6;
                const htx = hx0 + (tx + qx * (o * 0.25 + w) * wT - hx0) * f, hty = hy0 + (ty + qy * (o * 0.25 + w) * wT - hy0) * f;
                tufts.moveTo(hx0, hy0);
                tufts.quadraticCurveTo(hcx, hcy, htx, hty);
                const mx = 0.25 * hx0 + 0.5 * hcx + 0.25 * htx, my = 0.25 * hy0 + 0.5 * hcy + 0.25 * hty;
                tt.moveTo(mx, my);
                tt.quadraticCurveTo(0.5 * (hcx + htx), 0.5 * (hcy + hty), htx, hty);
                if (fb) {
                    fb.moveTo(mx, my);
                    fb.quadraticCurveTo(0.5 * (hcx + htx), 0.5 * (hcy + hty), htx, hty);
                }
            }
        }
    });
    steps.push(()=>{
        const tw = Math.max(0.4, 0.11 * px);
        dg.lineWidth = lg.lineWidth = bg.lineWidth = tw;
        dg.globalCompositeOperation = 'destination-out';
        dg.globalAlpha = 0.6;
        dg.strokeStyle = '#000';
        lg.strokeStyle = '#fff';
        for(let i = 0; i < 3; i++){
            dg.stroke(tuftTips[i]);
            lg.globalAlpha = 0.08 + 0.11 * i;
            lg.stroke(tuftTips[i]);
        }
        dg.globalCompositeOperation = 'source-over';
        bg.strokeStyle = '#fff';
        for(let i = 0; i < GLINTS; i++){
            bg.globalAlpha = (i + 0.5) / GLINTS;
            bg.stroke(tuftBack[i]);
        }
        dg.globalAlpha = lg.globalAlpha = bg.globalAlpha = 1;
        lg.lineWidth = dg.lineWidth = Math.max(0.35, 0.08 * px);
        lg.globalAlpha = 0.5 * ((140 - FUR_MID) / (255 - FUR_MID));
        lg.strokeStyle = '#fff';
        lg.stroke(fringe);
        lg.globalAlpha = 1;
        bg.lineWidth = lg.lineWidth;
        bg.strokeStyle = '#fff';
        for(let i = 0; i < GLINTS; i++){
            bg.globalAlpha = (i + 0.5) / GLINTS;
            bg.stroke(fringeBack[i]);
        }
        bg.globalAlpha = 1;
        dg.globalCompositeOperation = 'destination-out';
        dg.globalAlpha = 0.7;
        dg.strokeStyle = '#000';
        dg.stroke(fringe);
        dg.globalAlpha = 1;
        dg.globalCompositeOperation = 'source-over';
    });
    const mi = new ImageData(R, R), zi = new ImageData(R, R), ci = new ImageData(R, R);
    const hOut = 0.5 + 1.2 * fuzz, reachOut = hOut + tuftK;
    const haloA = HALO_A * (1 - 0.6 * fine), haloStreak = HALO_STREAK * (1 + 1.2 * fine);
    const hn = Math.max(1, Math.round(HALO_HAIR * kLen * px)), hs1 = hn + 1;
    const hsd = W_SD * Math.sqrt(1 + hn * (2 * hn + 1) / (3 * hs1)) / hs1;
    const off = Math.round(FILM_M * px);
    rows(R, 64, (y0, y1)=>{
        const md = mi.data, zd = zi.data, cd = ci.data;
        for(let y = y0; y < y1; y++){
            const Y = (y + 0.5) / px - PAD;
            for(let x = 0; x < R; x++){
                const X = (x + 0.5) / px - PAD;
                const k = (y * R + x) * 4;
                md[k] = md[k + 1] = md[k + 2] = zd[k] = zd[k + 1] = zd[k + 2] = 255;
                const d0 = sdAt(X, Y);
                if (d0 >= tuftK + HALO_CORE) {
                    md[k + 3] = cd[k + 3] = 255;
                    continue;
                }
                const d = d0 <= -reachOut ? d0 : d0 + tuftAt(X, Y);
                if (d >= 0) {
                    md[k + 3] = 255;
                    cd[k + 3] = Math.round(255 * smooth(0.25 * HALO_CORE, HALO_CORE, d));
                    continue;
                }
                const z = Math.min(1, -d / (2 * hOut));
                const nB = gridAt(nXg, X, Y) * B3[0] + gridAt(nYg, X, Y) * B3[1];
                zd[k + 3] = Math.round(255 * HALO_LIFT * z * z * (3 - 2 * z) * (0.45 + 0.55 * smooth(-0.3, 0.6, nB)));
                if (d <= -hOut) continue;
                const o = 1 + d / hOut, f = o * o * (3 - 2 * o);
                const [ux, uy] = freeDirAt(X, Y);
                let acc = 0;
                for(let t = -hn; t <= hn; t++){
                    const sx = Math.round(x + off + ux * t), sy = Math.round(y + off + uy * t);
                    acc += (sx < 0 || sy < 0 || sx >= Rb || sy >= Rb ? W_MEAN : white[sy * Rb + sx]) * (1 - Math.abs(t) / hs1);
                }
                const strand = (acc / hs1 - W_MEAN) / hsd;
                md[k + 3] = Math.round(255 * Math.max(0, Math.min(1, f * (haloA + haloStreak * strand))));
            }
        }
    });
    steps.push(()=>{
        const zc = makeCanvas(R), zg = zc && ctx2d(zc, false);
        if (zc && zg) {
            zg.putImageData(zi, 0, 0);
            fur.haze = zc;
        }
        mg.putImageData(mi, 0, 0);
        mg.lineCap = 'round';
        mg.lineWidth = Math.max(0.35, 0.08 * px);
        mg.strokeStyle = 'rgba(255,255,255,0.45)';
        mg.stroke(fringe);
        mg.lineWidth = Math.max(0.4, 0.11 * px);
        mg.strokeStyle = 'rgba(255,255,255,0.8)';
        mg.stroke(tufts);
        const oc = makeCanvas(R), og = oc && ctx2d(oc, false);
        if (oc && og) {
            og.putImageData(ci, 0, 0);
            fur.core = oc;
        }
        fur.dark = dc;
        fur.light = lc;
        fur.glint = gc;
        fur.back = bc;
        fur.backSoft = sc2;
        fur.mask = mc;
        file(fur);
    });
    return {
        steps
    };
}
function furCut(fur) {
    if (fur.cut || !fur.mask) return fur.cut;
    const R = fur.mask.width, cc = makeCanvas(R), cg = cc && ctx2d(cc, false);
    if (cc && cg) {
        cg.fillRect(0, 0, R, R);
        cg.globalCompositeOperation = 'destination-out';
        cg.drawImage(fur.mask, 0, 0);
        fur.cut = cc;
    }
    return fur.cut;
}
export function buildFabricMatcap(out, c, f, p) {
    const { V, U, D } = f;
    const vivid = p.vivid ?? 0, px = [
        0,
        0,
        0
    ];
    const L = fabricKey(U, V, p.front);
    const Lb = fabricBack(f.K, V);
    const amb = Math.max(0.03, 0.2 - 0.15 * p.shadow);
    const fillK = Math.max(0.04, 0.24 - 0.13 * p.shadow);
    const wrap = Math.min(0.7, 0.05 + 0.12 * p.spread);
    const kd = 1.3;
    const floorK = 0.34 * Math.min(1.6, p.shadow / 0.35);
    const Fl = norm3([
        -0.55 * U[0] + 0.85 * V[0] + 0.15 * D[0],
        -0.55 * U[1] + 0.85 * V[1] + 0.15 * D[1],
        -0.55 * U[2] + 0.85 * V[2] + 0.15 * D[2]
    ]);
    const satin = p.sheen ?? 0;
    const backSoft = Math.min(1, Math.max(0, p.backSoft ?? BACK_SOFT));
    const sheenK = 0.16 * p.highlight * satin, rimK = 1.15 * p.rim * satin, sssK = 0.2 + 0.25 * vivid;
    const mx = Math.max(c[0], c[1], c[2], 0.02);
    const cb = [
        c[0] / mx,
        c[1] / mx,
        c[2] / mx
    ];
    const rimIn = [
        cb[0],
        cb[1],
        cb[2]
    ];
    const wR = 0.45 * (1 - vivid), wS = 0.25 * (1 - vivid);
    const rimOut = [
        wR + (1 - wR) * cb[0],
        wR + (1 - wR) * cb[1],
        wR + (1 - wR) * cb[2]
    ];
    const sheenC = [
        wS + (1 - wS) * cb[0],
        wS + (1 - wS) * cb[1],
        wS + (1 - wS) * cb[2]
    ];
    const yOf = (v)=>0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    const de = 1.8 + 2.2 * vivid;
    const d0 = [
        Math.pow(c[0], de),
        Math.pow(c[1], de),
        Math.pow(c[2], de)
    ];
    const dk = yOf(c) / Math.max(1e-4, yOf(d0));
    const deep = [
        d0[0] * dk,
        d0[1] * dk,
        d0[2] * dk
    ];
    const sc = [
        cb[0] * cb[0] * c[0],
        cb[1] * cb[1] * c[1],
        cb[2] * cb[2] * c[2]
    ];
    for(let j = 0; j < M; j++){
        for(let i = 0; i < M; i++){
            let nx = i / (M - 1) * 2 - 1, ny = j / (M - 1) * 2 - 1;
            let r2 = nx * nx + ny * ny;
            if (r2 > 1.14) continue;
            if (r2 > 1) {
                const s = 1 / Math.sqrt(r2);
                nx *= s;
                ny *= s;
                r2 = 1;
            }
            const nz = Math.sqrt(1 - r2);
            const nl = nx * L[0] + ny * L[1] + nz * L[2];
            const nv = Math.max(0, nx * V[0] + ny * V[1] + nz * V[2]);
            const nd = nx * D[0] + ny * D[1] + nz * D[2];
            const nb = nx * Lb[0] + ny * Lb[1] + nz * Lb[2];
            const q = 1 - nv;
            const w = wrap + (0.45 - wrap) * q * q;
            let dif = Math.min(1, Math.max(0, (nl + w) / (1 + w)));
            dif = Math.pow(dif, 1.35);
            const fill = fillK * Math.max(0, nx * Fl[0] + ny * Fl[1] + nz * Fl[2]);
            const floor = 1 - floorK * Math.max(0, nd) * (0.6 + 0.4 * q);
            const light = (amb + kd * dif + fill) * floor;
            const t = Math.min(1, Math.max(0, 1 - light));
            const sb = Math.max(0, 1 - (nl + 0.08) * (nl + 0.08) / 0.18);
            const sss = sssK * sb * sb * floor;
            const lit = Math.min(1, Math.max(0, (nl + 0.2) / 0.8));
            const sheen = sheenK * q * q * lit;
            const bl = smooth(-0.3, 0.6, nb);
            const rq = smooth(0.18 - 0.12 * backSoft, 0.62 + 0.18 * backSoft, q);
            const rim = rimK * rq * Math.sqrt(rq) * (0.3 + 0.7 * bl) * (1 - 0.7 * Math.max(0, nd));
            const hot = rq * rq * Math.sqrt(rq) * (1 - 0.5 * backSoft);
            const k = (j * M + i) * 3;
            let r = 0, g = 0, b = 0;
            for(let ch = 0; ch < 3; ch++){
                const base = c[ch] + (deep[ch] - c[ch]) * t * 0.9;
                const v = base * light + sss * sc[ch] + sheen * sheenC[ch] + rim * (rimIn[ch] + (rimOut[ch] - rimIn[ch]) * hot);
                if (ch === 0) r = v;
                else if (ch === 1) g = v;
                else b = v;
            }
            const m = Math.max(r, g, b);
            if (m > 0.8) {
                const kk = (0.8 + 0.2 * (1 - Math.exp(-(m - 0.8) / 0.2))) / m;
                r *= kk;
                g *= kk;
                b *= kk;
            }
            if (vivid > 0) {
                px[0] = r;
                px[1] = g;
                px[2] = b;
                vivify(px, vivid, 1);
                [r, g, b] = px;
            }
            out[k] = srgb(r);
            out[k + 1] = srgb(g);
            out[k + 2] = srgb(b);
        }
    }
}
const GAP_DEEP = 0.28, GAP_SCATTER = 0.42;
const gapFilms = new WeakMap();
function gapFilm(fur, color, vivid = 0) {
    const src = fur.dark;
    if (!src) return null;
    let byColor = gapFilms.get(fur);
    if (!byColor) gapFilms.set(fur, byColor = new Map());
    const vq = Math.round(Math.min(1, vivid) * 10) / 10;
    const key = `${color}|${vq}`;
    const hit = byColor.get(key);
    if (hit !== undefined) return hit;
    const c = makeCanvas(src.width), g = c && ctx2d(c, false);
    if (c && g) {
        const lin = linearColor(color);
        const e = [
            srgb(lin[0]) / 255,
            srgb(lin[1]) / 255,
            srgb(lin[2]) / 255
        ];
        const mx = Math.max(e[0], e[1], e[2], 1e-3);
        const lu = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2];
        const pale = Math.min(e[0], e[1], e[2]) / mx;
        const kd = GAP_DEEP + GAP_SCATTER * lu * lu * pale;
        const ch = (v)=>Math.round(255 * kd * v * Math.pow(v / mx, 3.2 + 3 * vq));
        const r = ch(e[0]), gr = ch(e[1]), b = ch(e[2]);
        const deep = (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255 / Math.max(1e-3, lu);
        g.globalAlpha = Math.min(1, Math.sqrt((1 - GAP_REF) / Math.max(0.05, 1 - deep)));
        g.drawImage(src, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = `rgb(${r} ${gr} ${b})`;
        g.fillRect(0, 0, src.width, src.height);
    }
    if (byColor.size >= 4) byColor.clear();
    byColor.set(key, c && g ? c : null);
    return c && g ? c : null;
}
const TIP_TINT = 0.6;
const tipFilms = new WeakMap();
function tipFilm(fur, color, vivid) {
    const src = fur.light;
    if (!src) return null;
    const v = Math.round((TIP_TINT + (1 - TIP_TINT) * Math.min(1, Math.max(0, vivid))) * 10) / 10;
    const key = `${color}|${v}`;
    let byKey = tipFilms.get(fur);
    if (!byKey) tipFilms.set(fur, byKey = new Map());
    const hit = byKey.get(key);
    if (hit !== undefined) return hit;
    const c = makeCanvas(src.width), g = c && ctx2d(c, false);
    if (c && g) {
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = 'source-in';
        const lin = linearColor(color);
        const e = [
            srgb(lin[0]),
            srgb(lin[1]),
            srgb(lin[2])
        ];
        const mx = Math.max(e[0], e[1], e[2], 1);
        const ch = (u)=>Math.round(255 + (255 * u / mx - 255) * Math.min(1, v));
        g.fillStyle = `rgb(${ch(e[0])} ${ch(e[1])} ${ch(e[2])})`;
        g.fillRect(0, 0, src.width, src.height);
    }
    if (byKey.size >= 6) byKey.clear();
    byKey.set(key, c && g ? c : null);
    return c && g ? c : null;
}
const sheenFilms = new WeakMap();
function sheenFilm(fur, color, p) {
    const gl = fur.glint, bk = fur.back;
    if (!gl || !bk) return null;
    const hk = Math.min(1, 0.45 * p.highlight * (p.shine ?? 0)), rk = Math.min(1, 1.1 * p.rim);
    if (hk <= 0.01 && rk <= 0.01) return null;
    const vivid = Math.min(1, p.vivid ?? 0);
    const soft = Math.min(1, Math.max(0, Math.round((p.backSoft ?? BACK_SOFT) * 20) / 20));
    const key = `${color}|${hk.toFixed(2)}|${rk.toFixed(2)}|${vivid.toFixed(1)}|${soft}`;
    let byKey = sheenFilms.get(fur);
    if (!byKey) sheenFilms.set(fur, byKey = new Map());
    const hit = byKey.get(key);
    if (hit !== undefined) return hit;
    const W = gl.width;
    const c = makeCanvas(W), g = c && ctx2d(c, false);
    const t = makeCanvas(W), tg = t && ctx2d(t, false);
    if (c && g && t && tg) {
        const lin = linearColor(color);
        const e = [
            srgb(lin[0]),
            srgb(lin[1]),
            srgb(lin[2])
        ];
        const mx = Math.max(e[0], e[1], e[2], 1);
        const mix = (k)=>`rgb(${[
                0,
                1,
                2
            ].map((i)=>Math.round(255 + (255 * e[i] / mx - 255) * k)).join(' ')})`;
        const layers = [
            [
                bk,
                mix(0.65 + 0.35 * vivid),
                rk * (1 - 0.85 * soft)
            ],
            [
                fur.backSoft,
                mix(0.7 + 0.3 * vivid),
                rk * soft
            ],
            [
                gl,
                mix(0.45 + 0.55 * vivid),
                hk
            ]
        ];
        for (const [src, fill, a] of layers){
            if (!src) continue;
            if (a <= 0.01) continue;
            tg.globalCompositeOperation = 'copy';
            tg.drawImage(src, 0, 0);
            tg.globalCompositeOperation = 'source-in';
            tg.fillStyle = fill;
            tg.fillRect(0, 0, W, W);
            g.globalAlpha = a;
            g.drawImage(t, 0, 0);
        }
        g.globalAlpha = 1;
    }
    if (byKey.size >= 6) byKey.clear();
    byKey.set(key, c && g ? c : null);
    return c && g ? c : null;
}
const norm3 = (v)=>{
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [
        v[0] / l,
        v[1] / l,
        v[2] / l
    ];
};
export function capFrame(r) {
    const cr = Math.cos(r.roll), sr = Math.sin(r.roll);
    const lx = cr * r.lx + sr * r.ly, ly = -sr * r.lx + cr * r.ly;
    const mirror = r.facing < 0 ? -1 : 1;
    const zf = mirror * Math.min(1, Math.abs(r.facing) / 0.16);
    const { cy, sy, cp, sp } = r;
    const local = (x, y, z, zk = zf)=>norm3([
            cy * x + sy * sp * y - sy * cp * z,
            cp * y + sp * z,
            zk * (sy * x - cy * sp * y + cy * cp * z)
        ]);
    const L = local(E_XY * lx, E_XY * ly, E_Z);
    const V = local(0, 0, 1, mirror);
    const H = norm3([
        L[0] + V[0],
        L[1] + V[1],
        L[2] + V[2]
    ]);
    const U = local(lx, ly, 0, mirror);
    const cw = Math.cos(80 * Math.PI / 180), sw = Math.sin(80 * Math.PI / 180);
    const wx = cw * lx - sw * ly, wy = sw * lx + cw * ly;
    const Ws = norm3([
        0.55 * wx,
        0.55 * wy,
        0.83
    ]);
    const As = norm3([
        Ws[1],
        -Ws[0],
        0
    ]);
    const Bs = [
        Ws[1] * As[2] - Ws[2] * As[1],
        Ws[2] * As[0] - Ws[0] * As[2],
        Ws[0] * As[1] - Ws[1] * As[0]
    ];
    const W = local(Ws[0], Ws[1], Ws[2], mirror), A = local(As[0], As[1], As[2], mirror), B = local(Bs[0], Bs[1], Bs[2], mirror);
    const D = local(sr, cr, 0, mirror);
    const [kx0, ky0] = r.bx !== undefined && r.by !== undefined ? [
        r.bx,
        r.by
    ] : backFromKey(r.lx, r.ly);
    const K = local(cr * kx0 + sr * ky0, -sr * kx0 + cr * ky0, 0, mirror);
    return {
        L,
        V,
        H,
        U,
        W,
        A,
        B,
        D,
        K
    };
}
const states = new WeakMap();
function stateFor(ctx, outline) {
    const key = ctx.canvas ?? ctx;
    let byOutline = states.get(key);
    if (!byOutline) {
        byOutline = new Map();
        states.set(key, byOutline);
    }
    let s = byOutline.get(outline);
    if (!s) {
        s = {
            N: 0,
            img: null,
            mc: new Float32Array(MM * 3),
            mcPrev: new Float32Array(MM * 3),
            mcMix: new Float32Array(MM * 3),
            mixVersion: 0,
            blendT: 1,
            blendFrames: 1,
            sinceBuild: 0,
            L: null,
            V: null,
            lx: NaN,
            ly: NaN,
            base: '',
            shadow: NaN,
            highlight: NaN,
            spread: NaN,
            rim: NaN,
            vivid: NaN,
            front: NaN,
            sheen: NaN,
            backSoft: NaN,
            K: null,
            version: 0,
            imgVersion: -1,
            imgAoK: NaN,
            imgForm: null,
            aoK: -1,
            aoMul: new Float32Array(256),
            scratch: [
                null,
                null
            ],
            scratchIdx: 0,
            scratchN: 0,
            scratchStale: true,
            sprites: [
                null,
                null,
                null,
                null,
                null
            ],
            sliceG: [],
            sliceIns: [],
            sliceSpr: new Map(),
            sliceSprKey: '',
            sliceSprMade: new Set(),
            sliceKey: '',
            body: [
                null,
                null
            ],
            bodyIdx: 0,
            spriteVersion: -1,
            spritePx: 0,
            spriteFur: null,
            miss: [
                0,
                0
            ],
            missAt: [
                0,
                0
            ],
            turnAt: [
                0,
                0
            ],
            fade: null,
            lay: 1,
            layTmp: null,
            haloTmp: null
        };
        if (byOutline.size > 4) byOutline.clear();
        byOutline.set(outline, s);
    }
    return s;
}
const BIN = 1 / 48;
const moved = (a, b)=>!b || Math.abs(a[0] - b[0]) >= BIN || Math.abs(a[1] - b[1]) >= BIN || Math.abs(a[2] - b[2]) >= BIN;
export function mulAffine(A, B) {
    return [
        A[0] * B[0] + A[2] * B[1],
        A[1] * B[0] + A[3] * B[1],
        A[0] * B[2] + A[2] * B[3],
        A[1] * B[2] + A[3] * B[3],
        A[0] * B[4] + A[2] * B[5] + A[4],
        A[1] * B[4] + A[3] * B[5] + A[5]
    ];
}
function raysOf(img, form, c0) {
    const { N, sd } = form;
    const data = img.data;
    const toG = (v)=>(v + PAD) / SPAN * N - 0.5;
    const dOut = [], cOut = [];
    for(let s = 0; s < CONIC_STOPS; s++){
        const phi = s / CONIC_STOPS * Math.PI * 2, ux = Math.cos(phi), uy = Math.sin(phi);
        const ds = [], cs = [];
        for(let r = 0; r < 80; r += 0.5){
            const x = c0[0] + ux * r, y = c0[1] + uy * r;
            const d = bilerp(sd, N, toG(x), toG(y));
            if (d < 0) break;
            const gx = Math.round(toG(x)), gy = Math.round(toG(y));
            if (gx < 0 || gy < 0 || gx >= N || gy >= N) break;
            const k = (gy * N + gx) * 4;
            ds.push(d);
            cs.push(data[k], data[k + 1], data[k + 2]);
        }
        dOut.push(Float32Array.from(ds));
        cOut.push(Float32Array.from(cs));
    }
    return {
        d: dOut,
        c: cOut
    };
}
function sliceGradient(ctx, rays, inset, dark, c0, lxy, linear) {
    const at = (s)=>{
        const d = rays.d[s], c = rays.c[s];
        const ins = typeof inset === 'number' ? inset : inset[s], k = 1 - (typeof dark === 'number' ? dark : dark[s]);
        let j = 0;
        for(let i = 0; i < d.length; i++)if (d[i] >= ins) j = i;
        return c.length ? `rgb(${c[j * 3] * k | 0} ${c[j * 3 + 1] * k | 0} ${c[j * 3 + 2] * k | 0})` : 'rgb(0 0 0)';
    };
    if (!linear && typeof ctx.createConicGradient === 'function') {
        const g = ctx.createConicGradient(0, c0[0], c0[1]);
        for(let s = 0; s <= CONIC_STOPS; s++)g.addColorStop(s / CONIC_STOPS, at(s % CONIC_STOPS));
        return g;
    }
    const g = ctx.createLinearGradient(c0[0] + lxy[0] * 50, c0[1] + lxy[1] * 50, c0[0] - lxy[0] * 50, c0[1] - lxy[1] * 50);
    const ray = (a)=>Math.round((a % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2 / CONIC_STOPS)) % CONIC_STOPS;
    g.addColorStop(0, at(ray(Math.atan2(lxy[1], lxy[0]))));
    g.addColorStop(0.5, at(ray(Math.atan2(lxy[0], -lxy[1]))));
    g.addColorStop(1, at(ray(Math.atan2(-lxy[1], -lxy[0]))));
    return g;
}
function hazeColor(rays, base, rim, vivid = 0) {
    const m = /rgb\((\d+) (\d+) (\d+)\)/.exec(brightest(rays));
    const b = m ? [
        +m[1],
        +m[2],
        +m[3]
    ] : [
        255,
        255,
        255
    ];
    const lin = linearColor(base);
    const e = [
        srgb(lin[0]),
        srgb(lin[1]),
        srgb(lin[2])
    ];
    const mx = Math.max(e[0], e[1], e[2], 1);
    const k = Math.min(0.85, 0.75 * rim);
    const pale = 0.45 + 0.55 * Math.min(1, vivid);
    const q = (i)=>Math.round(b[i] + (255 + (255 * e[i] / mx - 255) * pale - b[i]) * k);
    return `rgb(${q(0)} ${q(1)} ${q(2)})`;
}
function brightest(rays) {
    let best = -1, r = 0, g = 0, b = 0;
    for (const c of rays.c){
        for(let i = 0; i < c.length; i += 3){
            const l = 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2];
            if (l > best) best = l, r = c[i], g = c[i + 1], b = c[i + 2];
        }
    }
    const q = (v)=>Math.min(255, Math.round(v / 4) * 4);
    return `rgb(${q(r)} ${q(g)} ${q(b)})`;
}
function stackReach(rel, K, ex, ey, dl1, vx, vy, h, at) {
    const v0 = vx * rel.cx[0] + vy * rel.cy[0], ve = (vx * ex + vy * ey) * dl1;
    let best = h, kb = 0, far = false;
    for(let k = 1; k < K; k++){
        const r = vx * rel.cx[k] + vy * rel.cy[k] + rel.scale[k] * (h - v0);
        if (r + rel.z[k] * ve > best) best = r + rel.z[k] * ve, kb = k, far = false;
        if (r - rel.z[k] * ve > best) best = r - rel.z[k] * ve, kb = k, far = true;
    }
    if (at) at.k = kb, at.far = far;
    return best;
}
function haloStretch(form, rel, K, ex, ey, dl1) {
    if (dl1 <= 1e-4) return [
        1,
        0,
        0,
        1,
        0,
        0
    ];
    const rim = rimOf(form);
    const hp = reach(rim, ex, ey), hn = reach(rim, -ex, -ey);
    const up = stackReach(rel, K, ex, ey, dl1, ex, ey, hp), un = stackReach(rel, K, ex, ey, dl1, -ex, -ey, hn);
    const s1 = (up + un) / Math.max(1, hp + hn) - 1, t = up - (s1 + 1) * hp;
    return [
        1 + s1 * ex * ex,
        s1 * ex * ey,
        s1 * ex * ey,
        1 + s1 * ey * ey,
        ex * t,
        ey * t
    ];
}
function haloRays(form, rel, K, ex, ey, dl1, S, backShade) {
    const rim = rimOf(form);
    const inset = new Float32Array(CONIC_STOPS), dark = new Float32Array(CONIC_STOPS);
    const s1 = S[0] + S[3] - 2, at = {
        k: 0,
        far: false
    };
    for(let s = 0; s < CONIC_STOPS; s++){
        const phi = s / CONIC_STOPS * Math.PI * 2, ux = Math.cos(phi), uy = Math.sin(phi);
        const ue = ux * ex + uy * ey, q = s1 / (1 + s1);
        let vx = ux - q * ue * ex, vy = uy - q * ue * ey;
        const vl = Math.hypot(vx, vy);
        vx /= vl;
        vy /= vl;
        stackReach(rel, K, ex, ey, dl1, vx, vy, reach(rim, vx, vy), at);
        inset[s] = Math.max(HALO_INSET, rel.inset[at.k]);
        dark[s] = at.far ? HALO_SHADE * backShade * (1 - Math.exp(-2.4 * (at.k / K))) : 0;
    }
    return {
        inset,
        dark
    };
}
const misses = new WeakMap();
const MISS_N = 96, MISS_STEP = 0.1;
function haloMiss(form, path, rel, K, S, dxs, dys, sync) {
    const key = `${K}|${rel.q}|${Math.round(dxs / MISS_STEP)}|${Math.round(dys / MISS_STEP)}`;
    let byKey = misses.get(form);
    if (!byKey) misses.set(form, byKey = new Map());
    const hit = byKey.get(key);
    if (hit || hit === null && !sync) return hit ?? null;
    if (byKey.size > 256) byKey.clear();
    if (!sync) {
        byKey.set(key, null);
        idle(()=>{
            byKey.set(key, measureMiss(form, path, rel, K, S, dxs, dys));
        });
        return null;
    }
    const r = measureMiss(form, path, rel, K, S, dxs, dys);
    byKey.set(key, r);
    return r;
}
function measureMiss(form, path, rel, K, S, dxs, dys) {
    const c = makeCanvas(MISS_N), g = c && ctx2d(c, true);
    if (!g) return [
        0,
        0
    ];
    const u = SPAN / MISS_N;
    const det = S[0] * S[3] - S[1] * S[2];
    const ia = S[3] / det, ib = -S[1] / det, ic = -S[2] / det, id = S[0] / det;
    const ie = -(ia * S[4] + ic * S[5]), jf = -(ib * S[4] + id * S[5]);
    g.fillStyle = '#fff';
    for(let k = 0; k < K; k++){
        for (const z of k ? [
            rel.z[k],
            -rel.z[k]
        ] : [
            0
        ]){
            g.setTransform(1 / u, 0, 0, 1 / u, PAD / u, PAD / u);
            g.transform(ia, ib, ic, id, ie, jf);
            g.translate(z * dxs, z * dys);
            const sk = rel.scale[k];
            if (k) g.transform(sk, 0, 0, sk, rel.cx[k] - sk * rel.cx[0], rel.cy[k] - sk * rel.cy[0]);
            g.fill(path);
        }
    }
    const px = g.getImageData(0, 0, MISS_N, MISS_N).data;
    const on = new Uint8Array(MISS_N * MISS_N), dist = new Float32Array(MISS_N * MISS_N);
    for(let i = 0; i < MISS_N * MISS_N; i++)on[i] = px[i * 4 + 3] > 127 ? 1 : 0;
    edt2d(on, 1, MISS_N, dist, null);
    let cut = 0, over = 0;
    for(let y = 0, i = 0; y < MISS_N; y++){
        for(let x = 0; x < MISS_N; x++, i++){
            const d = bilerp(form.sd, form.N, (x + 0.5) / MISS_N * form.N - 0.5, (y + 0.5) / MISS_N * form.N - 0.5);
            if (on[i] && d < 0) cut = Math.max(cut, -d);
            if (!on[i] && d > 0) over = Math.max(over, Math.sqrt(dist[i]) * u);
        }
    }
    return [
        cut,
        over
    ];
}
const WEBKIT = typeof navigator !== 'undefined' && /AppleWebKit\//.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);
const GECKO = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);
export function drawPlasticCap(ctx, cfg, rig, pal, union, mat) {
    const N = tierFor(rig.dev);
    const form = formFor(cfg.typeKey ?? pathId(cfg.path), cfg.path, N, rig.halfDepth, !!rig.still);
    if (!form) return false;
    const fabric = cfg.shading === 'fabric';
    const capPx = Math.ceil(SPAN * rig.dev / 100);
    const lights = (()=>{
        const [bx, by] = rig.bx !== undefined && rig.by !== undefined ? [
            rig.bx,
            rig.by
        ] : backFromKey(rig.lx, rig.ly);
        return {
            bx,
            by,
            front: mat.front ?? KEY_EL
        };
    })();
    const fur = fabric ? furReady(form, cfg.typeKey ?? pathId(cfg.path), rig.halfDepth, capPx, !!rig.still && !cfg.furOnIdle, rig.lx, rig.ly, cfg.fur ?? FUR_STOCK, lights) : null;
    if (fabric && !fur) return false;
    const st = stateFor(ctx, (cfg.typeKey ?? pathId(cfg.path)) + (fabric ? '|fabric' : ''));
    const f = capFrame(rig);
    const lxy = (()=>{
        const l = Math.hypot(f.L[0], f.L[1]);
        return l < 0.05 ? [
            0,
            -1
        ] : [
            f.L[0] / l,
            f.L[1] / l
        ];
    })();
    if (moved(f.L, st.L) || moved(f.V, st.V) || rig.lx !== st.lx || rig.ly !== st.ly || pal.base !== st.base || mat.shadow !== st.shadow || mat.highlight !== st.highlight || mat.spread !== st.spread || mat.rim !== st.rim || (mat.vivid ?? 0) !== st.vivid || (mat.front ?? KEY_EL) !== st.front || (mat.sheen ?? 0) !== st.sheen || (mat.backSoft ?? BACK_SOFT) !== st.backSoft || fabric && moved(f.K, st.K)) {
        if (st.version > 0) st.mcPrev.set(st.mcMix);
        if (fabric) buildFabricMatcap(st.mc, linearColor(pal.base), f, mat);
        else buildMatcap(st.mc, linearColor(pal.base), f, mat);
        if (st.version === 0 || rig.still) {
            st.mcMix.set(st.mc);
            st.blendT = 1;
        } else {
            st.blendFrames = Math.min(10, Math.max(1, st.sinceBuild));
            st.blendT = 0;
        }
        st.sinceBuild = 0;
        st.mixVersion++;
        st.L = f.L;
        st.V = f.V;
        st.lx = rig.lx;
        st.ly = rig.ly;
        st.base = pal.base;
        st.shadow = mat.shadow;
        st.highlight = mat.highlight;
        st.spread = mat.spread;
        st.rim = mat.rim;
        st.vivid = mat.vivid ?? 0;
        st.front = mat.front ?? KEY_EL;
        st.sheen = mat.sheen ?? 0;
        st.backSoft = mat.backSoft ?? BACK_SOFT;
        st.K = f.K;
        st.version++;
    }
    st.sinceBuild++;
    if (st.blendT < 1) {
        st.blendT = Math.min(1, st.blendT + 1 / st.blendFrames);
        const e = st.blendT >= 1 ? 1 : st.blendT * st.blendT * (3 - 2 * st.blendT);
        const a = st.mcPrev, b = st.mc, o = st.mcMix;
        for(let i = 0; i < MM * 3; i++)o[i] = a[i] + (b[i] - a[i]) * e;
        st.mixVersion++;
    }
    const aoK = fur ? Math.min(1.2, 0.3 + 0.8 * mat.shadow) : Math.min(1.3, 1.2 * mat.shadow);
    if (aoK !== st.aoK) {
        for(let a = 0; a < 256; a++)st.aoMul[a] = Math.max(0, 1 - aoK * (1 - a / 255));
        st.aoK = aoK;
    }
    if (!st.img || st.N !== N) {
        st.img = new ImageData(N, N);
        st.N = N;
        st.imgVersion = -1;
    }
    if (st.imgVersion !== st.mixVersion || st.imgAoK !== aoK || st.imgForm !== form) {
        shadeTexels(form, st.mcMix, st.img.data, st.aoMul, fur ? edgeLift(form) : undefined);
        st.imgVersion = st.mixVersion;
        st.imgAoK = aoK;
        st.imgForm = form;
        st.scratchStale = true;
    }
    if (st.scratchN !== N) {
        st.scratch = [
            null,
            null
        ];
        st.scratchN = N;
        st.scratchStale = true;
    }
    if (st.scratchStale) {
        st.scratchIdx ^= 1;
        let sc = st.scratch[st.scratchIdx];
        if (!sc) {
            const c = makeCanvas(N);
            const g = c && ctx2d(c, false);
            if (!c || !g) return false;
            sc = st.scratch[st.scratchIdx] = {
                c,
                g
            };
        }
        sc.g.putImageData(st.img, 0, 0);
        st.scratchStale = false;
    }
    const sc = st.scratch[st.scratchIdx];
    const capSrc = sc.c;
    const K = rig.dev <= 100 ? 14 : rig.dev <= 224 ? 20 : 26;
    const rel = reliefFor(form, K, rig.round ?? 1);
    const { cy, sy, cp, sp } = rig;
    const [ca, cb, cc, cd, ce, cf] = rig.ctm;
    const m1 = sy * sp;
    const ta = ca * cy + cc * m1, tb = cb * cy + cd * m1, tc = cc * cp, td = cd * cp;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const near = rig.facing >= 0 ? 1 : -1;
    const dxs = sy / cy, dys = -sp / (cy * cp);
    const dl1 = Math.hypot(dxs, dys);
    let lead = 50;
    for(let k = 1; k < K; k++)lead = Math.max(lead, 50 * rel.scale[k] + rel.z[k] * dl1);
    const ex = dl1 > 1e-6 ? near * dxs / dl1 : 1, ey = dl1 > 1e-6 ? near * dys / dl1 : 0;
    const backShade = Math.min(0.7, 0.55 * Math.min(1.6, mat.shadow / 0.35));
    const haloS = fur ? haloStretch(form, rel, K, ex, ey, dl1) : null;
    const spx = Math.ceil(SPAN * rig.dev / 100);
    if (st.spritePx !== spx) {
        st.sprites = [
            null,
            null,
            null,
            null,
            null
        ];
        st.spritePx = spx;
        st.spriteVersion = -1;
    }
    if (st.spriteVersion !== st.version || st.spriteFur !== fur) {
        const k = spx / SPAN;
        const soft = fur ? softMask(form, fur.R) : null;
        const rays = raysOf(st.img, form, [
            rel.cx[0],
            rel.cy[0]
        ]);
        for(let i = 0; i < 4; i++){
            if (i === 2) continue;
            let spr = st.sprites[i];
            if (!spr) {
                const c = makeCanvas(spx);
                const g = c && ctx2d(c, false);
                if (!c || !g) return false;
                spr = st.sprites[i] = {
                    c,
                    g
                };
            }
            const g = spr.g;
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalCompositeOperation = 'source-over';
            g.clearRect(0, 0, spx, spx);
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            const halo = i === 0 && fur && fur.mask ? fur : null;
            if (halo && halo.haze) {
                g.imageSmoothingQuality = 'low';
                g.drawImage(halo.haze, 0, 0, spx, spx);
                g.imageSmoothingQuality = 'high';
                g.globalCompositeOperation = 'source-in';
                g.fillStyle = hazeColor(rays, pal.base, mat.rim, mat.vivid ?? 0);
                g.fillRect(0, 0, spx, spx);
                g.globalCompositeOperation = 'destination-over';
            }
            g.setTransform(k, 0, 0, k, PAD * k, PAD * k);
            const edge = halo && haloS ? haloRays(form, rel, K, ex, ey, dl1, haloS, backShade) : null;
            g.fillStyle = i === 1 ? '#000' : sliceGradient(g, rays, edge ? edge.inset : fur ? Math.max(HALO_INSET, rel.inset[0]) : rel.inset[0], edge ? edge.dark : 0, [
                rel.cx[0],
                rel.cy[0]
            ], lxy, WEBKIT);
            if (fur && fur.mask) {
                g.fillRect(-PAD, -PAD, SPAN, SPAN);
                g.setTransform(1, 0, 0, 1, 0, 0);
                g.globalCompositeOperation = 'destination-in';
                g.drawImage((i === 0 ? fur.mask : soft) ?? fur.mask, 0, 0, spx, spx);
                g.globalCompositeOperation = 'source-over';
            } else g.fill(cfg.path);
        }
        if (fur && fur.core) {
            let band = st.sprites[4];
            if (!band) {
                const c = makeCanvas(spx);
                const bg = c && ctx2d(c, false);
                if (c && bg) band = st.sprites[4] = {
                    c,
                    g: bg
                };
            }
            if (band) {
                band.g.setTransform(1, 0, 0, 1, 0, 0);
                band.g.globalCompositeOperation = 'copy';
                band.g.drawImage(st.sprites[0].c, 0, 0);
                band.g.globalCompositeOperation = 'destination-out';
                band.g.drawImage(fur.core, 0, 0, spx, spx);
                band.g.globalCompositeOperation = 'source-over';
            }
        }
        st.spriteVersion = st.version;
        st.spriteFur = fur;
    }
    const stretch = (lead + 50) / 100, shift = (lead - 50) / 2;
    const A = 1 + (stretch - 1) * ex * ex, B = (stretch - 1) * ex * ey, D = 1 + (stretch - 1) * ey * ey;
    const capM = mulAffine(mulAffine(rig.ctm, [
        cy,
        m1,
        0,
        cp,
        0,
        0
    ]), [
        A,
        B,
        B,
        D,
        shift * ex - 50 * A - 50 * B,
        shift * ey - 50 * B - 50 * D
    ]);
    const film = fur?.dark && fur.light ? fur : null;
    let g = ctx, ox = 0, oy = 0, bw = 0, bh = 0;
    if (film) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const z of [
            -rel.top,
            rel.top
        ]){
            const e = z * sy - 50 * cy, fo = -z * cy * sp - 50 * m1 - 50 * cp;
            const E = ca * e + cc * fo + ce, F = cb * e + cd * fo + cf;
            for (const x of [
                -PAD,
                100 + PAD
            ])for (const y of [
                -PAD,
                100 + PAD
            ]){
                const X = ta * x + tc * y + E, Y = tb * x + td * y + F;
                if (X < x0) x0 = X;
                if (X > x1) x1 = X;
                if (Y < y0) y0 = Y;
                if (Y > y1) y1 = Y;
            }
        }
        ox = Math.floor(x0) - 1;
        oy = Math.floor(y0) - 1;
        bw = Math.ceil(x1) + 1 - ox;
        bh = Math.ceil(y1) + 1 - oy;
        st.bodyIdx ^= 1;
        let b = st.body[st.bodyIdx];
        if (!b || b.w < bw || b.h < bh || b.w > 2 * bw + 64 || b.h > 2 * bh + 64) {
            const w = Math.ceil(bw / 64) * 64, h = Math.ceil(bh / 64) * 64;
            let c = null;
            if (typeof document !== 'undefined') {
                c = document.createElement('canvas');
                c.width = w;
                c.height = h;
            } else if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(w, h);
            const cg = c && ctx2d(c, false);
            b = c && cg ? st.body[st.bodyIdx] = {
                c,
                g: cg,
                w: c.width,
                h: c.height
            } : null;
        }
        if (b) {
            g = b.g;
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalCompositeOperation = 'source-over';
            g.globalAlpha = 1;
            g.clearRect(0, 0, bw, bh);
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
        } else ox = oy = 0;
    }
    const at = (z)=>{
        const e = z * sy - 50 * cy, fo = -z * cy * sp - 50 * m1 - 50 * cp;
        g.setTransform(ta, tb, tc, td, ca * e + cc * fo + ce - ox, cb * e + cd * fo + cf - oy);
    };
    const [fringed, black, , side] = st.sprites;
    const c0 = [
        rel.cx[0],
        rel.cy[0]
    ];
    const sliceKey = `${st.version}|${K}|${rel.q}`;
    if (st.sliceKey !== sliceKey) {
        const rays = raysOf(st.img, form, c0);
        st.sliceG = [];
        st.sliceIns = [];
        for(let k = 0; k < K; k++){
            const inset = fur ? Math.max(HALO_INSET, rel.inset[k]) : rel.inset[k];
            st.sliceIns.push(inset);
            st.sliceG.push(sliceGradient(ctx, rays, inset, 0, c0, lxy, WEBKIT));
        }
        st.sliceKey = sliceKey;
    }
    const useSpr = GECKO && typeof document !== 'undefined';
    const sprKey = `${sliceKey}|${spx}`;
    if (useSpr && st.sliceSprKey !== sprKey) {
        st.sliceSprKey = sprKey;
        st.sliceSprMade = new Set();
        if (st.sliceSpr.size > 32) st.sliceSpr.clear();
    }
    const sprite = (k)=>{
        const ins = st.sliceIns[k];
        let sp = st.sliceSpr.get(ins);
        if (sp && st.sliceSprMade.has(ins)) return sp;
        if (!sp || sp.c.width !== spx) {
            const c = document.createElement('canvas');
            c.width = c.height = spx;
            const cg = c.getContext('2d');
            if (!cg) return undefined;
            sp = {
                c,
                g: cg
            };
            st.sliceSpr.set(ins, sp);
        }
        const kk = spx / SPAN;
        sp.g.setTransform(1, 0, 0, 1, 0, 0);
        sp.g.clearRect(0, 0, spx, spx);
        sp.g.setTransform(kk, 0, 0, kk, PAD * kk, PAD * kk);
        sp.g.fillStyle = st.sliceG[k];
        sp.g.fill(cfg.path);
        st.sliceSprMade.add(ins);
        return sp;
    };
    const slice = (k, z, dark)=>{
        at(z);
        const sk = rel.scale[k];
        if (k > 0) {
            g.transform(sk, 0, 0, sk, rel.cx[k] - sk * rel.cx[0], rel.cy[k] - sk * rel.cy[0]);
            const spr = useSpr ? sprite(k) : undefined;
            if (spr) g.drawImage(spr.c, -PAD, -PAD, SPAN, SPAN);
            else {
                g.fillStyle = st.sliceG[k];
                g.fill(cfg.path);
            }
            if (dark > 0.01) {
                g.globalAlpha = dark;
                g.fillStyle = '#000';
                g.fill(cfg.path);
                g.globalAlpha = 1;
            }
            return;
        }
        if (fur) g.drawImage(side.c, -PAD, -PAD, SPAN, SPAN);
        else {
            g.fillStyle = st.sliceG[0];
            g.fill(cfg.path);
        }
        if (fur && g === ctx && fringeA > 0.01) {
            g.globalAlpha = fringeA;
            g.drawImage(fringed.c, -PAD, -PAD, SPAN, SPAN);
            g.globalAlpha = 1;
        }
        if (dark > 0.01) {
            g.globalAlpha = dark;
            g.drawImage(black.c, -PAD, -PAD, SPAN, SPAN);
            g.globalAlpha = 1;
        }
    };
    const faceOn = Math.abs(rig.facing);
    const fringeA = faceOn >= 0.8 ? 1 : faceOn <= 0.45 ? 0 : (faceOn - 0.45) / 0.35;
    const ring = ringOf(form), rn = ring.x.length, sd = form.sd, NF = form.N;
    const hideBy = 1.5 / (Math.sqrt(Math.abs(ta * td - tb * tc)) || 1) + 0.4;
    const texel = SPAN / NF;
    const toG = (v)=>(v + PAD) / SPAN * NF - 0.5;
    const leanFar = Math.atan2(-near * dys, -near * dxs), leanNear = Math.atan2(near * dys, near * dxs);
    for(let k = K - 1; k >= 1; k--){
        const z = -near * rel.z[k], sk = rel.scale[k];
        if (fur) {
            const bx = rel.cx[k] - sk * rel.cx[0] + z * dxs, by = rel.cy[k] - sk * rel.cy[0] + z * dys;
            let hidden = Number.isFinite(bx) && Number.isFinite(by);
            for(let j = 0; hidden && j < rn; j++){
                const i = ringOrder(rn, leanFar, j);
                if (bilerp(sd, NF, toG(sk * ring.x[i] + bx), toG(sk * ring.y[i] + by)) < hideBy + sk * (ring.d[i] + texel)) hidden = false;
            }
            if (hidden) continue;
        }
        slice(k, z, fur ? 0 : backShade * (1 - Math.exp(-2.4 * (k / K))));
    }
    if (fur && dl1 > 1e-3) {
        const hn = reach(rimOf(form), -ex, -ey), span = 1.3 * rel.top * dl1;
        at(0);
        const ramp = g.createLinearGradient(-ex * hn, -ey * hn, -ex * (hn + span), -ey * (hn + span));
        for(let s = 0; s <= 8; s++){
            const t = s / 8;
            ramp.addColorStop(t, `rgba(0,0,0,${(backShade * (1 - Math.exp(-2.4 * t)) * t * t * (3 - 2 * t)).toFixed(3)})`);
        }
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = ramp;
        g.fillRect(-PAD - 60, -PAD - 60, SPAN + 120, SPAN + 120);
        g.globalCompositeOperation = 'source-over';
    }
    slice(0, 0, 0);
    const face = Math.abs(rig.facing);
    const frontA = face >= 0.72 ? 1 : face <= 0.34 ? 0 : ((face - 0.34) / 0.38) ** 1.5;
    const cdet = capM[0] * capM[3] - capM[1] * capM[2];
    const coverBy = FRONT_FADE + 1.5 / (Math.sqrt(Math.abs(cdet)) || 1);
    for(let k = 1; k < K; k++){
        const z = near * rel.z[k], sk = rel.scale[k];
        if (frontA >= 1 && Math.abs(cdet) > 1e-9) {
            const e = z * sy - 50 * cy, fo = -z * cy * sp - 50 * m1 - 50 * cp;
            const E = ca * e + cc * fo + ce - capM[4], F = cb * e + cd * fo + cf - capM[5];
            const ux = rel.cx[k] - sk * rel.cx[0], uy = rel.cy[k] - sk * rel.cy[0];
            let covered = true;
            for(let j = 0; covered && j < rn; j++){
                const i = ringOrder(rn, leanNear, j);
                const u = sk * ring.x[i] + ux, v = sk * ring.y[i] + uy;
                const X = ta * u + tc * v + E, Y = tb * u + td * v + F;
                const qx = (capM[3] * X - capM[2] * Y) / cdet, qy = (capM[0] * Y - capM[1] * X) / cdet;
                if (bilerp(sd, NF, toG(qx), toG(qy)) < coverBy + sk * (ring.d[i] + texel)) covered = false;
            }
            if (covered) continue;
        }
        slice(k, z, 0);
    }
    if (frontA > 0.01) {
        g.save();
        g.setTransform(capM[0], capM[1], capM[2], capM[3], capM[4] - ox, capM[5] - oy);
        g.globalAlpha = frontA;
        g.drawImage(capSrc, -PAD, -PAD, SPAN, SPAN);
        g.restore();
    }
    if (fur && fur.mask && haloS && g !== ctx) {
        const mx = near * dxs, my = near * dys;
        const stale = Math.abs(mx - st.missAt[0]) > 1.5 * MISS_STEP || Math.abs(my - st.missAt[1]) > 1.5 * MISS_STEP;
        const measured = dl1 > 1e-4 ? haloMiss(form, cfg.path, rel, K, haloS, mx, my, !!rig.still || stale) : [
            0,
            0
        ];
        if (measured) {
            st.miss = measured;
            st.missAt = [
                mx,
                my
            ];
        }
        const [cut, over] = st.miss;
        const miss = Math.max(cut, over);
        let back = smooth(HALO_FIT / 2, 2 * HALO_FIT, miss), gone = smooth(HALO_FIT / 2, HALO_FIT, over);
        const quick = Math.abs(mx - st.turnAt[0]) > MISS_STEP || Math.abs(my - st.turnAt[1]) > MISS_STEP;
        st.turnAt = [
            mx,
            my
        ];
        const settle = !rig.still && !quick;
        if (settle && st.fade) {
            const ease = (a, b)=>Math.abs(b - a) < 0.02 ? b : a + (b - a) * 0.2;
            back = ease(st.fade[0], back);
            gone = ease(st.fade[1], gone);
        }
        st.fade = [
            back,
            gone
        ];
        const band = st.sprites[4];
        g.imageSmoothingQuality = 'low';
        at(0);
        g.transform(haloS[0], haloS[1], haloS[2], haloS[3], haloS[4], haloS[5]);
        const layTo = (1 - smooth(0, HALO_BLEND, back)) * (1 - gone);
        const lay = st.lay = !settle ? layTo : st.lay + Math.max(-HALO_EASE, Math.min(HALO_EASE, layTo - st.lay));
        let h = null;
        if (lay > 0 && lay < 1) {
            let t = st.layTmp;
            if (!t || t.c.width < bw || t.c.height < bh) {
                const n = Math.ceil(Math.max(bw, bh) / 64) * 64;
                let c = null;
                if (typeof document !== 'undefined') {
                    c = document.createElement('canvas');
                    c.width = c.height = n;
                } else c = makeCanvas(n);
                const cg = c && ctx2d(c, false);
                t = st.layTmp = c && cg ? {
                    c,
                    g: cg
                } : null;
            }
            if (t) {
                h = t.g;
                h.setTransform(1, 0, 0, 1, 0, 0);
                h.globalAlpha = 1;
                h.globalCompositeOperation = 'copy';
                h.drawImage(g.canvas, 0, 0, bw, bh, 0, 0, bw, bh);
                h.imageSmoothingQuality = 'low';
                h.setTransform(g.getTransform());
            }
        }
        const veil = HALO_VEIL * Math.min(1, dl1 / 0.2);
        const laid = (d)=>{
            if (WEBKIT) {
                let t = st.haloTmp;
                if (!t || t.c.width < bw || t.c.height < bh) {
                    const n = Math.ceil(Math.max(bw, bh) / 64) * 64;
                    let c = null;
                    if (typeof document !== 'undefined') {
                        c = document.createElement('canvas');
                        c.width = c.height = n;
                    } else c = makeCanvas(n);
                    const cg = c && ctx2d(c, false);
                    t = st.haloTmp = c && cg ? {
                        c,
                        g: cg
                    } : null;
                }
                if (t) {
                    const tg = t.g;
                    tg.setTransform(1, 0, 0, 1, 0, 0);
                    tg.globalCompositeOperation = 'source-over';
                    tg.globalAlpha = 1;
                    tg.clearRect(0, 0, bw, bh);
                    tg.imageSmoothingEnabled = true;
                    tg.imageSmoothingQuality = 'low';
                    tg.setTransform(d.getTransform());
                    tg.drawImage(fringed.c, -PAD, -PAD, SPAN, SPAN);
                    d.save();
                    d.setTransform(1, 0, 0, 1, 0, 0);
                    d.globalCompositeOperation = 'destination-atop';
                    d.drawImage(t.c, 0, 0, bw, bh, 0, 0, bw, bh);
                    d.restore();
                }
            } else {
                d.globalCompositeOperation = 'destination-atop';
                d.drawImage(fringed.c, -PAD, -PAD, SPAN, SPAN);
            }
            if (band && veil > 0.01) {
                d.globalCompositeOperation = 'source-atop';
                d.globalAlpha = veil;
                d.drawImage(band.c, -PAD, -PAD, SPAN, SPAN);
                d.globalAlpha = 1;
            }
            d.globalCompositeOperation = 'source-over';
        };
        if (h) laid(h);
        if (lay >= 1 || !h && lay >= 0.5) laid(g);
        else {
            const cutAway = back < 1 ? furCut(fur) : null;
            if (cutAway) {
                const f = 1 + back * (miss + HALO_FIT) / 25, cx = rel.cx[0], cy = rel.cy[0];
                g.save();
                g.transform(f, 0, 0, f, cx * (1 - f), cy * (1 - f));
                g.globalCompositeOperation = 'destination-out';
                g.drawImage(cutAway, -PAD, -PAD, SPAN, SPAN);
                g.restore();
            }
            if (gone < 1) {
                g.globalAlpha = 1 - gone;
                g.globalCompositeOperation = 'destination-over';
                g.drawImage(fringed.c, -PAD, -PAD, SPAN, SPAN);
                g.globalAlpha = 1;
            }
            if (h) {
                g.setTransform(1, 0, 0, 1, 0, 0);
                g.globalCompositeOperation = 'destination-in';
                g.globalAlpha = 1 - lay;
                g.fillStyle = '#000';
                g.fillRect(0, 0, bw, bh);
                g.globalCompositeOperation = 'lighter';
                g.globalAlpha = lay;
                g.drawImage(h.canvas, 0, 0, bw, bh, 0, 0, bw, bh);
                g.globalAlpha = 1;
            }
        }
        g.globalCompositeOperation = 'source-over';
    }
    if (g !== ctx && film) {
        g.globalCompositeOperation = 'source-atop';
        g.imageSmoothingQuality = 'low';
        const lin = linearColor(pal.base);
        const lum = Math.pow(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2], 1 / 2.2);
        const dark = gapFilm(film, pal.base, mat.vivid ?? 0) ?? film.dark, tips = tipFilm(film, pal.base, mat.vivid ?? 0) ?? film.light;
        const sheenA = rig.dev < 160 ? 0 : face >= 0.88 ? 1 : face <= 0.55 ? 0 : (face - 0.55) / 0.33;
        const sheen = sheenA > 0.01 ? sheenFilm(film, pal.base, mat) : null;
        const lift = near * PILE_H * (cfg.fur ?? FUR_STOCK).length;
        const capT = mulAffine(mulAffine(mulAffine(rig.ctm, [
            1,
            0,
            0,
            1,
            lift * sy,
            -lift * cy * sp
        ]), [
            cy,
            m1,
            0,
            cp,
            0,
            0
        ]), [
            A,
            B,
            B,
            D,
            shift * ex - 50 * A - 50 * B,
            shift * ey - 50 * B - 50 * D
        ]);
        const lay = (M, a, withSheen, T = M)=>{
            g.setTransform(M[0], M[1], M[2], M[3], M[4] - ox, M[5] - oy);
            g.globalAlpha = a;
            g.drawImage(dark, -PAD - FILM_M, -PAD - FILM_M, FILM_SPAN, FILM_SPAN);
            if (T !== M) g.setTransform(T[0], T[1], T[2], T[3], T[4] - ox, T[5] - oy);
            g.globalAlpha = a * (0.25 + 0.75 * lum);
            g.drawImage(tips, -PAD - FILM_M, -PAD - FILM_M, FILM_SPAN, FILM_SPAN);
            if (withSheen && sheen) {
                g.globalAlpha = a * sheenA;
                g.drawImage(sheen, -PAD - FILM_M, -PAD - FILM_M, FILM_SPAN, FILM_SPAN);
            }
            g.globalAlpha = 1;
        };
        const sideU = face >= 0.62 ? 0 : face <= 0.36 ? 1 : (0.62 - face) / 0.26;
        if (sideU < 1) lay(capM, 1 - sideU, true, capT);
        if (sideU > 0) {
            const k = rig.dev / 100, cxs = ox + bw / 2, cys = oy + bh / 2;
            lay([
                k,
                0,
                0,
                k,
                cxs - 50 * k,
                cys - 50 * k
            ], sideU, false);
        }
        g.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(g.canvas, 0, 0, bw, bh, ox, oy, bw, bh);
        ctx.restore();
    }
    ctx.setTransform(ca, cb, cc, cd, ce, cf);
    const hairA = face >= 0.95 ? 1 : face <= 0.8 ? 0 : (face - 0.8) / 0.15;
    if (!fur && rig.dev >= 256 && mat.rim > 0 && mat.highlight > 0 && hairA > 0.01) {
        ctx.save();
        if (union) ctx.clip(union);
        else ctx.globalCompositeOperation = 'source-atop';
        ctx.setTransform(capM[0], capM[1], capM[2], capM[3], capM[4], capM[5]);
        const al = hairA * Math.min(0.5, 0.3 * mat.rim * Math.min(1.4, mat.highlight));
        const g = ctx.createLinearGradient(50 + lxy[0] * 50, 50 + lxy[1] * 50, 50 - lxy[0] * 50, 50 - lxy[1] * 50);
        g.addColorStop(0, `rgba(235,244,255,${al.toFixed(3)})`);
        g.addColorStop(0.45, `rgba(235,244,255,${(0.35 * al).toFixed(3)})`);
        g.addColorStop(0.75, 'rgba(235,244,255,0)');
        ctx.strokeStyle = g;
        ctx.lineJoin = 'round';
        ctx.lineWidth = 1.3;
        ctx.stroke(cfg.path);
        ctx.restore();
    }
    return true;
}
