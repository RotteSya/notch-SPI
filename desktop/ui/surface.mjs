// Mirrors NotchSurfaceView / NotchDither; geometry remains owned by the notch morph.
export function surfaceTone(depth) {
  const p = Math.max(0, Math.min(1, depth));
  return { sheen: .022 + .040 * p, edge: .22 + .16 * p, shadow: p };
}
export function ditherPixels(side = 96) {
  const pixels = new Uint8ClampedArray(side * side * 4);
  let seed = 0x9E3779B97F4A7C15n;
  const u64 = x => BigInt.asUintN(64, x);
  for (let i = 0; i < pixels.length; i += 4) {
    seed = u64(seed ^ u64(seed << 13n));
    seed = u64(seed ^ (seed >> 7n));
    seed = u64(seed ^ u64(seed << 17n));
    const value = Number((seed >> 24n) & 255n);
    pixels.set([value, value, value, 255], i);
  }
  return pixels;
}
export function installSurface(node) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 96;
  tile.getContext('2d').putImageData(new ImageData(ditherPixels(), 96, 96), 0, 0);
  node.style.setProperty('--surface-dither', `url("${tile.toDataURL()}")`);
  node.innerHTML = '<svg class="surface-edge" aria-hidden="true"><defs><linearGradient id="surface-edge-light" x1="0" y1="0" x2="0" y2="1"><stop offset="40%" stop-color="white" stop-opacity="0"/><stop offset="78%" stop-color="#aabcf0" stop-opacity=".23"/><stop offset="100%" stop-color="white" stop-opacity="var(--surface-edge-alpha,.38)"/></linearGradient></defs><path fill="none" stroke="url(#surface-edge-light)" stroke-width="1.5"/></svg>';
}
