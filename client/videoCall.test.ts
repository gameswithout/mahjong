import { describe, expect, it } from "vitest";

import {
  buildCallMediaConstraints,
  classifyCallQuality,
  nextAdaptiveProfile,
  normalizeIceConfiguration,
  type CallStatsSample,
} from "./videoCall";
import { isInitiator, peerId, seatFromPeerId, SEAT_ORDER } from "./videoMesh";

describe("videoMesh addressing", () => {
  it("derives a broker-safe deterministic peer id from match id and seat", () => {
    expect(peerId("abc-123-DEF", "E")).toBe("mahjong-abc123DEF-E");
    // Non-alphanumerics in the match id are stripped so the id is URL-safe.
    expect(peerId("id_with/odd.chars", "N")).toBe("mahjong-idwithoddchars-N");
  });

  it("round-trips the seat back out of a peer id", () => {
    for (const seat of SEAT_ORDER) {
      expect(seatFromPeerId(peerId("match-1", seat))).toBe(seat);
    }
    expect(seatFromPeerId("mahjong-match-X")).toBeNull();
  });

  it("gives each human pair exactly one initiator via turn order", () => {
    // For every unordered pair, exactly one side should be the initiator.
    for (let i = 0; i < SEAT_ORDER.length; i += 1) {
      for (let j = i + 1; j < SEAT_ORDER.length; j += 1) {
        const a = SEAT_ORDER[i];
        const b = SEAT_ORDER[j];
        expect(isInitiator(a, b)).toBe(true);
        expect(isInitiator(b, a)).toBe(false);
      }
    }
  });
});

describe("buildCallMediaConstraints", () => {
  it("uses facingMode when no explicit video device is chosen", () => {
    const constraints = buildCallMediaConstraints({ profile: "medium" });
    const video = constraints.video as MediaTrackConstraints;
    expect(video.width).toEqual({ ideal: 960 });
    expect(video.facingMode).toEqual({ ideal: "user" });
    expect(video.deviceId).toBeUndefined();
  });

  it("pins an exact device id when one is supplied", () => {
    const constraints = buildCallMediaConstraints({ videoDeviceId: "cam-1", audioDeviceId: "mic-1" });
    const video = constraints.video as MediaTrackConstraints;
    const audio = constraints.audio as MediaTrackConstraints;
    expect(video.deviceId).toEqual({ exact: "cam-1" });
    expect(video.facingMode).toBeUndefined();
    expect(audio.deviceId).toEqual({ exact: "mic-1" });
  });
});

describe("normalizeIceConfiguration", () => {
  it("keeps credentialed TURN servers and flags hasTurn", () => {
    const config = normalizeIceConfiguration(
      {
        iceServers: [
          { urls: "stun:stun.example.org" },
          { urls: ["turn:turn.example.org"], username: "u", credential: "c" },
        ],
        ttl: 120,
      },
      1_000,
    );
    expect(config?.hasTurn).toBe(true);
    expect(config?.iceServers).toHaveLength(2);
    expect(config?.expiresAt).toBe(1_000 + 120_000);
  });

  it("drops TURN servers missing credentials", () => {
    const config = normalizeIceConfiguration({ iceServers: [{ urls: "turn:turn.example.org" }] });
    expect(config).toBeNull();
  });
});

function sampleWith(overrides: Partial<CallStatsSample>): CallStatsSample {
  const empty = {
    bitrateKbps: null,
    packetLossPercent: null,
    jitterMs: null,
    width: null,
    height: null,
    framesPerSecond: null,
    freezeCount: null,
    totalFreezeDurationMs: null,
    jitterBufferDelayMs: null,
    codec: "",
    qualityLimitationReason: "",
  };
  return {
    capturedAt: "",
    connection: { state: "connected" },
    network: {
      rttMs: null,
      availableOutgoingBitrateKbps: null,
      localCandidateType: "",
      remoteCandidateType: "",
      protocol: "",
      relayProtocol: "",
      relayed: false,
    },
    inbound: { audio: { ...empty }, video: { ...empty } },
    outbound: { audio: { ...empty }, video: { ...empty } },
    ...overrides,
  };
}

describe("classifyCallQuality", () => {
  it("reports connecting before the transport is up", () => {
    expect(classifyCallQuality(sampleWith({ connection: { state: "checking" } }))).toBe("connecting");
  });

  it("reports poor on high round-trip time", () => {
    expect(classifyCallQuality(sampleWith({ network: { ...sampleWith({}).network, rttMs: 600 } }))).toBe("poor");
  });

  it("reports good on a healthy sample", () => {
    const sample = sampleWith({ network: { ...sampleWith({}).network, rttMs: 40 } });
    sample.inbound.video.framesPerSecond = 30;
    sample.inbound.audio.packetLossPercent = 0;
    expect(classifyCallQuality(sample)).toBe("good");
  });
});

describe("nextAdaptiveProfile", () => {
  it("steps down a level after two consecutive poor samples", () => {
    const first = nextAdaptiveProfile("high", "poor", {});
    expect(first.changed).toBe(false);
    const second = nextAdaptiveProfile("high", "poor", first);
    expect(second.changed).toBe(true);
    expect(second.profile).toBe("medium");
  });

  it("steps up a level after five consecutive good samples", () => {
    let counters = nextAdaptiveProfile("low", "good", {});
    for (let i = 0; i < 3; i += 1) counters = nextAdaptiveProfile("low", "good", counters);
    expect(counters.changed).toBe(false);
    const fifth = nextAdaptiveProfile("low", "good", counters);
    expect(fifth.changed).toBe(true);
    expect(fifth.profile).toBe("medium");
  });
});
