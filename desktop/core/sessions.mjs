import { SharedPersonaEngine } from "../generated/persona-session.mjs";
import { product } from "./product.mjs";
import { SharedAutoEngine, autoClamp } from "../generated/auto-session.mjs";
export class AutoSession {
  engine = new SharedAutoEngine();
  get active() { return this.engine.state !== "inactive"; }
  get count() { return this.engine.count; }
  get cap() { return this.engine.config.maxQuestions; }
  start(cap, now = Date.now()) {
    this.engine.start({ maxQuestions: autoClamp(cap ?? 0,
      product.defaultAutoCap, Math.max(...product.autoCaps)) });
  }
  stop() { this.engine.stop("userToggled"); }
  succeeded(balance, rejected = false, now = Date.now()) {
    const result = this.engine.succeeded(balance ?? null, rejected, now / 1000);
    return result === "none" ? "watch" : "stop";
  }
  tick(hash, now = Date.now()) { return this.engine.tick(hash ?? null, now / 1000) === "trigger"; }
}
export class PersonaSession {
  engine = new SharedPersonaEngine(product.personalitySession);
  currentToken = null;
  get records() { return this.engine.records; }
  reset() { this.engine.reset("manual"); this.currentToken = null; }
  begin(scope, now = Date.now()) {
    this.currentToken = this.engine.begin(scope, now / 1000);
    return this.currentToken.contextBlock;
  }
  contextBlock() { return this.engine.contextBlock(); }
  finish(payload, now = Date.now(), token = this.currentToken) {
    return payload ? this.engine.record(payload, token, now / 1000) : this.engine.unavailable(token, now / 1000);
  }
}
