import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import updaterPackage from "electron-updater";
import yaml from "js-yaml";
export function createUpdater(changed) {
  const state = {
    status: "unconfigured",
    version: null,
    percent: 0,
    message: "",
  };
  let updater;
  const configPath = path.join(process.resourcesPath, "app-update.yml");
  if (
    process.platform === "win32" &&
    app.isPackaged &&
    fs.existsSync(configPath)
  ) {
    let config;
    try {
      config = yaml.load(fs.readFileSync(configPath, "utf8"));
      new URL(config.url);
    } catch {
      return {
        state,
        check: async () => {
          throw new Error("Invalid update configuration");
        },
        download: async () => {},
        install: () => {},
      };
    }
    const publishers =
      typeof config.publisherName === "string"
        ? [config.publisherName]
        : config.publisherName;
    if (
      config.provider === "generic" &&
      new URL(config.url).protocol === "https:" &&
      Array.isArray(publishers) &&
      publishers.length &&
      publishers.every((x) => typeof x === "string" && x.trim())
    ) {
      updater = updaterPackage.autoUpdater;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowDowngrade = false;
      updater.logger = null;
      state.status = "idle";
      const set = (status, extra = {}) => {
        Object.assign(state, { status }, extra);
        changed();
      };
      updater.on("checking-for-update", () => set("checking"));
      updater.on("update-available", (info) =>
        set("available", { version: info.version }),
      );
      updater.on("update-not-available", () => set("current"));
      updater.on("download-progress", (progress) =>
        set("downloading", { percent: Math.floor(progress.percent) }),
      );
      updater.on("update-downloaded", () => set("downloaded"));
      updater.on("error", (error) => set("error", { message: error.message }));
    }
  }
  return {
    state,
    async check() {
      if (!updater)
        throw new Error(
          "This build has no signed Windows update source configured",
        );
      if (["checking", "downloading"].includes(state.status)) return;
      await updater.checkForUpdates();
    },
    async download() {
      if (updater && state.status === "available")
        await updater.downloadUpdate();
    },
    install() {
      if (updater && state.status === "downloaded")
        updater.quitAndInstall(false, true);
    },
  };
}
