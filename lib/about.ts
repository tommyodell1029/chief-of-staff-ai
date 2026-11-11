// Tommy's "About Tommy" profile. Edited from the About page; stored next to the database.
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/paths";

const savedPath = () => path.join(dataDir(), "about-tommy.md");
// The starter copy that ships with the code.
const templatePath = () => path.join(process.cwd(), "data", "about-tommy.md");

export function readAbout(): string {
  for (const p of [savedPath(), templatePath()]) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {}
  }
  return "# About Tommy\n";
}

export function writeAbout(text: string) {
  fs.writeFileSync(savedPath(), text.slice(0, 100_000), "utf8");
}
