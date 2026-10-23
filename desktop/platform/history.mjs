import fs from "node:fs";
import path from "node:path";
const uuid = /^[a-f0-9-]{36}$/i;
export class QuestionHistory {
  constructor(
    directory,
    {
      limit = 100,
      byteLimit = 200 * 1024 * 1024,
      lifetime = 30 * 86400000,
    } = {},
  ) {
    this.directory = path.join(directory, "questions");
    this.limit = limit;
    this.byteLimit = byteLimit;
    this.lifetime = lifetime;
    fs.mkdirSync(this.directory, { recursive: true });
  }
  list() {
    const file = path.join(this.directory, "index.json");
    if (!fs.existsSync(file)) return [];
    if (fs.statSync(file).size > 8 * 1024 * 1024)
      throw new Error("History index too large");
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(rows)) throw new Error("Invalid history");
    return rows
      .filter((x) => uuid.test(x.id) && Date.now() - x.time < this.lifetime)
      .slice(0, this.limit);
  }
  save(rows) {
    let bytes = 0;
    const kept = [];
    for (const row of rows) {
      if (
        !uuid.test(row.id) ||
        Date.now() - row.time >= this.lifetime ||
        kept.length >= this.limit
      )
        continue;
      const folder = path.join(this.directory, row.id);
      fs.mkdirSync(folder, { recursive: true });
      const images = row.images.map((image, i) => {
        const file = path.join(folder, `${i}.jpg`);
        if (image.base64)
          fs.writeFileSync(file, Buffer.from(image.base64, "base64"), {
            mode: 0o600,
          });
        const size = fs.statSync(file).size;
        return {
          id: image.id,
          thumbnail: image.thumbnail,
          width: image.width,
          height: image.height,
          bytes: size,
        };
      });
      bytes += images.reduce((n, x) => n + x.bytes, 0);
      if (bytes > this.byteLimit) break;
      kept.push({ ...row, images });
    }
    const file = path.join(this.directory, "index.json");
    fs.writeFileSync(file + ".tmp", JSON.stringify(kept), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    const ids = new Set(kept.map((x) => x.id));
    for (const name of fs.readdirSync(this.directory))
      if (uuid.test(name) && !ids.has(name))
        fs.rmSync(path.join(this.directory, name), {
          recursive: true,
          force: true,
        });
    return kept;
  }
  load(id) {
    if (!uuid.test(id)) return null;
    const row = this.list().find((x) => x.id === id);
    if (!row) return null;
    return {
      ...row,
      images: row.images.map((image, i) => ({
        ...image,
        base64: fs
          .readFileSync(path.join(this.directory, id, `${i}.jpg`))
          .toString("base64"),
      })),
    };
  }
}
