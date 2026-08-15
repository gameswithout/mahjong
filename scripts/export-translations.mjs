import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(root, "client/i18n/catalog.json");
const outputPath = path.join(root, "docs/localization/translations.csv");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

function csv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const columns = ["key", "context", "en", "zh-CN", "zh-TW", "status"];
const rows = [columns.map(csv).join(",")];
for (const [key, message] of Object.entries(catalog)) {
  rows.push(columns.map((column) => csv(column === "key" ? key : message[column])).join(","));
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${rows.join("\n")}\n`);
console.log(`Exported ${Object.keys(catalog).length} strings to ${path.relative(root, outputPath)}`);
