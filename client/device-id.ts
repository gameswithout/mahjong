export const DEVICE_ID_STORAGE_KEY = "mahjong.ags.device-id";

export interface DeviceIdStore {
  getOrCreate(): string;
}

function createDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }

  return `mahjong${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export const browserDeviceIdStore: DeviceIdStore = {
  getOrCreate() {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const deviceId = createDeviceId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    return deviceId;
  },
};
