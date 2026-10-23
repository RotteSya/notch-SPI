import { Sim, restPose } from "./ghost-engine.mjs";
import { draw, OVERSCAN, RISE } from "./vendor/bot-avatars/draw.mjs";
import { SHAPE_PATHS } from "./vendor/bot-avatars/shapes.mjs";
import {
  ghostStyle,
  notchPose,
  completionWeight,
  thinkingDot,
} from "./ghost-motion.mjs";
export class Ghost {
  constructor(canvas) {
    this.canvas = canvas;
    this.sim = new Sim(ghostStyle.seed);
    this.busy = false;
    this.time = 0;
    this.blend = 0;
    this.completion = null;
    this.color = "#ffffff";
    this.previous = this.color;
    this.motion = matchMedia("(prefers-reduced-motion:reduce)");
    this.visibility = () => {
      this.last = null;
      this.schedule();
    };
    this.preference = () => {
      if (this.motion.matches) this.completion = null;
      this.visibility();
    };
    this.motion.addEventListener("change", this.preference);
    document.addEventListener("visibilitychange", this.visibility);
    this.path = new Path2D(SHAPE_PATHS.ghost);
    this.schedule();
  }
  set({ busy = false, color = "#ffffff", completed = false, hero = false }) {
    if (busy !== this.busy) {
      this.busy = busy;
      this.sim.setState(busy ? "working" : "default");
    }
    if (busy) this.completion = null;
    if (completed && !busy && !this.motion.matches) {
      this.completion = 0;
      this.previous = this.color;
    }
    this.color = color;
    this.hero = hero;
    this.paint();
    this.schedule();
  }
  schedule() {
    cancelAnimationFrame(this.frame);
    if (document.hidden || !this.canvas.isConnected) return;
    this.paint();
    if (this.motion.matches) return;
    const tick = (now) => {
      const interval =
        this.busy || this.completion != null ? 1000 / 60 : 1000 / 24;
      if (this.last == null || now - this.last >= interval - 1) {
        const dt =
          this.last == null ? 0 : Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.sim.update(dt);
        this.time += dt;
        this.blend +=
          ((this.busy ? 1 : 0) - this.blend) * (1 - Math.exp(-dt / 0.14));
        if (this.completion != null) {
          this.completion += dt;
          if (this.completion >= ghostStyle.completionDuration)
            this.completion = null;
        }
        this.paint();
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  paint() {
    const side = this.canvas.clientWidth || ghostStyle.size,
      dpr = devicePixelRatio || 1,
      reduced = this.motion.matches;
    const px = Math.ceil(side * dpr);
    if (this.canvas.width !== px) this.canvas.width = this.canvas.height = px;
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, side, side);
    const pose = notchPose(
      reduced ? restPose(this.busy ? "working" : "default") : this.sim.pose,
      {
        reduced,
        busy: this.busy,
        hero: this.hero,
        time: this.time,
        blend: this.blend,
        completion: this.completion,
      },
    );
    let color = this.color;
    if (this.completion != null) {
      const p = Math.min(1, this.completion / 0.4),
        t = p * p * (3 - 2 * p);
      const rgb = (hex) =>
        [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      color =
        "#" +
        rgb(this.previous)
          .map((v, i) =>
            Math.round(v + (rgb(color)[i] - v) * t)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
    }
    const box = side * ghostStyle.bodyScale;
    ctx.save();
    ctx.translate(
      (side - box * OVERSCAN) / 2,
      (side - box * OVERSCAN) / 2 - RISE * box,
    );
    draw(ctx, box, pose, {
      path: this.path,
      face: "eyes",
      faceX: 50,
      faceY: 48,
      faceScale: 0.95,
      color,
      ink: ghostStyle.ink,
      shading: "smooth",
      shadow: ghostStyle.shadow,
      highlight: ghostStyle.highlight,
      depth: ghostStyle.depth,
      theme: "dark",
      still: reduced,
      scale: dpr,
    });
    ctx.restore();
    ctx.save();
    ctx.translate(side / 2, side / 2 + (pose.y * box) / 100);
    ctx.rotate(pose.roll);
    const completed = completionWeight(this.completion, reduced),
      thinking = reduced ? (this.busy ? 1 : 0) : this.blend;
    ctx.fillStyle = ctx.strokeStyle = ghostStyle.ink;
    for (let i = 0; i < 3; i++) {
      const dot = thinkingDot(i, this.time, reduced, thinking, completed);
      ctx.globalAlpha = dot.opacity;
      ctx.beginPath();
      ctx.arc(
        (i - 1) * side * 0.105,
        side * 0.17,
        side * dot.radius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = completed * 0.9;
    ctx.lineWidth = side * 0.04;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-side * 0.075, side * 0.2);
    ctx.lineTo(-side * 0.015, side * 0.245);
    ctx.lineTo(side * 0.085, side * 0.155);
    ctx.stroke();
    ctx.restore();
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.motion.removeEventListener("change", this.preference);
    document.removeEventListener("visibilitychange", this.visibility);
  }
}
