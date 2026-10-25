import { SharedPersonaEngine } from "../generated/persona-session.mjs";
import { product } from "./product.mjs";
import { SharedAutoEngine, autoClamp } from "../generated/auto-session.mjs";
export class AutoSession {
  engine = new SharedAutoEngine();
  constructor(onEvent=()=>{}) {this.onEvent=onEvent;}
  reportStop(wasActive) {
    if(!wasActive||this.active)return;
    const codes={userToggled:'user_toggled',captureHotkey:'capture_hotkey',stopButton:'stop_button',questionCap:'question_cap',quotaExhausted:'quota_exhausted',runFailed:'run_failed',idleTimeout:'idle_timeout',hashFailures:'hash_failures'};
    this.onEvent('auto_session_ended',{trigger:'auto',error_code:codes[this.engine.lastStopReason]});
  }
  get active() { return this.engine.state !== "inactive"; }
  get count() { return this.engine.count; }
  get cap() { return this.engine.config.maxQuestions; }
  start(cap, now = Date.now()) {
    if(this.active)this.stop();
    this.engine.start({ maxQuestions: autoClamp(cap ?? 0,
      product.defaultAutoCap, Math.max(...product.autoCaps)) });
    this.onEvent("auto_session_started",{trigger:"auto"});
  }
  stop(reason="userToggled") {const wasActive=this.active;this.engine.stop(reason);this.reportStop(wasActive);}
  succeeded(balance, rejected = false, now = Date.now()) {
    const wasActive=this.active;
    const result = this.engine.succeeded(balance ?? null, rejected, now / 1000);
    this.reportStop(wasActive);
    return result === "none" ? "watch" : "stop";
  }
  paused(now=Date.now()) {const wasActive=this.active;const result=this.engine.paused(now/1000);this.reportStop(wasActive);return result;}
  tick(hash, now = Date.now()) {const wasActive=this.active;const result=this.engine.tick(hash??null,now/1000);this.reportStop(wasActive);return result==="trigger";}
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
  complete(raw, { token = this.currentToken, currentScope = token?.scope ?? null, transportOK = true, now = Date.now() } = {}) {
    return this.engine.complete(raw, token, currentScope, transportOK, now / 1000);
  }
  finish(payload, now = Date.now(), token = this.currentToken) {
    return payload ? this.engine.record(payload, token, now / 1000) : this.engine.unavailable(token, now / 1000);
  }
}
