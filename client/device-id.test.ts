import { beforeEach, describe, expect, it, vi } from "vitest";

import { browserDeviceIdStore, DEVICE_ID_STORAGE_KEY } from "./device-id";

describe("browserDeviceIdStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps a stable UUID for Xsolla device login", () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "72879996-0c41-4ee5-9938-f889639390e5",
    );

    expect(browserDeviceIdStore.getOrCreate()).toBe(
      "72879996-0c41-4ee5-9938-f889639390e5",
    );
    expect(browserDeviceIdStore.getOrCreate()).toBe(
      "72879996-0c41-4ee5-9938-f889639390e5",
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("migrates the previous dashless UUID without rotating it", () => {
    window.localStorage.setItem(
      DEVICE_ID_STORAGE_KEY,
      "728799960c414ee59938f889639390e5",
    );

    expect(browserDeviceIdStore.getOrCreate()).toBe(
      "72879996-0c41-4ee5-9938-f889639390e5",
    );
    expect(window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(
      "72879996-0c41-4ee5-9938-f889639390e5",
    );
  });
});
