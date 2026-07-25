import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountUpgradeCard } from "./AccountUpgradeCard";
import { IamAuthError, type GuestUpgradeInput } from "./iam";

function setValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AccountUpgradeCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  function field(selector: string): HTMLInputElement | HTMLSelectElement {
    const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (!element) {
      throw new Error(`missing field: ${selector}`);
    }
    return element;
  }

  function clickButton(label: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) {
      throw new Error(`missing button: ${label}`);
    }
    act(() => button.click());
  }

  // React tracks the DOM node's own `checked` value, so a plain assignment is
  // swallowed as a no-op change. Go through the prototype setter instead.
  function confirmAge() {
    const checkbox = field(".email-auth-checkbox-label input") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(
      checkbox,
      true,
    );
    act(() => checkbox.dispatchEvent(new Event("click", { bubbles: true })));
  }

  // Walks the wizard from the collapsed CTA to a filled-in details step.
  async function fillDetails(onRequestCode: ReturnType<typeof vi.fn>) {
    clickButton("Create a full account");
    act(() => setValue(field("#upgrade-email"), "guest@example.com"));
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
    expect(onRequestCode).toHaveBeenCalledWith("guest@example.com");

    act(() => setValue(field("#upgrade-code"), "123456"));
    act(() => setValue(field("#upgrade-username"), "riverwind"));
    act(() => setValue(field("#upgrade-password"), "correct horse battery staple"));
    act(() => setValue(field('[aria-label="Birth month"]'), "5"));
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    container.remove();
  });

  it("promises that upgrading keeps the account's existing progress", () => {
    act(() => {
      root.render(<AccountUpgradeCard onRequestCode={vi.fn()} onUpgrade={vi.fn()} />);
    });

    expect(container.textContent).toContain("Playing as a guest");
    expect(container.textContent).toContain("Your Jade, rating, and progression stay exactly");
    // Collapsed until asked for: the result tally comes first.
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("Create a full account");
  });

  it("requests a code, then upgrades the same account and confirms it", async () => {
    const onRequestCode = vi.fn().mockResolvedValue(undefined);
    const onUpgrade = vi.fn<(input: GuestUpgradeInput) => Promise<void>>().mockResolvedValue();
    const onUpgraded = vi.fn();
    act(() => {
      root.render(
        <AccountUpgradeCard
          onRequestCode={onRequestCode}
          onUpgrade={onUpgrade}
          onUpgraded={onUpgraded}
        />,
      );
    });

    await fillDetails(onRequestCode);
    act(() => setValue(field('[aria-label="Birth year"]'), "1990"));
    confirmAge();

    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });

    expect(onUpgrade).toHaveBeenCalledWith({
      email: "guest@example.com",
      username: "riverwind",
      password: "correct horse battery staple",
      country: "US",
      birthYear: 1990,
      birthMonth: 5,
      code: "123456",
    });
    expect(onUpgraded).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Account created");
    expect(container.textContent).toContain("guest@example.com");
    expect(container.querySelector("form")).toBeNull();
  });

  it("blocks an under-13 birth date before it reaches AGS", async () => {
    const onRequestCode = vi.fn().mockResolvedValue(undefined);
    const onUpgrade = vi.fn();
    act(() => {
      root.render(<AccountUpgradeCard onRequestCode={onRequestCode} onUpgrade={onUpgrade} />);
    });

    await fillDetails(onRequestCode);
    act(() => setValue(field('[aria-label="Birth year"]'), "2020"));
    confirmAge();

    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });

    expect(onUpgrade).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "at least 13 years old",
    );
  });

  it("requires the age confirmation before submitting", async () => {
    const onRequestCode = vi.fn().mockResolvedValue(undefined);
    const onUpgrade = vi.fn();
    act(() => {
      root.render(<AccountUpgradeCard onRequestCode={onRequestCode} onUpgrade={onUpgrade} />);
    });

    await fillDetails(onRequestCode);
    act(() => setValue(field('[aria-label="Birth year"]'), "1990"));
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });

    expect(onUpgrade).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Confirm your age");
  });

  it("shows only the safe part of an AGS failure and stays retryable", async () => {
    const onRequestCode = vi.fn().mockRejectedValue(
      new IamAuthError("upgrade_failed", "Email address is already used.", {
        cause: new Error("secret-token-must-not-render"),
      }),
    );
    act(() => {
      root.render(<AccountUpgradeCard onRequestCode={onRequestCode} onUpgrade={vi.fn()} />);
    });

    clickButton("Create a full account");
    act(() => setValue(field("#upgrade-email"), "taken@example.com"));
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Email address is already used.",
    );
    expect(container.textContent).not.toContain("secret-token-must-not-render");
    expect(container.querySelector("#upgrade-email")).not.toBeNull();
  });

  it("folds back to the offer without upgrading when declined", async () => {
    act(() => {
      root.render(<AccountUpgradeCard onRequestCode={vi.fn()} onUpgrade={vi.fn()} />);
    });

    clickButton("Create a full account");
    expect(container.querySelector("form")).not.toBeNull();
    clickButton("Not now");

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("Create a full account");
  });
});
