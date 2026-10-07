import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const localesDir = path.join(root, "src/shared/i18n/locales");
const defined = new Set();
for (const file of fs.readdirSync(localesDir)) {
  if (!file.endsWith(".ts") || file === "index.ts") continue;
  const source = fs.readFileSync(path.join(localesDir, file), "utf8");
  for (const match of source.matchAll(/^\s*["']([a-zA-Z][\w.]+)["']\s*:/gm)) {
    defined.add(match[1]);
  }
}

const used = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "fileIcons" ||
        entry.name === "grok-bot" ||
        entry.name === "assets"
      ) {
        continue;
      }
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".d.ts")) continue;
    const source = fs.readFileSync(full, "utf8");
    for (const match of source.matchAll(/\bt\(\s*["']([a-zA-Z][\w.]+)["']/g)) {
      used.add(match[1]);
    }
    // map of key constants: KEY = "foo.bar"
    for (const match of source.matchAll(/=\s*["']([a-zA-Z][\w.]+)["']/g)) {
      const key = match[1];
      if (key.includes(".")) used.add(key);
    }
  }
}
walk(path.join(root, "src"));

const missing = [...used].filter((k) => !defined.has(k)).sort();
const unused = [...defined].filter((k) => !used.has(k)).sort();

console.log(`defined=${defined.size} usedStatically=${used.size}`);
console.log(`missing=${missing.length}`);
for (const key of missing) console.log(`  - ${key}`);
console.log(`unused=${unused.length}`);
for (const key of unused) console.log(`  - ${key}`);

process.exit(missing.length > 0 ? 1 : 0);
