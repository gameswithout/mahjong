import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { trackPageFailures } from "./ui-evidence-support.mjs";

class FakePage extends EventEmitter {}

function request(url, failure = null) {
  return {
    method: () => "GET",
    url: () => url,
    failure: () => failure,
  };
}

describe("UI evidence runtime failure tracking", () => {
  it("records browser, console, network, and external-request failures", () => {
    const page = new FakePage();
    const failures = trackPageFailures(page, "http://127.0.0.1:5191");

    page.emit("pageerror", new Error("render crashed"));
    page.emit("console", { type: () => "warning", text: () => "ignore me" });
    page.emit("console", { type: () => "error", text: () => "bad console" });
    page.emit(
      "requestfailed",
      request("http://127.0.0.1:5191/missing.js", {
        errorText: "net::ERR_FAILED",
      }),
    );
    page.emit("request", request("http://127.0.0.1:5191/local.js"));
    page.emit("request", request("https://example.com/unexpected"));

    expect(failures).toEqual([
      "page error: render crashed",
      "console error: bad console",
      "request failed: GET http://127.0.0.1:5191/missing.js (net::ERR_FAILED)",
      "unexpected external request: GET https://example.com/unexpected",
    ]);
  });
});
