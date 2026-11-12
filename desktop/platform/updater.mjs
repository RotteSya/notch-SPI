import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import updaterPackage from "electron-updater";
import yaml from "js-yaml";
import { validUpdateConfig, updateController } from "../core/update-state.mjs";

export function createUpdater(changed) {
  let updater = null;
  const configPath = path.join(process.resourcesPath, "app-update.yml");
  if (process.platform === "win32" && app.isPackaged && fs.existsSync(configPath)) {
    try {
      if (validUpdateConfig(yaml.load(fs.readFileSync(configPath, "utf8")))) updater = updaterPackage.autoUpdater;
    } catch { /* Invalid/missing release configuration stays unavailable. */ }
  }
  return updateController(updater, changed);
}
