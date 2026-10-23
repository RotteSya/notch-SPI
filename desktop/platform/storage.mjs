import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  fs.writeFileSync(temp, text, { mode: 0o600 });
  fs.renameSync(temp, file);
}
export class Vault {
  memory = new Map();
  constructor(directory, ephemeral = false) {
    this.file = path.join(directory, "credentials.enc");
    this.ephemeral = ephemeral;
  }
  read() {
    if (!fs.existsSync(this.file)) return {};
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(
        "Secure storage is locked or unavailable; existing credentials were preserved",
      );
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(this.file)));
  }
  async get(key) {
    if (this.ephemeral) return this.memory.get(key) ?? null;
    return this.read()[key] ?? null;
  }
  async set(key, value) {
    if (this.ephemeral) {
      this.memory.set(key, value);
      return;
    }
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Secure storage is unavailable");
    const data = this.read();
    if (value === null) delete data[key];
    else data[key] = value;
    atomic(this.file, safeStorage.encryptString(JSON.stringify(data)));
    if ((await this.get(key)) !== value)
      throw new Error("Credential could not be verified");
  }
}
export class LocalStore {
  constructor(directory) {
    this.directory = directory;
  }
  read(name, fallback) {
    const file = path.join(this.directory, name + ".json");
    if (!fs.existsSync(file)) return fallback;
    const stat = fs.statSync(file);
    if (stat.size > 32 * 1024 * 1024) throw new Error("Local data too large");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  write(name, value) {
    atomic(path.join(this.directory, name + ".json"), JSON.stringify(value));
  }
}
