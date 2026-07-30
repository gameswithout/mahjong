import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import {
  evidenceDirectory,
  writeEvidenceJson,
} from "./ui-evidence-support.mjs";

const root = process.cwd();
const distDirectory = resolve(root, process.argv[2] ?? "dist");
const budgetPath = resolve(root, ".github/ui-evidence-budgets.json");

if (!existsSync(distDirectory)) {
  throw new Error(
    `Production build not found at ${distDirectory}. Run npm run build first.`,
  );
}

const budgets = JSON.parse(readFileSync(budgetPath, "utf8"));

function filesBelow(directory) {
  return readdirSync(directory).flatMap((name) => {
    const filePath = join(directory, name);
    return statSync(filePath).isDirectory()
      ? filesBelow(filePath)
      : [filePath];
  });
}

const files = filesBelow(distDirectory)
  .map((filePath) => {
    const contents = readFileSync(filePath);
    return {
      path: relative(distDirectory, filePath),
      extension: extname(filePath),
      bytes: contents.byteLength,
      gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    };
  })
  .sort((left, right) => right.gzipBytes - left.gzipBytes);

const javascript = files.filter((file) => file.extension === ".js");
const report = {
  generatedAt: new Date().toISOString(),
  distDirectory: relative(root, distDirectory),
  budgets,
  totals: {
    files: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
  },
  largestJavaScript: javascript[0] ?? null,
  files,
};

const failures = [];
if (report.totals.gzipBytes > budgets.wholeBuildGzipBytes) {
  failures.push(
    `whole build is ${report.totals.gzipBytes} gzip bytes; budget is ${budgets.wholeBuildGzipBytes}`,
  );
}
if (
  report.largestJavaScript &&
  report.largestJavaScript.gzipBytes > budgets.largestJavaScriptGzipBytes
) {
  failures.push(
    `${report.largestJavaScript.path} is ${report.largestJavaScript.gzipBytes} gzip bytes; per-file JavaScript guardrail is ${budgets.largestJavaScriptGzipBytes}`,
  );
}

report.failures = failures;
writeEvidenceJson(join(evidenceDirectory(), "bundle-report.json"), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  process.stderr.write(
    `${failures.map((failure) => `FAIL: ${failure}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}
