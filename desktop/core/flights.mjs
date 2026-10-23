import { fit, flightStyle } from "../generated/ui/flight.mjs";
// Geometry-only lifecycle; adapters own windows and clocks. No capture/request ownership.
export class FlightQueue {
  constructor({ now = Date.now, changed = () => {} } = {}) {
    this.now = now;
    this.changed = changed;
    this.items = new Map();
  }
  add(image, reduced = false) {
    this.items.set(image.id, {
      id: image.id,
      image: "data:image/jpeg;base64," + image.base64,
      size: { width: image.width, height: image.height },
      source: image.sourceBounds ? fit(image, image.sourceBounds) : null,
      queued: this.now(),
      start: null,
      reduced: reduced || !image.sourceBounds,
      destination: null,
    });
    this.changed();
  }
  targets(targets, ready = true) {
    for (const item of this.items.values()) {
      const slot = targets.find((t) => t.id === item.id);
      if (slot) {
        item.destination = {
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
        };
        if (ready && item.start == null) item.start = this.now();
      }
    }
  }
  tick() {
    let changed = false;
    for (const [id, item] of this.items) {
      const duration =
        (item.reduced ? flightStyle.reducedDuration : flightStyle.duration) *
        1000;
      if (
        (item.start != null && this.now() - item.start >= duration) ||
        this.now() - item.queued > 1500
      ) {
        this.items.delete(id);
        changed = true;
      }
    }
    if (changed) this.changed();
  }
  retain(ids) {
    const keep = new Set(ids);
    let changed = false;
    for (const id of this.items.keys())
      if (!keep.has(id)) {
        this.items.delete(id);
        changed = true;
      }
    if (changed) this.changed();
  }
  clear() {
    if (this.items.size) {
      this.items.clear();
      this.changed();
    }
  }
  get ids() {
    return [...this.items.keys()];
  }
  get frames() {
    return [...this.items.values()].filter(
      (x) => x.destination && x.start != null,
    );
  }
}
