// Where Jarvis keeps his data. Locally that's ./data; on Render it's the persistent disk (DATA_DIR=/var/data).
import fs from "node:fs";
import path from "node:path";

export function dataDir(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
