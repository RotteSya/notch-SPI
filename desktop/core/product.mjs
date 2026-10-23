import { product, templates } from "../generated/product.mjs";
export { product };
export const languageName = {
  zh: "Simplified Chinese (简体中文)",
  ja: "Japanese (日本語)",
  en: "English",
};
export function template(key, values = {}) {
  return templates[key].replace(/\{\{(\w+)\}\}/g, (all, k) => values[k] ?? all);
}
export function capturePrompt({
  language = "zh",
  objective = false,
  mode = "tutor",
  persona = {},
  sessionContext = "",
} = {}) {
  const languageClause = `Respond in the same language as the problem shown. If the language is unclear, respond in ${languageName[language] ?? languageName.zh}.`;
  if (mode === "personality")
    return {
      system: template("personality", {
        personaData: JSON.stringify({
          description: persona.description ?? "",
          name: persona.name ?? "",
        }),
        sessionContext,
      }),
      task: "answer every visible personality-test item as the target persona, following the V1 output protocol above.",
    };
  return objective
    ? {
        system: template("objectiveBriefPrompt", {
          objectiveResultClause: templates.objectiveResultClause,
        }),
        task: templates.objectiveTask,
      }
    : {
        system: template("briefPrompt", {
          finalLineClause: templates.finalLineClause,
          languageClause,
        }),
        task: "tutor me on the problem it shows.",
      };
}
export const contextTask = templates.contextTask;
export const screenQueryClause = templates.screenQueryClause;
export const taskText = (task, count) =>
  count > 1
    ? `Analyze the ${count} attached screenshot images in order, then ${task}`
    : `Analyze the attached screenshot image, then ${task}`;
export const spring = (t) =>
  1 -
  Math.exp(-product.motion.springDecay * t) *
    Math.cos(product.motion.springFrequency * t);
export const close = (t) =>
  1 -
  (1 - t) ** 2 *
    (1 + product.motion.closeDecay * t) *
    Math.exp(-product.motion.closeDecay * t);
export const smooth = (t) => t * t * (3 - 2 * t);
export function contentOpacity(t, origin, opening) {
  const a = opening ? product.motion.openStart : 0,
    b = opening ? product.motion.openEnd : product.motion.closeEnd;
  const staged = smooth(Math.max(0, Math.min(1, (t - a) / (b - a))));
  const p = smooth(staged);
  return opening ? origin + (1 - origin) * p : origin * (1 - p);
}
export class Intake {
  items = [];
  deadline = null;
  previewing = false;
  token = null;
  paused = null;
  begin(now) {
    if (this.token || this.items.length >= product.capture.limit) return null;
    this.paused =
      this.deadline === null ? null : Math.max(0, this.deadline - now);
    this.deadline = null;
    return (this.token = crypto.randomUUID());
  }
  finish(token, item, now) {
    if (token !== this.token) return false;
    this.token = null;
    if (item != null) {
      this.items.push(item);
      this.reset(now);
    } else
      this.deadline =
        this.previewing || this.paused === null ? null : now + this.paused;
    this.paused = null;
    return true;
  }
  reset(now) {
    this.deadline =
      this.items.length >= 2 && !this.previewing
        ? now + product.capture.submitDelay * 1000
        : null;
  }
  preview(value, now) {
    if (value === this.previewing) return;
    this.previewing = value;
    this.reset(now);
  }
  remove(index, now) {
    if (this.token || index < 0 || index >= this.items.length) return null;
    const item = this.items.splice(index, 1)[0];
    this.reset(now);
    return item;
  }
  restore(item, index, now) {
    if (this.token || this.items.length >= product.capture.limit) return false;
    this.items.splice(Math.max(0, index), 0, item);
    this.reset(now);
    return true;
  }
  take(now, force = false) {
    if (
      this.previewing ||
      this.token ||
      this.items.length < 2 ||
      (!force && (this.deadline === null || now < this.deadline))
    )
      return null;
    const items = this.items;
    this.cancel();
    return items;
  }
  cancel() {
    this.items = [];
    this.deadline = null;
    this.previewing = false;
    this.token = null;
    this.paused = null;
  }
}
export const acceptsVersion = (incoming, current) => {
  if (!/^\d{1,40}$/.test(incoming ?? "")) return false;
  return !current || BigInt(incoming) >= BigInt(current);
};
