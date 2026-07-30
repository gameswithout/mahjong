import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_EVIDENCE_DIRECTORY = ".artifacts/ui-evidence";

export function evidenceDirectory() {
  const requested =
    process.env.UI_EVIDENCE_DIR?.trim() || DEFAULT_EVIDENCE_DIRECTORY;
  const directory = resolve(process.cwd(), requested);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function writeEvidenceJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function trackPageFailures(page, allowedOrigin) {
  const failures = [];

  page.on("pageerror", (error) => {
    failures.push(`page error: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console error: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    failures.push(
      `request failed: ${request.method()} ${request.url()} (${
        request.failure()?.errorText ?? "unknown error"
      })`,
    );
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      allowedOrigin &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin !== allowedOrigin
    ) {
      failures.push(
        `unexpected external request: ${request.method()} ${request.url()}`,
      );
    }
  });

  return failures;
}
