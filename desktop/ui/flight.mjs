import { flightSample, flightStyle } from "../generated/ui/flight.mjs";
let batch = { flights: [], origin: { x: 0, y: 0 } },
  frame;
const cards = new Map();
window.flight.frames((value) => {
  batch = value;
  const ids = new Set(value.flights.map((f) => f.id));
  for (const [id, card] of cards)
    if (!ids.has(id)) {
      card.remove();
      cards.delete(id);
    }
  for (const f of value.flights)
    if (!cards.has(f.id)) {
      const card = document.createElement("div");
      card.className = "photo";
      const img = document.createElement("img");
      img.src = f.image;
      card.append(img);
      document.body.append(card);
      cards.set(f.id, card);
    }
  cancelAnimationFrame(frame);
  paint();
});
function paint() {
  const now = Date.now();
  let active = false;
  for (const f of batch.flights) {
    const card = cards.get(f.id),
      t = Math.min(
        1,
        Math.max(
          0,
          (now - f.start) /
            ((f.reduced ? flightStyle.reducedDuration : flightStyle.duration) *
              1000),
        ),
      );
    const v = flightSample(
        f.source || f.destination,
        f.destination,
        t,
        f.reduced,
      ),
      r = v.frame;
    Object.assign(card.style, {
      left: r.x - batch.origin.x + "px",
      top: r.y - batch.origin.y + "px",
      width: r.width + "px",
      height: r.height + "px",
      transform: `rotate(${v.angle}rad)`,
      opacity: String(v.opacity),
      borderRadius: v.radius + "px",
      background: `rgba(36,36,36,${f.reduced ? 1 : t})`,
      border: `${v.border}px solid rgba(255,255,255,.14)`,
      boxShadow: `0 ${v.shadowY}px ${v.shadowRadius}px rgba(0,0,0,${v.shadowOpacity})`,
    });
    Object.assign(card.firstElementChild.style, {
      left: v.inset + "px",
      top: v.inset + "px",
      width: Math.max(0, r.width - 2 * v.inset) + "px",
      height: Math.max(0, r.height - 2 * v.inset) + "px",
      borderRadius: Math.max(0, v.radius - v.inset) + "px",
    });
    active ||= t < 1;
  }
  if (active) frame = requestAnimationFrame(paint);
}
window.flight.ready();
