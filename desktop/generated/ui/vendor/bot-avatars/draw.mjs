import { shade } from './color.mjs';
import { drawPlasticCap, mulAffine, surfaceAt } from './plastic.mjs';
import { drawGlasses, drawWearBehind, drawWearFront } from './wear.mjs';
export const OVERSCAN = 1.5;
export const RISE = 0.1;
const SLICES = 17;
const HALF_DEPTH = 15;
const CAP = 0.9;
const profile = (z, cap)=>cap + (1 - cap) * Math.sqrt(Math.max(0, 1 - z * z));
const EYE_GAP = 25;
const EYE_RX = 6.3;
const EYE_Y = {
    eyes: 1,
    mouth: -3.5
};
const paletteCache = new Map();
function palette(color, shadow, highlight) {
    const key = `${color}|${shadow}|${highlight}`;
    let p = paletteCache.get(key);
    if (!p) {
        const far = shade(color, -0.3 * shadow, 0.05 * shadow);
        const near = shade(color, -0.12 * shadow, 0.03 * shadow);
        const crispMix = [], smoothMix = [];
        for(let j = 0; j < SLICES; j++){
            const t = j / (SLICES - 1);
            crispMix.push(t > 0.6 ? '' : mixCss(far, near, t / 0.6));
            smoothMix.push(t >= 0.5 ? color : mixCss(far, color, t / 0.5));
        }
        p = {
            base: color,
            far,
            near,
            light: shade(color, 0.04 * highlight),
            dark: shade(color, -0.3 * shadow, 0.05 * shadow),
            capTop: shade(color, 0.035 * highlight),
            capBottom: shade(color, -0.035 * shadow),
            crispMix,
            smoothMix,
            grad: null
        };
        if (paletteCache.size > 200) paletteCache.clear();
        paletteCache.set(key, p);
    }
    return p;
}
const hslNums = (c)=>(c.startsWith('hsl(') ? c : shade(c, 0)).match(/[\d.]+/g).map(Number);
function mixCss(a, b, t) {
    const pa = hslNums(a);
    const pb = hslNums(b);
    const m = pa.map((v, i)=>v + (pb[i] - v) * t);
    return `hsl(${m[0].toFixed(1)} ${m[1].toFixed(1)}% ${m[2].toFixed(1)}%)`;
}
const WHIRL_SEGMENTS = 34;
const WHIRL_SPAN = Math.PI * 1.55;
const WHIRL_RX = 57;
const WHIRL_RATIO = 0.4;
const WHIRL_TILT = -0.28;
const whirlInkCache = new Map();
function whirlInk(color) {
    let w = whirlInkCache.get(color);
    if (!w) {
        w = {
            base: shade(color, 0.1, 0.02),
            light: shade(color, 0.3, 0.04),
            dark: shade(color, -0.22, 0.08),
            halo: shade(color, 0.2)
        };
        if (whirlInkCache.size > 200) whirlInkCache.clear();
        whirlInkCache.set(color, w);
    }
    return w;
}
const withAlpha = (hsl, a)=>hsl.replace(')', ` / ${Math.max(0, Math.min(1, a)).toFixed(3)})`);
function drawWhirl(ctx, pose, color, lx, ly, near, knobs) {
    const strength = knobs?.strength ?? 0;
    const k = Math.min(1, pose.whirl * strength);
    if (k <= 0.01) return;
    const sizeK = knobs?.size ?? 1, widthK = knobs?.width ?? 1, lengthK = knobs?.length ?? 1, tiltK = knobs?.tilt ?? 1;
    const span = WHIRL_SPAN * lengthK;
    const ink = whirlInk(color);
    const head = -pose.whirlAngle;
    const rx = WHIRL_RX * sizeK;
    const ry = rx * WHIRL_RATIO * tiltK * (near ? 1.14 : 0.86);
    const lightA = Math.atan2(ly, lx) - WHIRL_TILT;
    ctx.save();
    ctx.rotate(WHIRL_TILT);
    ctx.translate(0, 5);
    ctx.lineCap = 'butt';
    const seg = (a0, a1, width, style, dy)=>{
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.ellipse(0, dy, rx, ry, 0, a0, a1, false);
        ctx.stroke();
    };
    if (near) {
        for(let i = 0; i < WHIRL_SEGMENTS; i++){
            const f = i / WHIRL_SEGMENTS;
            const a1 = head + f * span, a0 = a1 + span / WHIRL_SEGMENTS + 0.012;
            if (Math.sin((a0 + a1) / 2) <= 0) continue;
            const fade = Math.pow(1 - f, 1.3);
            seg(a1, a0, (2 + 8 * fade) * 1.5 * widthK, `rgba(0,0,0,${(0.2 * k * fade).toFixed(3)})`, 3.5);
        }
    }
    for(let i = 0; i < WHIRL_SEGMENTS; i++){
        const f = i / WHIRL_SEGMENTS;
        const a1 = head + f * span, a0 = a1 + span / WHIRL_SEGMENTS + 0.012;
        const mid = (a0 + a1) / 2;
        if (Math.sin(mid) > 0 !== near) continue;
        const depth = 0.6 + 0.4 * Math.sin(mid);
        const fade = Math.pow(1 - f, 1.3);
        const puff = 1 + 0.18 * Math.sin(f * 9 + 1.2);
        const width = (2 + 8 * fade) * depth * widthK * puff;
        const a = k * (0.3 + 0.7 * fade) * depth;
        const facing = 0.5 + 0.5 * Math.cos(mid - lightA);
        seg(a1, a0, width * 2.6, withAlpha(ink.halo, a * 0.2), 0);
        seg(a1, a0, width * 0.8, withAlpha(ink.dark, a * 0.45), width * 0.32);
        seg(a1, a0, width, withAlpha(ink.base, a * 0.72), 0);
        seg(a1, a0, width * 0.62, withAlpha(ink.light, a * 0.78 * (0.4 + 0.6 * facing)), -width * 0.16);
        seg(a1, a0, width * 0.24, `rgba(255,255,255,${(a * 0.9 * (0.15 + 0.85 * facing * facing)).toFixed(3)})`, -width * 0.3);
    }
    ctx.restore();
}
const backOf = (deg)=>{
    if (deg === undefined || !Number.isFinite(deg)) return {};
    const a = deg * Math.PI / 180;
    return {
        bx: Math.sin(a),
        by: -Math.cos(a)
    };
};
export const LIGHT_DEFAULTS = {
    fabric: {
        shadow: 1.15,
        highlight: 1.45,
        light: 295,
        rim: 0.6,
        spread: 1.6
    },
    other: {
        shadow: 0.35,
        highlight: 1.3,
        light: 300,
        rim: 0.5,
        spread: 1.55
    }
};
export function draw(ctx, box, pose, cfg) {
    const full = box * OVERSCAN;
    ctx.clearRect(0, 0, full, full);
    const S = box / 100;
    let dpr, base;
    if (cfg.dpr !== undefined) {
        dpr = cfg.dpr;
        base = [
            dpr,
            0,
            0,
            dpr,
            0,
            0
        ];
    } else if (ctx.getTransform) {
        const t = ctx.getTransform();
        base = [
            t.a,
            t.b,
            t.c,
            t.d,
            t.e,
            t.f
        ];
        dpr = t.a || 1;
    } else {
        dpr = 1;
        base = [
            1,
            0,
            0,
            1,
            0,
            0
        ];
    }
    const lit = LIGHT_DEFAULTS[cfg.shading === 'fabric' ? 'fabric' : 'other'];
    const shadow = cfg.shadow ?? lit.shadow, highlight = cfg.highlight ?? lit.highlight;
    const halfDepth = HALF_DEPTH * (cfg.depth ?? 0.65);
    const rimK = cfg.rim ?? lit.rim;
    const cap = 1 - (1 - CAP) * rimK;
    const spread = cfg.spread ?? lit.spread;
    const la = (cfg.light ?? lit.light) * Math.PI / 180;
    const lx = Math.sin(la), ly = -Math.cos(la);
    const pal = palette(cfg.color, shadow, highlight);
    const cy0 = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
    const cp0 = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
    const facing = cy0 * cp0;
    const floor = (v)=>Math.abs(v) < 0.22 ? v < 0 ? -0.22 : 0.22 : v;
    const cy = floor(cy0), cp = floor(cp0);
    const cr = Math.cos(pose.roll), sr = Math.sin(pose.roll), kx = pose.sx * S, ky = pose.sy * S;
    const lift = 50 * (1 - pose.sy) * S;
    const body = mulAffine(base, [
        cr * kx,
        sr * kx,
        -sr * ky,
        cr * ky,
        full / 2 + pose.x * S - sr * lift,
        full / 2 + RISE * box + pose.y * S + cr * lift
    ]);
    ctx.save();
    ctx.setTransform(body[0], body[1], body[2], body[3], body[4], body[5]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const mode = cfg.shading;
    const drawSolid = (path, key, halfDepth, plush = true)=>{
        let lit = pal.near;
        let capFill = pal.base;
        if (mode === 'crisp') {
            if (!pal.grad || pal.grad.lx !== lx || pal.grad.ly !== ly) {
                const g = ctx.createLinearGradient(lx * 56, ly * 56, -lx * 56, -ly * 56);
                g.addColorStop(0, pal.light);
                g.addColorStop(0.45, pal.near);
                g.addColorStop(1, pal.dark);
                const c = ctx.createLinearGradient(lx * 46, ly * 46, -lx * 46, -ly * 46);
                c.addColorStop(0, pal.capTop);
                c.addColorStop(1, pal.capBottom);
                pal.grad = {
                    lx,
                    ly,
                    lit: g,
                    cap: c
                };
            }
            lit = pal.grad.lit;
            capFill = pal.grad.cap;
        }
        let plasticDone = false;
        if (mode === 'plastic' || mode === 'fabric') {
            plasticDone = drawPlasticCap(ctx, {
                ...cfg,
                path,
                typeKey: key,
                shading: plush ? mode : 'plastic'
            }, {
                cy,
                sy,
                cp,
                sp,
                facing,
                roll: pose.roll,
                halfDepth,
                cap,
                lx,
                ly,
                ...backOf(cfg.backLight),
                dev: box * dpr,
                ctm: body,
                still: cfg.still,
                round: cfg.roundness ?? 1
            }, pal, null, {
                shadow,
                highlight,
                spread,
                rim: rimK,
                vivid: cfg.vivid ?? 0,
                front: Math.min(85, Math.max(0, cfg.lightFront ?? 32)) * Math.PI / 180,
                shine: cfg.shine ?? 0,
                sheen: cfg.sheen ?? 0,
                backSoft: cfg.backSoftness ?? 1
            });
        }
        const mode2 = (mode === 'plastic' || mode === 'fabric') && !plasticDone ? 'smooth' : mode;
        const soft = mode2 === 'smooth';
        const union = soft && typeof Path2D === 'function' ? new Path2D() : null;
        const order = facing >= 0 ? 1 : -1;
        const [ca, cb, cc, cd, ce, cf] = body;
        let fill = null;
        let pa = 1, pb = 0, pc = 0, pd = 1, pe = 0, pf = 0;
        for(let j = 0; j < SLICES && !plasticDone; j++){
            const k = order > 0 ? j : SLICES - 1 - j;
            const z = -1 + 2 * k / (SLICES - 1);
            const s = profile(z, cap);
            const near = j / (SLICES - 1);
            const m0 = cy * s, m1 = sy * sp * s, m3 = cp * s;
            const e = z * sy * halfDepth - 50 * m0, fo = -z * cy * sp * halfDepth - 50 * m1 - 50 * m3;
            const det = pa * pd - pb * pc;
            const ia = pd / det, ib = -pb / det, ic = -pc / det, id = pa / det, ie = (pc * pf - pd * pe) / det, jf = (pb * pe - pa * pf) / det;
            ctx.transform(ia * m0 + ic * m1, ib * m0 + id * m1, ic * m3, id * m3, ia * e + ic * fo + ie, ib * e + id * fo + jf);
            pa = m0;
            pb = m1;
            pc = 0;
            pd = m3;
            pe = e;
            pf = fo;
            let style;
            if (soft) style = pal.smoothMix[j];
            else if (j === SLICES - 1) style = capFill;
            else if (near > 0.6) style = lit;
            else style = pal.crispMix[j];
            if (style !== fill) ctx.fillStyle = fill = style;
            ctx.fill(path);
            if (union) union.addPath(path, {
                a: m0,
                b: m1,
                c: 0,
                d: m3,
                e,
                f: fo
            });
        }
        if (!plasticDone) ctx.setTransform(ca, cb, cc, cd, ce, cf);
        if (union && mode2 === 'smooth') {
            ctx.save();
            ctx.clip(union);
            const sa = Math.min(1, 0.34 * shadow);
            const sg = ctx.createRadialGradient(-lx * 45, -ly * 45, 4 * spread, -lx * 45, -ly * 45, 84 * spread);
            sg.addColorStop(0, `rgba(0,0,0,${sa})`);
            sg.addColorStop(0.5, `rgba(0,0,0,${sa * 0.35})`);
            sg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = sg;
            ctx.fillRect(-120, -120, 240, 240);
            ctx.globalCompositeOperation = 'source-over';
            const ha = Math.min(1, 0.22 * highlight);
            const hg = ctx.createRadialGradient(lx * 37, ly * 37, 0, lx * 37, ly * 37, 62 * spread);
            hg.addColorStop(0, `rgba(255,255,255,${ha})`);
            hg.addColorStop(0.6, `rgba(255,255,255,${ha * 0.23})`);
            hg.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = hg;
            ctx.fillRect(-120, -120, 240, 240);
            ctx.restore();
        }
        return plasticDone;
    };
    drawWhirl(ctx, pose, cfg.color, lx, ly, false, cfg.whirl);
    const wear = cfg.wear;
    const worn = !!wear && (wear.hat !== 'none' || wear.glasses !== 'none' || wear.headphones || wear.bowTie);
    const wr = {
        cy,
        sy,
        cp,
        sp,
        facing,
        halfDepth,
        lx,
        ly
    };
    if (worn) drawWearBehind(ctx, cfg.path, wr, wear);
    const key = cfg.typeKey ?? 'custom';
    const parts = cfg.parts ? Array.isArray(cfg.parts) ? cfg.parts : [
        cfg.parts
    ] : [];
    for(let i = 0; i < parts.length; i++)drawSolid(parts[i], Array.isArray(cfg.parts) ? `${key}:parts${i}/${parts.length}` : `${key}:parts`, halfDepth * (cfg.partsDepth ?? 0.4), false);
    const plasticDone = drawSolid(cfg.path, key, halfDepth);
    const zf = facing >= 0 ? 1 : -1;
    const round = cfg.roundness ?? 1;
    const cushion = plasticDone;
    const sf = cushion ? 1 : profile(zf, cap);
    const surface = (x, y)=>cushion ? surfaceAt(key, halfDepth, x, y, round) ?? 0.8 * halfDepth : halfDepth * sf;
    const zFace = cushion ? 0.55 * surface(cfg.faceX, cfg.faceY) : halfDepth;
    const fm0 = cy * sf, fm1 = sy * sp * sf, fm3 = cp * sf;
    const fe = zf * sy * zFace - 50 * fm0;
    const ffo = -zf * cy * sp * zFace - 50 * fm1 - 50 * fm3;
    let frontClip = null;
    if (worn && typeof Path2D === 'function') {
        frontClip = new Path2D();
        frontClip.addPath(cfg.path, {
            a: fm0,
            b: fm1,
            c: 0,
            d: fm3,
            e: fe,
            f: ffo
        });
    }
    if (facing > -0.2) {
        ctx.save();
        {
            const [ca, cb, cc, cd, ce, cf] = body;
            ctx.setTransform(ca * fm0 + cc * fm1, cb * fm0 + cd * fm1, cc * fm3, cd * fm3, ca * fe + cc * ffo + ce, cb * fe + cd * ffo + cf);
            ctx.clip(cfg.path);
            ctx.setTransform(ca, cb, cc, cd, ce, cf);
        }
        ctx.translate(cfg.faceX - 50, cfg.faceY - 50);
        ctx.scale(cfg.faceScale, cfg.faceScale);
        if (mode === 'plastic' && plasticDone) ctx.globalAlpha = 0.93;
        const eyes = drawFace(ctx, pose, cfg);
        ctx.globalAlpha = 1;
        const glasses = wear && wear.glasses !== 'none' ? wear.glasses : null;
        const turn = {
            yaw: pose.yaw,
            pitch: pose.pitch
        };
        if (glasses) drawGlasses(ctx, glasses, eyes, {
            lx,
            ly
        }, 'shadow', turn);
        ctx.restore();
        if (glasses) {
            ctx.save();
            ctx.translate(cfg.faceX - 50, cfg.faceY - 50);
            ctx.scale(cfg.faceScale, cfg.faceScale);
            drawGlasses(ctx, glasses, eyes, {
                lx,
                ly
            }, 'frame', turn);
            ctx.restore();
        }
    }
    if (worn) drawWearFront(ctx, cfg.path, wr, wear, frontClip, surface, {
        y: cfg.faceY,
        scale: cfg.faceScale
    });
    drawWhirl(ctx, pose, cfg.color, lx, ly, true, cfg.whirl);
    ctx.restore();
}
const FACE_R = 30;
function onSphere(x, y, yaw, pitch) {
    const lon = Math.asin(Math.max(-1, Math.min(1, x / FACE_R))) + yaw;
    const lat = Math.asin(Math.max(-1, Math.min(1, -y / FACE_R))) + pitch;
    const cl = Math.cos(lat);
    return {
        x: FACE_R * Math.sin(lon) * cl,
        y: -FACE_R * Math.sin(lat),
        sx: Math.cos(lon),
        sy: cl,
        z: Math.cos(lon) * cl
    };
}
const EYE_STEPS = 8;
const eyePaths = new Map();
function eyePath(x0, y0, cy) {
    const qx = Math.round(x0 * 50), qy = Math.round(y0 * 50), qc = Math.round(cy * 50);
    const key = qx + 2000 * qy + 4e6 * qc;
    let p = eyePaths.get(key);
    if (!p) {
        const ax = qx / 50, ay = qy / 50, ac = qc / 50;
        let d = `M${-ax} ${ay}`;
        for(let i = 1; i <= EYE_STEPS; i++){
            const t = i / EYE_STEPS, mt = 1 - t;
            d += ` L${(mt * mt * -ax + t * t * ax).toFixed(3)} ${((mt * mt + t * t) * ay + 2 * mt * t * ac).toFixed(3)}`;
        }
        p = new Path2D(d);
        if (eyePaths.size > 256) eyePaths.clear();
        eyePaths.set(key, p);
    }
    return p;
}
const MOUTH_SIN = Math.sin(0.684), MOUTH_COS = Math.cos(0.684);
const mouthPaths = new Map();
function mouthPath(m) {
    const q = (v)=>Math.round(v * 50) / 50;
    const hw = q(m.hw), t0 = q(m.t0), a = q(m.a), yt = q(m.yt), ab = q(m.ab), yb = q(m.yb);
    const key = `${hw},${t0},${a},${yt},${ab},${yb}`;
    let p = mouthPaths.get(key);
    if (p) return p;
    const f = (v)=>v.toFixed(3);
    const nx = t0 * MOUTH_SIN, ny = t0 * MOUTH_COS;
    const ltx = -hw + nx, lty = -ny, rtx = hw - nx, rty = -ny;
    const lbx = -hw - nx, lby = ny, rbx = hw + nx, rby = ny;
    const cx = 4 / 3 * t0 * MOUTH_COS, cy = 4 / 3 * t0 * MOUTH_SIN;
    const d = `M${f(ltx)} ${f(lty)}` + `C${f(-hw + a * hw)} ${f(yt - t0)} ${f(hw - a * hw)} ${f(yt - t0)} ${f(rtx)} ${f(rty)}` + `C${f(rtx + cx)} ${f(rty - cy)} ${f(rbx + cx)} ${f(rby - cy)} ${f(rbx)} ${f(rby)}` + `C${f(hw - ab * hw)} ${f(yb + t0)} ${f(-hw + ab * hw)} ${f(yb + t0)} ${f(lbx)} ${f(lby)}` + `C${f(lbx - cx)} ${f(lby - cy)} ${f(ltx - cx)} ${f(lty - cy)} ${f(ltx)} ${f(lty)}Z`;
    p = new Path2D(d);
    if (mouthPaths.size > 256) mouthPaths.clear();
    mouthPaths.set(key, p);
    return p;
}
function drawFace(ctx, pose, cfg) {
    const [wd, ww, ws] = pose.w;
    const ink = cfg.ink;
    const ey = EYE_Y[cfg.face];
    const half = EYE_GAP / 2;
    const lx = pose.lookX, ly = pose.lookY;
    const { yaw, pitch } = pose;
    const at = (x, y, fn, alpha = 1)=>{
        const q = onSphere(x, y, yaw, pitch);
        if (q.z <= 0.02 || alpha <= 0.01) return;
        ctx.save();
        ctx.globalAlpha = alpha * Math.min(1, q.z * 5);
        ctx.translate(q.x, q.y);
        ctx.scale(Math.max(0.02, q.sx), Math.max(0.02, q.sy));
        fn();
        ctx.restore();
    };
    const past = (v, d)=>Math.abs(v) <= d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d);
    const clamp1 = (v)=>Math.max(-1, Math.min(1, v));
    const up = past(clamp1(-pose.pitch / 0.26 - pose.lookY / 7), 0.34);
    const side = Math.abs(past(clamp1(pose.lookX / 4.5), 0.4));
    const tall = Math.max(0.3, 1 + 0.55 * up - 0.1 * side);
    const wide = 1 - 0.05 * up + 0.12 * side;
    const open = wd + ww * (1 - pose.laugh);
    const laugh = ww * pose.laugh;
    const lift = Math.max(0, -pose.y) / 26;
    const sag = 0.5 + 0.5 * pose.breath;
    for (const side of [
        -1,
        1
    ]){
        const lid = side < 0 ? pose.blinkL : pose.blinkR;
        const e = Math.max(0, Math.min(1, pose.eyeOpen * (1 - lid)));
        const kOpen = open * e, kShut = open * (1 - e), kLaugh = laugh, kSleep = ws;
        const x0 = kOpen * 0.01 + kShut * 5.4 + kLaugh * 6.2 + kSleep * 6;
        const y0 = kOpen * 1.1 * tall + kShut * 0.6 + kLaugh * (2.2 - lift * 1.5) + kSleep * (-1.4 + sag);
        const cy = kOpen * -3.3 * tall + kShut * 0.6 + kLaugh * (-11.4 - 4 * lift) + kSleep * (5.4 + 2 * sag);
        const w = kOpen * EYE_RX * 2 * wide + kShut * 2.8 + kLaugh * 4.4 + kSleep * 4;
        const dx = lx * (kOpen + 0.5 * (kShut + kLaugh)), dy = ly * (kOpen + 0.5 * kShut);
        at(side * half + dx, ey + dy, ()=>{
            ctx.strokeStyle = ink;
            ctx.lineWidth = w;
            ctx.stroke(eyePath(x0, y0, cy));
        });
    }
    if (cfg.face === 'mouth') {
        const mx = lx * 0.35;
        const kd = (0.6 + 0.4 * wd) * (1 + 0.06 * pose.breath);
        const kw = (0.6 + 0.4 * ww) * (1 + 0.25 * Math.max(0, -pose.y) / 26);
        const r = 2.7 * ws * (1 + 0.25 * pose.breath);
        const b = (d, w, s)=>wd * d + ww * w + ws * s;
        const m = {
            hw: b(6.5 * kd, 9.5 * kw, r),
            t0: b(1.9, 0, 0),
            a: b(2 / 3, 2 / 3, 0),
            yt: b(3.53 * kd, 1.6 * kw, -4 * r / 3),
            ab: b(2 / 3, 0, 0),
            yb: b(3.53 * kd, 17.3 * kw, 4 * r / 3)
        };
        at(mx, b(12.5, 11.6, 15.5), ()=>{
            ctx.fillStyle = ink;
            ctx.fill(mouthPath(m));
        });
    }
    const spot = (x)=>{
        const q = onSphere(x, ey, yaw, pitch);
        return {
            x: q.x,
            y: q.y,
            sx: q.sx,
            sy: q.sy,
            z: q.z,
            ox: x,
            oy: ey,
            fz: Math.sqrt(Math.max(0, FACE_R * FACE_R - x * x - ey * ey))
        };
    };
    return [
        spot(-half),
        spot(half)
    ];
}
