// Invoked only by the unpackaged --capture-smoke on a Windows graphics session.
// Fixture windows contain no account data. Exercise the production capture adapter.
import { BrowserWindow, screen, nativeImage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

async function nativeProtection(win) {
  const handle = win.getNativeWindowHandle();
  const id = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CaptureState {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint affinity);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("dwmapi.dll")] public static extern int DwmIsCompositionEnabled(out bool enabled);
}

async function diagnoseProtection() {
  const rows = [];
  for (const mode of ["opaque", "transparent", "passthrough", "opacity"]) {
    const w = new BrowserWindow({ width: 100, height: 100, show: false, frame: false,
      transparent: mode !== "opaque", webPreferences: { sandbox: true } });
    try {
      await w.loadURL("data:text/html,<body>Capture diagnostic</body>");
      if (mode === "passthrough" || mode === "opacity") w.setIgnoreMouseEvents(true);
      if (mode === "opacity") w.setOpacity(1);
      w.showInactive();
      w.setContentProtection(true);
      await wait(120);
      rows.push({ mode, ...await nativeProtection(w) });
    } finally { w.destroy(); }
  }
  console.log("Capture protection comparison:", JSON.stringify(rows));
}
'@
[uint32]$affinity = 0
$ok = [CaptureState]::GetWindowDisplayAffinity([IntPtr]${id}, [ref]$affinity)
$errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
$composition = $false
$hr = [CaptureState]::DwmIsCompositionEnabled([ref]$composition)
@{ ok=$ok; affinity=$affinity; errorCode=$errorCode; remote=[CaptureState]::GetSystemMetrics(4096); composition=$composition; hresult=$hr } | ConvertTo-Json -Compress
`;
  const { stdout } = await promisify(execFile)("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
  ], { windowsHide: true, timeout: 10000, maxBuffer: 8192 });
  return JSON.parse(stdout.trim());
}

const background = [18, 84, 160], ordinary = [30, 210, 180];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function prepareCapturePixels({ win, exclusion, takePixels, directory }) {
  const display = screen.getDisplayMatching(win.getBounds()), bounds = display.bounds;
  const fixtures = [];
  async function fixture(rect, color) {
    const w = new BrowserWindow({
      ...rect, show: false, frame: false, hasShadow: false, resizable: false,
      enableLargerThanScreen: true, skipTaskbar: true,
      backgroundColor: `rgb(${color.join(",")})`,
      title: "NotchSPI capture test fixture",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    fixtures.push(w);
    await w.loadURL("data:text/html," + encodeURIComponent(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><body style="margin:0;background:rgb(${color.join(",")})"></body>`,
    ));
    w.setBounds(rect);
    w.showInactive();
    return w;
  }
  await fixture(bounds, background);
  const ordinaryRect = {
    x: display.workArea.x + display.workArea.width - 140,
    y: display.workArea.y + display.workArea.height - 140,
    width: 100, height: 100,
  };
  await fixture(ordinaryRect, ordinary);
  win.showInactive();
  const notch = win.getBounds();
  const notchPoint = { x: notch.x + notch.width / 2, y: notch.y + 20 };
  const ordinaryPoint = { x: ordinaryRect.x + 50, y: ordinaryRect.y + 50 };
  function pixels(shot) {
    assert.deepEqual(shot.sourceBounds, bounds, "Cursor moved to a different display");
    const image = nativeImage.createFromBuffer(Buffer.from(shot.base64, "base64"));
    const bitmap = image.toBitmap(), size = image.getSize();
    return {
      image,
      at(point) {
        const x = Math.floor((point.x - bounds.x) * size.width / bounds.width);
        const y = Math.floor((point.y - bounds.y) * size.height / bounds.height);
        const index = (y * size.width + x) * 4;
        return [bitmap[index + 2], bitmap[index + 1], bitmap[index]];
      },
    };
  }
  const near = (actual, expected) => actual.every((channel, i) => Math.abs(channel - expected[i]) < 22);
  // Positive control: prove this backend sees the real overlay when unprotected.
  // This catches locked/headless desktops and tests which accidentally capture a
  // blank source. Only these synthetic QA windows can have protection disabled.
  win.setContentProtection(false);
  let control;
  try {
    await wait(180);
    control = pixels(await takePixels());
    assert.ok(!near(control.at(notchPoint), background), "Positive control did not see the notch");
    assert.ok(near(control.at(ordinaryPoint), ordinary), "Ordinary window or desktop is not capturable");
  } finally {
    exclusion.refresh(win);
  }
  await fs.writeFile(path.join(directory, "capture-control.png"), control.image.toPNG());
  const protection = await nativeProtection(win);
  console.log("Native capture protection:", JSON.stringify(protection));
  await fs.writeFile(path.join(directory, "capture-protection.json"), JSON.stringify(protection, null, 2));
  let checked = 0;
  const result = {
    async check(label, captureWithOverlays) {
      assert.ok(win.isVisible(), "Notch must remain visible before capture");
      const sample = pixels(await captureWithOverlays(takePixels));
      await fs.writeFile(path.join(directory, `capture-${label}.png`), sample.image.toPNG());
      assert.ok(win.isVisible(), "Notch must remain visible after capture");
      if (!near(sample.at(notchPoint), background)) await diagnoseProtection();
      assert.ok(near(sample.at(notchPoint), background),
        `Notch is present in captured pixels or replaced by a black rectangle: ${JSON.stringify({ label, actual: sample.at(notchPoint), expected: background, protected: win.isContentProtected(), notchPoint, bounds: win.getBounds(), electron: process.versions.electron })}`);
      assert.ok(near(sample.at(ordinaryPoint), ordinary), "Ordinary settings-like window was excluded");
      // Any rendered screenshot card over this fixture would contaminate the
      // uniform background. Probe the entire overlay/flight travel region.
      const area = display.workArea;
      for (let y = area.y + 30; y < area.y + area.height - 160; y += 31)
        for (let x = area.x + 20; x < area.x + area.width - 20; x += 31)
          assert.ok(near(sample.at({ x, y }), background), `Overlay visible in capture at ${x},${y}`);
      checked++;
    },
    async finish() {
      await fs.writeFile(path.join(directory, "capture-pixels.json"), JSON.stringify({
        host: process.platform, positiveControl: true, protectedFrames: checked,
        notchStayedVisible: true, ordinaryWindowCaptured: true, fixture: true,
      }, null, 2));
      for (const w of fixtures) w.close();
    },
  };
  await result.check("baseline", fn => exclusion.capture(fn));
  return result;
}
