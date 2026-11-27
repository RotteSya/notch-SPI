import { fit, flightStyle } from "../generated/ui/flight.mjs";
// Geometry-only lifecycle; adapters own windows and clocks. No capture/request ownership.
// timeScale stretches every flight (and its queue lifetime) uniformly; only the motion smoke
// changes it, so that its captures can be taken while a flight is known to be in the air.
export class FlightQueue {
  constructor({ now = Date.now, changed = () => {}, timeScale = 1 } = {}) {
    this.now = now;
    this.changed = changed;
    this.timeScale = timeScale;
    this.items = new Map();
  }
  add(image, reduced = false) {
    const still = reduced || !image.sourceBounds;
    this.items.set(image.id, {
      id: image.id,
      image: "data:image/jpeg;base64," + image.base64,
      size: { width: image.width, height: image.height },
      source: image.sourceBounds ? fit(image, image.sourceBounds) : null,
      queued: this.now(),
      start: null,
      reduced: still,
      // Milliseconds. The renderer and the motion evidence read the same value.
      duration: (still ? flightStyle.reducedDuration : flightStyle.duration) * 1000 * this.timeScale,
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
      if (
        (item.start != null && this.now() - item.start >= item.duration) ||
        this.now() - item.queued > 1500 * this.timeScale
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
