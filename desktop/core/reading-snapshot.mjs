// Explicitly opened reading owns its images independently of the active capture.
export class ReadingSnapshot {
  constructor(content) { this.content = structuredClone(content); this.current = true; }
  update(next) {
    if (!this.current || next?.id !== this.content.id) { this.current = false; return; }
    const { images, ...text } = next;
    Object.assign(this.content, structuredClone(text));
  }
  get value() { return { ...this.content, canExplain: this.current && this.content.canExplain, current: this.current }; }
  get copyAll() { return [this.content.answer, this.content.detail].filter(Boolean).join('\n\n'); }
}
