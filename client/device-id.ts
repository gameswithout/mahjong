export const DEVICE_ID_STORAGE_KEY = "mahjong.ags.device-id";

export interface DeviceIdStore {
  getOrCreate(): string;
}

function createDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Xsolla Login validates this field as a UUID. Browsers with no
  // crypto.randomUUID are old, but crypto.getRandomValues is widely available.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeStoredDeviceId(value: string): string | null {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return value;
  }

  // Earlier builds stored crypto.randomUUID() without dashes. Preserve those
  // 128 bits so the migration to Xsolla does not unnecessarily rotate the ID.
  if (/^[0-9a-f]{32}$/i.test(value)) {
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  return null;
}

export const browserDeviceIdStore: DeviceIdStore = {
  getOrCreate() {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) {
      const normalized = normalizeStoredDeviceId(existing);
      if (normalized) {
        if (normalized !== existing) {
          window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, normalized);
        }
        return normalized;
      }
    }

    const deviceId = createDeviceId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    return deviceId;
  },
};
