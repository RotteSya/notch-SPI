// MIT BotAvatarsKit engine aligned to the pinned native Mac port. See vendor README.
export const STATES = ["default", "working", "sleeping"];
const HOP_T = 0.68;
const HOP_SPIN_H = 26;
const FLIP_PRE = 0.2;
const FLIP_POST = 0.66;
export const JUMP_DEFAULTS = {
  height: HOP_SPIN_H,
  time: HOP_T,
  stretch: 1,
  squash: 1.15,
  squashTime: 0.37,
  squashEase: "pulse",
  groundTime: 0.11,
  groundEase: "pulse",
  riseTime: 0.33,
  riseEase: "pulse",
  clickSquashTime: 0.24,
  spin: 1,
  lean: 6,
  every: 8,
  land: 0,
};
const flipPre = (j, poked) => (poked ? j.clickSquashTime : FLIP_PRE * j.time);
const flipDuration = (j, poked) =>
  flipPre(j, poked) +
  j.time +
  (poked ? j.clickSquashTime : j.squashTime) +
  Math.max(0, j.land) +
  0.05;
const squashPulse = (u, ease) => {
  if (u <= 0 || u >= 1) return 0;
  let x;
  switch (ease) {
    case "sharp":
      x = (1 - u) * (1 - u);
      break;
    case "soft":
      x = Math.sin(Math.PI * u) ** 2;
      break;
    case "bouncy":
      x = (Math.exp(-3.15 * u) * Math.sin(8.43 * u)) / 0.596;
      break;
    default: {
      const k = 7 * u;
      x = (k * k * Math.exp(2 - k)) / 4;
    }
  }
  const tail = u > 0.85 ? 1 - (u - 0.85) / 0.15 : 1;
  return x * tail * tail * (3 - 2 * tail);
};
const hopSquash = (a) =>
  Math.exp(-Math.pow(Math.min(Math.abs(a), Math.abs(a - 1)) / 0.11, 2));
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const SWITCH_TO = {
  default: 0.5,
  working: 0.45,
  sleeping: 1.4,
};
const SWITCH_FROM_SLEEP = 0.8;
function rng(seed) {
  let a = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function approach(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}
const easeInOut = (p) =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
const easeSine = (p) => 0.5 - 0.5 * Math.cos(Math.PI * p);
class Wander {
  rand;
  amp;
  holdMin;
  holdMax;
  rate;
  spring;
  value = 0;
  vel = 0;
  target = 0;
  next = 0;
  constructor(rand, amp, holdMin, holdMax, rate, spring = false) {
    this.rand = rand;
    this.amp = amp;
    this.holdMin = holdMin;
    this.holdMax = holdMax;
    this.rate = rate;
    this.spring = spring;
  }
  update(t, dt) {
    if (t >= this.next) {
      this.target = (this.rand() * 2 - 1) * this.amp;
      this.next =
        t + this.holdMin + this.rand() * (this.holdMax - this.holdMin);
    }
    if (this.spring) {
      const w = this.rate * 1.6,
        z = 0.9;
      this.vel +=
        (w * w * (this.target - this.value) - 2 * z * w * this.vel) * dt;
      this.value += this.vel * dt;
    } else this.value = approach(this.value, this.target, this.rate, dt);
  }
  aim(v) {
    this.target = v;
    this.next = Infinity;
  }
  set(amp, holdMin, holdMax, rate) {
    this.amp = amp;
    this.holdMin = holdMin;
    this.holdMax = holdMax;
    this.rate = rate;
    this.next = 0;
  }
}
class Event {
  duration;
  p = -1;
  constructor(duration) {
    this.duration = duration;
  }
  fire() {
    this.p = 0;
  }
  get active() {
    return this.p >= 0;
  }
  update(dt) {
    if (this.p < 0) return;
    this.p += dt / this.duration;
    if (this.p >= 1) this.p = -1;
  }
}
const GAZE_YAW = 35 * DEG;
const GAZE_PITCH = 14 * DEG;
const GAZE_ROLL = 3.2 * DEG;
const GAZE_HOLD_MIN = 2.6;
const GAZE_HOLD_MAX = 4.4;
const REST = {
  default: {
    pitch: 0,
    roll: 0,
    y: 0,
    lookX: 0,
    lookY: 0,
  },
  working: {
    pitch: 5 * DEG,
    roll: 0,
    y: 0,
    lookX: 0,
    lookY: 0,
  },
  sleeping: {
    pitch: -16 * DEG,
    roll: 6 * DEG,
    y: 3,
    lookX: 0,
    lookY: 1,
  },
};
export class Sim {
  pose = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    x: 0,
    y: 0,
    sx: 1,
    sy: 1,
    eyeOpen: 1,
    blinkL: 0,
    blinkR: 0,
    lookX: 0,
    lookY: 0,
    breath: 0,
    laugh: 0,
    whirl: 0,
    whirlAngle: 0,
    w: [1, 0, 0],
  };
  state = "default";
  rand;
  t = 0;
  wFrom = [1, 0, 0];
  tr = 1;
  trDuration = 0.5;
  trSoft = false;
  wink = 0;
  yawW;
  pitchW;
  rollW;
  lookXW;
  lookYW;
  blink = new Event(0.17);
  blinkAt;
  blinkAgain = false;
  dart = new Event(0.12);
  dartAt;
  dartX = 0;
  dartY = 0;
  flip = new Event(flipDuration(JUMP_DEFAULTS, false));
  flipPoked = false;
  jump = {
    ...JUMP_DEFAULTS,
  };
  flipAt;
  flipSide = 1;
  nod = new Event(1.7);
  nodAt;
  hopPhase = 0;
  hopCount = 0;
  hopGain = 0;
  laughEv = new Event(0.8);
  laughAt;
  prevYaw = 0;
  jelly = 0;
  jellyV = 0;
  gazeLead = 0;
  gazeDir = [0, 0];
  gazeAt = 0;
  turnK = 1;
  breathPhase = 0;
  ptrX = 0;
  ptrY = 0;
  ptrS = 0;
  ptrTargetX = 0;
  ptrTargetY = 0;
  ptrTargetS = 0;
  baseYaw = 0;
  constructor(seed, state = "default") {
    this.rand = rng(Math.floor(seed * 1e6) + 1);
    const r = this.rand;
    this.yawW = new Wander(r, 36 * DEG, 1.1, 2.6, 3, true);
    this.pitchW = new Wander(r, 10 * DEG, 1.1, 2.6, 2.6, true);
    this.rollW = new Wander(r, 5 * DEG, 1.6, 3.2, 2, true);
    this.lookXW = new Wander(r, 3.6, 0.5, 2, 14);
    this.lookYW = new Wander(r, 2.4, 0.5, 2, 14);
    this.t = r() * 10;
    this.hopPhase = r();
    this.breathPhase = r();
    this.blinkAt = this.t + 1 + r() * 3;
    this.flipAt = this.nextFlip(this.t, 1);
    this.nodAt = this.t + 3 + r() * 4;
    this.dartAt = this.t + 1 + r() * 2;
    this.laughAt = this.t + 0.6 + r() * 1.5;
    this.setState(state, true);
  }
  setState(next, immediate = false) {
    if (next === this.state && !immediate) return;
    const from = this.state;
    this.state = next;
    const w = this.pose.w;
    if (immediate) {
      for (let i = 0; i < 3; i++) w[i] = STATES[i] === next ? 1 : 0;
      this.tr = 1;
    } else {
      this.wFrom = [w[0], w[1], w[2]];
      this.tr = 0;
      this.trDuration =
        from === "sleeping" ? SWITCH_FROM_SLEEP : SWITCH_TO[next];
      this.trSoft = next === "sleeping" || from === "sleeping";
    }
    switch (next) {
      case "default":
        this.yawW.set(36 * DEG, 1.1, 2.6, 3);
        this.pitchW.set(10 * DEG, 1.1, 2.6, 2.6);
        this.rollW.set(5 * DEG, 1.6, 3.2, 2);
        this.lookXW.set(3.6, 0.5, 2, 14);
        this.lookYW.set(2.4, 0.5, 2, 14);
        this.flipAt = this.nextFlip(this.t, 0.6);
        break;
      case "working":
        this.yawW.set(16 * DEG, 0.9, 1.8, 4);
        this.pitchW.set(3 * DEG, 1.2, 2.4, 3);
        this.rollW.set(0, 1, 2, 3);
        this.lookXW.set(2, 0.5, 1.2, 12);
        this.lookYW.set(1, 0.5, 1.2, 12);
        this.hopPhase = 0;
        this.hopCount = 0;
        this.laughAt = this.t + 0.5 + this.rand() * 1.2;
        break;
      case "sleeping":
        this.yawW.set(7 * DEG, 3, 6, 0.7);
        this.pitchW.set(3 * DEG, 3, 6, 0.7);
        this.rollW.set(2 * DEG, 3, 6, 0.6);
        this.lookXW.set(0, 2, 4, 2);
        this.lookYW.set(0, 2, 4, 2);
        this.nodAt = this.t + 2.5 + this.rand() * 4;
        break;
    }
  }
  setPointer(x, y, strength) {
    this.ptrTargetX = Math.max(-1.2, Math.min(1.2, x));
    this.ptrTargetY = Math.max(-1.2, Math.min(1.2, y));
    this.ptrTargetS = Math.max(0, Math.min(1, strength));
  }
  poke() {
    if (this.flip.active && this.flip.p < 0.6) return;
    this.flipPoked = true;
    this.flip.duration = flipDuration(this.jump, true);
    this.flipSide = this.rand() < 0.5 ? -1 : 1;
    this.flip.fire();
    this.flipAt = this.nextFlip(this.t, 1.1);
  }
  setTurn(k) {
    const next = Math.max(0, k);
    if (next === this.turnK) return;
    this.turnK = next;
    if (this.state === "default") this.gazeAt = 0;
  }
  setJump(j) {
    const every = this.jump.every;
    Object.assign(this.jump, j);
    if (j.every !== undefined && j.every !== every)
      this.flipAt = this.nextFlip(this.t, 1);
  }
  nextGaze() {
    const r = this.rand;
    const [px, py] = this.gazeDir;
    if (px !== 0 || py !== 0) {
      const p = r();
      if (p < 0.66) return [-px, -py];
      if (p < 0.85) return [-px, py];
      return [0, 0];
    }
    const corners = [
      [1, -1],
      [-1, 1],
      [-1, -1],
      [1, 1],
    ];
    return corners[Math.floor(r() * corners.length)];
  }
  nextFlip(t, k) {
    const every = this.jump.every;
    return every > 0 ? t + every * k * (0.625 + this.rand() * 0.75) : Infinity;
  }
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const t = this.t;
    const p = this.pose;
    const w = p.w;
    if (this.tr < 1) {
      this.tr = Math.min(1, this.tr + dt / this.trDuration);
      const e = this.trSoft ? easeSine(this.tr) : easeInOut(this.tr);
      for (let i = 0; i < 3; i++) {
        const target = STATES[i] === this.state ? 1 : 0;
        w[i] = this.wFrom[i] + (target - this.wFrom[i]) * e;
      }
    }
    const [wd, ww, ws] = w;
    const rest = {
      pitch: 0,
      roll: 0,
      y: 0,
      lookX: 0,
      lookY: 0,
    };
    for (let i = 0; i < 3; i++) {
      const r = REST[STATES[i]];
      rest.pitch += r.pitch * w[i];
      rest.roll += r.roll * w[i];
      rest.y += r.y * w[i];
      rest.lookX += r.lookX * w[i];
      rest.lookY += r.lookY * w[i];
    }
    this.yawW.update(t, dt);
    this.pitchW.update(t, dt);
    this.rollW.update(t, dt);
    this.lookXW.update(t, dt);
    this.lookYW.update(t, dt);
    this.ptrS = approach(this.ptrS, this.ptrTargetS, 8, dt);
    this.ptrX = approach(this.ptrX, this.ptrTargetX, 14, dt);
    this.ptrY = approach(this.ptrY, this.ptrTargetY, 14, dt);
    const ps = this.ptrS;
    const quiet = 1 - 0.75 * ps;
    this.baseYaw = approach(
      this.baseYaw,
      this.yawW.value * quiet + 22 * DEG * this.ptrX * ps,
      5,
      dt,
    );
    const basePitch =
      rest.pitch + this.pitchW.value * quiet - 12 * DEG * this.ptrY * ps;
    const baseRoll = rest.roll + this.rollW.value * quiet;
    const baseY = rest.y;
    const baseLookX =
      rest.lookX + this.lookXW.value * quiet + 4.5 * this.ptrX * ps;
    const baseLookY =
      rest.lookY + this.lookYW.value * quiet + 3 * this.ptrY * ps;
    let spin = 0,
      hopY = 0,
      sx = 1,
      sy = 1,
      pitchAdd = 0,
      rollAdd = 0,
      blinkClose = 0,
      lookXAdd = 0,
      lookYAdd = 0,
      laugh = 0;
    let whirl = 0,
      whirlAngle = 0;
    const smooth = (a, b, v) => {
      const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
      return x * x * (3 - 2 * x);
    };
    const envelope = (q) => smooth(0.1, 0.26, q) * (1 - smooth(0.66, 0.9, q));
    const ringAngle = (q) => TAU * (1.5 * q + 0.9 * easeInOut(q));
    if (t >= this.blinkAt && !this.blink.active && wd + ww > 0.5) {
      this.blink.fire();
      this.blinkAgain = !this.blinkAgain && this.rand() < 0.22;
      this.wink =
        !this.blinkAgain && this.state === "default" && this.rand() < 0.14
          ? this.rand() < 0.5
            ? -1
            : 1
          : 0;
      this.blink.duration = this.wink !== 0 ? 0.34 : 0.17;
      this.blinkAt = t + (this.blinkAgain ? 0.28 : 2.2 + this.rand() * 2.6);
    }
    this.blink.update(dt);
    if (this.blink.active) blinkClose = Math.sin(Math.PI * this.blink.p);
    if (t >= this.dartAt && !this.dart.active && wd + ww > 0.5) {
      this.dart.fire();
      this.dartX = (this.rand() * 2 - 1) * 4;
      this.dartY = (this.rand() * 2 - 1) * 2;
      this.dart.duration = 0.25 + this.rand() * 0.45;
      this.dartAt = t + 1.2 + this.rand() * 2.6;
    }
    this.dart.update(dt);
    if (this.dart.active) {
      const q = this.dart.p;
      const hold = q < 0.15 ? q / 0.15 : q > 0.8 ? (1 - q) / 0.2 : 1;
      lookXAdd += this.dartX * hold * (wd + ww);
      lookYAdd += this.dartY * hold * (wd + ww);
    }
    if (this.state === "default" && t >= this.flipAt && !this.flip.active) {
      this.flipPoked = false;
      this.flip.duration = flipDuration(this.jump, false);
      this.flipSide = this.rand() < 0.5 ? -1 : 1;
      this.flip.fire();
      this.flipAt = this.nextFlip(t, 1);
    }
    this.flip.update(dt);
    if (this.flip.active) {
      const J = this.jump;
      const preS = flipPre(J, this.flipPoked);
      const a = (this.flip.p * this.flip.duration - preS) / J.time;
      const q = Math.min(1, Math.max(0, a));
      const arc = Math.sin(Math.PI * q);
      spin += TAU * J.spin * easeInOut(q);
      hopY -= J.height * arc;
      const tl = (a - 1) * J.time - J.land;
      const squashTime = this.flipPoked ? J.clickSquashTime : J.squashTime;
      const crouch = (u) =>
        this.flipPoked ? u * u * (3 - 2 * u) : hopSquash(u - 1);
      const land =
        (a < 0
          ? crouch(Math.max(0, 1 + (a * J.time) / preS))
          : tl > 0
            ? squashPulse(tl / squashTime, J.squashEase)
            : a < 0.2
              ? hopSquash(a)
              : 0) * J.squash;
      sx += 0.16 * land - 0.06 * arc * J.stretch;
      sy += -0.18 * land + 0.09 * arc * J.stretch;
      rollAdd += this.flipSide * J.lean * DEG * arc;
      if (J.spin > 0) {
        laugh = Math.max(laugh, arc);
        whirl = Math.max(whirl, envelope(q));
        whirlAngle = ringAngle(q);
      }
    }
    if (this.state === "working") this.hopGain = ww;
    if (
      this.hopGain > 0.02 &&
      (this.state === "working" || this.hopPhase > 0)
    ) {
      this.hopPhase += dt / HOP_T;
      if (this.hopPhase >= 1) {
        if (this.state === "working") {
          this.hopPhase -= 1;
          this.hopCount += 1;
        } else if (this.hopPhase >= 1.22) {
          this.hopPhase = 0;
          this.hopGain = 0;
        }
      }
      const g = this.hopGain;
      const q = Math.min(1, this.hopPhase);
      const arc = Math.sin(Math.PI * q);
      const spinning = this.hopCount % 3 === 2;
      const h = spinning ? HOP_SPIN_H : 18;
      hopY -= h * arc * g;
      const land = hopSquash(this.hopPhase);
      sx += (0.16 * land - 0.06 * arc) * g;
      sy += (-0.18 * land + 0.09 * arc) * g;
      if (spinning) {
        spin += TAU * easeInOut(q) * g;
        laugh = Math.max(laugh, arc * g);
        if (envelope(q) * g > whirl) {
          whirl = envelope(q) * g;
          whirlAngle = ringAngle(q);
        }
      }
      rollAdd += (this.hopCount % 2 === 0 ? 1 : -1) * 6 * DEG * arc * g;
    }
    if (this.state === "working" && t >= this.laughAt && !this.laughEv.active) {
      this.laughEv.fire();
      this.laughEv.duration = 0.6 + this.rand() * 0.5;
      this.laughAt = t + 1.6 + this.rand() * 2.2;
    }
    this.laughEv.update(dt);
    if (this.laughEv.active) {
      const q = this.laughEv.p;
      laugh = Math.max(
        laugh,
        q < 0.18 ? q / 0.18 : q > 0.78 ? (1 - q) / 0.22 : 1,
      );
    }
    if (this.state === "sleeping" && t >= this.nodAt && !this.nod.active) {
      this.nod.fire();
      this.nodAt = t + 4 + this.rand() * 4;
    }
    this.nod.update(dt);
    if (this.nod.active) {
      const q = this.nod.p;
      const dip =
        q < 0.72 ? easeInOut(q / 0.72) : 1 - easeInOut((q - 0.72) / 0.28);
      pitchAdd -= 13 * DEG * dip * ws;
    }
    this.breathPhase += dt / (3.6 + 1.2 * ws);
    const breath = Math.sin(this.breathPhase * TAU);
    p.breath = breath;
    sx += breath * (0.008 + 0.014 * ws);
    sy += breath * (0.012 + 0.02 * ws);
    const bob = Math.sin((t * TAU) / 3.4) * 2 * (1 - ws);
    p.yaw = this.baseYaw + spin;
    let dyaw = this.baseYaw - this.prevYaw;
    dyaw = ((((dyaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    this.prevYaw = this.baseYaw;
    const rate = dt > 0 ? Math.abs(dyaw) / dt : 0;
    const jellyTarget = Math.min(0.22, 0.055 * rate);
    const omega = 16,
      zeta = 0.45;
    this.jellyV +=
      (omega * omega * (jellyTarget - this.jelly) -
        2 * zeta * omega * this.jellyV) *
      dt;
    this.jelly += this.jellyV * dt;
    const jelly = Math.max(-0.08, Math.min(0.28, this.jelly)) * 0.6;
    sx *= 1 + jelly;
    sy *= 1 - 0.55 * jelly;
    p.pitch = basePitch + pitchAdd;
    p.roll = baseRoll + rollAdd;
    p.x = 0;
    p.y = baseY + hopY + bob;
    p.sx = sx;
    p.sy = sy;
    p.eyeOpen = 1;
    p.laugh = approach(p.laugh, laugh, 30, dt);
    p.blinkL = this.wink === 1 ? 0 : blinkClose;
    p.blinkR = this.wink === -1 ? 0 : blinkClose;
    p.lookX = baseLookX + lookXAdd;
    p.lookY = baseLookY + lookYAdd;
    p.whirl = whirl;
    p.whirlAngle = whirlAngle;
  }
}
export function restPose(state) {
  const r = REST[state];
  return {
    yaw: 0,
    pitch: r.pitch,
    roll: r.roll,
    x: 0,
    y: r.y,
    sx: 1,
    sy: 1,
    eyeOpen: 1,
    blinkL: 0,
    blinkR: 0,
    lookX: r.lookX,
    lookY: r.lookY,
    breath: 0,
    laugh: 0,
    whirl: 0,
    whirlAngle: 0,
    w: STATES.map((s) => (s === state ? 1 : 0)),
  };
}
