import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { evidenceDirectory } from "./ui-evidence-support.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const viteCli = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);
const host = "127.0.0.1";
const port = process.env.UI_EVIDENCE_PORT?.trim() || "5191";
const previewOrigin = `http://${host}:${port}`;
const configuredBasePath =
  process.env.UI_EVIDENCE_BASE_PATH?.trim() || "/mahjong/";
const basePathSegment = configuredBasePath.replace(/^\/+|\/+$/g, "");
const previewBasePath = basePathSegment ? `/${basePathSegment}/` : "/";
const baseUrl = new URL(previewBasePath, `${previewOrigin}/`)
  .toString()
  .replace(/\/$/, "");
const outputDirectory = evidenceDirectory();
const previewLog = [];
let previewSpawnError = null;

function appendPreviewLog(chunk) {
  const text = chunk.toString();
  previewLog.push(text);
  process.stdout.write(text);
}

const preview = spawn(
  process.execPath,
  [
    viteCli,
    "preview",
    "--base",
    previewBasePath,
    "--host",
    host,
    "--port",
    port,
    "--strictPort",
  ],
  {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
preview.stdout.on("data", appendPreviewLog);
preview.stderr.on("data", appendPreviewLog);
preview.on("error", (error) => {
  previewSpawnError = error;
  appendPreviewLog(`Failed to start Vite preview: ${error.message}\n`);
});

async function waitForPreview() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (previewSpawnError) {
      throw previewSpawnError;
    }
    if (preview.exitCode !== null) {
      throw new Error(
        `Vite preview exited before becoming ready (code ${preview.exitCode}).`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/onboarding-evidence.html`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The preview has not bound its port yet.
    }
    await new Promise((resolveReady) => setTimeout(resolveReady, 250));
  }
  throw new Error(`Vite preview did not become ready at ${baseUrl}.`);
}

async function runEvidenceScript(id, relativePath, argumentsList = []) {
  const output = [];
  let spawnError = null;
  const command = spawn(
    process.execPath,
    [fileURLToPath(new URL(relativePath, import.meta.url)), ...argumentsList],
    {
      cwd: root,
      env: {
        ...process.env,
        UI_EVIDENCE_DIR: outputDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  command.stdout.on("data", (chunk) => {
    output.push(chunk.toString());
    process.stdout.write(chunk);
  });
  command.stderr.on("data", (chunk) => {
    output.push(chunk.toString());
    process.stderr.write(chunk);
  });
  command.on("error", (error) => {
    spawnError = error;
    output.push(`Failed to start ${id}: ${error.message}\n`);
  });
  const [code, signal] = await once(command, "close");
  writeFileSync(join(outputDirectory, `${id}.log`), output.join(""));
  if (spawnError) {
    throw spawnError;
  }
  if (code !== 0) {
    throw new Error(
      `${id} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`,
    );
  }
}

async function stopPreview() {
  if (preview.exitCode !== null) {
    return;
  }
  preview.kill("SIGTERM");
  await Promise.race([
    once(preview, "close"),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000)),
  ]);
  if (preview.exitCode === null) {
    preview.kill("SIGKILL");
    await once(preview, "close");
  }
}

const failures = [];
try {
  await waitForPreview();
  const checks = [
    [
      "match-table",
      "./validate-match-table-wireframe.mjs",
      [baseUrl],
    ],
    ["result-screen", "./capture-result-evidence.mjs", [baseUrl]],
    ["onboarding", "./capture-onboarding-evidence.mjs", [baseUrl]],
    ["bundle", "./check-bundle-budget.mjs"],
  ];

  for (const [id, script, argumentsList] of checks) {
    try {
      await runEvidenceScript(id, script, argumentsList);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
} finally {
  await stopPreview();
  writeFileSync(join(outputDirectory, "preview.log"), previewLog.join(""));
}

if (failures.length) {
  process.stderr.write(
    `\nUI evidence gate failed:\n${failures
      .map((failure) => `  - ${failure}`)
      .join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`\nUI evidence gate passed. Artifacts: ${outputDirectory}\n`);
}
