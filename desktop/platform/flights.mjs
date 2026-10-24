import {
  BrowserWindow,
  screen,
  ipcMain,
  powerMonitor,
  systemPreferences,
} from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { FlightQueue } from "../core/flights.mjs";
export function createFlights({ root, host, changed, protection, exclusion,
  reducedMotion = () => systemPreferences.getAnimationSettings().prefersReducedMotion }) {
  const overlays = new Map();
  let suspended = 0;
  let targets = [],
    lastSignature = "",
    payloadRevision = 0;
  const queue = new FlightQueue({
    changed: () => {
      lastSignature = "";
      changed();
    },
  });
  const ready = () =>
    overlays.size > 0 && [...overlays.values()].every((x) => x.ready);
  const ensure = () => {
    for (const d of screen.getAllDisplays())
      if (!overlays.has(d.id)) {
        const w = new BrowserWindow({
          ...d.bounds,
          show: false,
          enableLargerThanScreen: true,
          transparent: true,
          frame: false,
          focusable: false,
          resizable: false,
          movable: false,
          skipTaskbar: true,
          hasShadow: false,
          alwaysOnTop: true,
          title: "NotchSPI screenshot flight",
          webPreferences: {
            preload: path.join(root, "platform/flight-preload.cjs"),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        });
        const entry = { w, display: d, ready: false, images: new Set() };
        overlays.set(d.id, entry);
        w.setIgnoreMouseEvents(true);
        w.setAlwaysOnTop(true, "screen-saver");
        if (!exclusion?.enabled) {
          w.setContentProtection(protection);
          w.on("show", () => w.setContentProtection(protection));
        }
        w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        w.setBounds(d.bounds);
        exclusion?.register(w);
        w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        w.webContents.on("will-navigate", (e) => e.preventDefault());
        w.on("closed", () => {
          overlays.delete(d.id);
          queue.clear();
        });
        w.loadFile(path.join(root, "ui/flight.html"));
      }
  };
  const send = () => {
    if (suspended) {
      for (const { w } of overlays.values()) if (!w.isDestroyed()) w.hide();
      return;
    }
    queue.targets(targets, ready());
    queue.tick();
    const frames = queue.frames,
      signature = JSON.stringify(frames.map(({ image, ...f }) => f));
    if (signature === lastSignature) return;
    lastSignature = signature;
    payloadRevision++;
    for (const entry of overlays.values()) {
      const { w, ready: loaded } = entry;
      if (loaded && !w.isDestroyed()) {
        const payload = frames.map(({ image, ...frame }) =>
          entry.images.has(frame.id) ? frame : { ...frame, image },
        );
        entry.images = new Set(frames.map((f) => f.id));
        w.webContents.send("flight-frame", {
          revision: payloadRevision,
          origin: w.getBounds(),
          flights: payload,
        });
        if (frames.length && !w.isVisible()) w.showInactive();
        else if (!frames.length && w.isVisible()) w.hide();
      }
    }
  };
  ipcMain.on("flight-ready", (e) => {
    const entry = [...overlays.values()].find(
      (x) => x.w.webContents === e.sender,
    );
    if (entry) {
      entry.ready = true;
      lastSignature = "";
      send();
    }
  });
  const timer = setInterval(send, 16);
  const reset = () => {
    queue.clear();
    targets = [];
    for (const { w } of [...overlays.values()]) w.close();
    overlays.clear();
  };
  const metrics = (_event, _display, keys) => {
    if (keys.some((k) => ["bounds", "scaleFactor", "rotation"].includes(k)))
      reset();
  };
  screen.on("display-added", reset);
  screen.on("display-removed", reset);
  screen.on("display-metrics-changed", metrics);
  powerMonitor.on("suspend", reset);
  return {
    suspend() {
      suspended++; send();
      let resumed = false;
      return () => {
        if (resumed) return;
        resumed = true; suspended--; lastSignature = ""; send();
      };
    },
    get ids() {
      return queue.ids;
    },
    get diagnostics() {
      return {
        displays: screen
          .getAllDisplays()
          .map((d) => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor })),
        ready: ready(),
        active: queue.ids,
        frames: queue.frames.map(({ image, ...f }) => f),
        overlays: [...overlays.values()].map((x) => ({
          ready: x.ready,
          visible: x.w.isVisible(),
          bounds: x.w.getBounds(),
          ignoresMouse: x.w.isFocusable() === false,
        })),
      };
    },
    async evidence(directory, label) {
      await fs.mkdir(directory, { recursive: true });
      const result = [];
      for (const [id, { w, ready: loaded }] of overlays)
        if (loaded) {
          const image = await w.webContents.capturePage(undefined, {
              stayHidden: true,
              stayAwake: true,
            }),
            bitmap = image.toBitmap();
          let ink = 0;
          for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i] > 20) ink++;
          await fs.writeFile(
            path.join(directory, `${label}-${id}.png`),
            image.toPNG(),
          );
          result.push({ id, ink, visible: !w.isDestroyed() && w.isVisible() });
        }
      return result;
    },
    add(image) {
      ensure();
      queue.add(
        image,
        reducedMotion(),
      );
      send();
    },
    targets(sender, rows) {
      if (
        sender !== host().webContents ||
        !Array.isArray(rows) ||
        rows.length > 4
      )
        return;
      const origin = host().getBounds();
      targets = rows
        .filter(
          (r) =>
            typeof r.id === "string" &&
            ["x", "y", "width", "height"].every((k) => Number.isFinite(r[k])) &&
            r.width > 0 &&
            r.height > 0 &&
            r.width < 1000 &&
            r.height < 1000,
        )
        .map((r) => ({ ...r, x: r.x + origin.x, y: r.y + origin.y }));
      send();
    },
    retain(ids) {
      queue.retain(ids);
      send();
    },
    clear() {
      queue.clear();
      send();
    },
    dispose() {
      clearInterval(timer);
      reset();
      screen.off("display-added", reset);
      screen.off("display-removed", reset);
      screen.off("display-metrics-changed", metrics);
      powerMonitor.off("suspend", reset);
      ipcMain.removeAllListeners("flight-ready");
    },
  };
}
