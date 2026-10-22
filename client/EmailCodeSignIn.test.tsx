import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EmailCodeSignIn } from "./EmailCodeSignIn";
import { XsollaEmailError } from "./xsolla-email";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("uses one code flow, handles provider failure, resend and changing email", async () => {
  const node = document.createElement("div"); const root = createRoot(node);
  const request = vi.fn().mockRejectedValueOnce(new XsollaEmailError("Email-code sign-in is not enabled")).mockResolvedValueOnce("op-1").mockResolvedValueOnce("op-2"); const confirm = vi.fn().mockResolvedValue(undefined);
  act(() => root.render(<EmailCodeSignIn onRequestCode={request} onConfirm={confirm} />));
  function input(selector: string, value: string) {
    const element = node.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    act(() => { Object.getOwnPropertyDescriptor(element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
  }
  const submit = () => act(async () => { node.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  input("#email-code-address", "player@example.com");
  expect(node.querySelector("select")).toBeNull();
  expect(node.querySelector('[type="checkbox"]')).toBeNull();
  expect(node.textContent).not.toContain("Birth");
  await submit(); expect(node.querySelector('[role="alert"]')?.textContent).toContain("not enabled");
  expect(node.querySelector("#email-one-time-code")).toBeNull();
  await submit(); expect(node.querySelector("#email-one-time-code")).not.toBeNull();
  input("#email-one-time-code", "123456"); await submit(); expect(confirm).toHaveBeenCalledWith("player@example.com", "123456", "op-1");
  await act(async () => { [...node.querySelectorAll("button")].find((button) => button.textContent === "Request a new code")!.click(); });
  input("#email-one-time-code", "654321"); await submit(); expect(confirm).toHaveBeenLastCalledWith("player@example.com", "654321", "op-2");
  act(() => [...node.querySelectorAll("button")].find((button) => button.textContent === "Use another email")!.click());
  expect(node.querySelector<HTMLInputElement>("#email-code-address")?.disabled).toBe(false);
  expect(node.querySelector('[type="password"]')).toBeNull();
  act(() => root.unmount());
});
