import {
  desktopCapturer,
  screen,
  nativeImage,
  systemPreferences,
} from "electron";
import { randomUUID } from "node:crypto";
import { windowBounds } from "./window-bounds.mjs";
export async function listTargets() {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  return sources
    .filter((s) => !s.name.startsWith("NotchSPI"))
    .map((s) => ({ id: s.id, name: s.name, displayId: s.display_id }));
}
export async function capture(target = "screen") {
  if (
    process.platform === "darwin" &&
    systemPreferences.getMediaAccessStatus("screen") !== "granted"
  )
    throw new Error(
      "Screen recording permission is required in System Settings",
    );
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const max = screen.getAllDisplays().reduce(
    (s, d) => ({
      width: Math.max(s.width, Math.ceil(d.size.width * d.scaleFactor)),
      height: Math.max(s.height, Math.ceil(d.size.height * d.scaleFactor)),
    }),
    { width: 1, height: 1 },
  );
  const sources = await desktopCapturer.getSources({
    types: target === "screen" ? ["screen"] : ["screen", "window"],
    thumbnailSize: max,
    fetchWindowIcons: false,
  });
  const source =
    target === "screen"
      ? sources.find((s) => s.display_id === String(display.id))
      : sources.find((s) => s.id === target);
  if (!source || source.thumbnail.isEmpty())
    throw new Error("Capture target is unavailable; select the window again");
  const size = source.thumbnail.getSize();
  if (size.width * size.height > 16000000)
    throw new Error(
      "Capture exceeds 16 million pixels; choose a smaller window",
    );
  const jpeg = source.thumbnail.toJPEG(85);
  if (jpeg.length > 3 * 1024 * 1024)
    throw new Error("Screenshot is too large; choose a smaller window");
  const hashImage = source.thumbnail
    .resize({ width: 32, height: 20 })
    .toBitmap();
  const luma = Array.from({ length: 640 }, (_, i) =>
    Math.round(
      0.114 * hashImage[i * 4] +
        0.587 * hashImage[i * 4 + 1] +
        0.299 * hashImage[i * 4 + 2],
    ),
  );
  return {
    id: randomUUID(),
    sourceBounds:
      target === "screen" ? display.bounds : await windowBounds(source.id),
    base64: jpeg.toString("base64"),
    thumbnail: source.thumbnail.resize({ width: 480 }).toDataURL(),
    width: size.width,
    height: size.height,
    luma,
  };
}
export function fromFile(bytes) {
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error("Image file is too large");
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error("Unsupported image");
  const size = image.getSize();
  if (size.width * size.height > 16000000)
    throw new Error("Image exceeds 16 million pixels");
  const jpeg = image.toJPEG(85);
  if (jpeg.length > 3 * 1024 * 1024)
    throw new Error("Image exceeds the request limit");
  return {
    id: randomUUID(),
    base64: jpeg.toString("base64"),
    thumbnail: image.resize({ width: 480 }).toDataURL(),
    width: size.width,
    height: size.height,
  };
}
