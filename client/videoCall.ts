// Video-call runtime ported from the sibling chess project's
// src/video-call.mjs. It is deliberately framework-agnostic — media
// constraints, optional managed-TURN (ICE) fetching, PeerJS peer creation,
// live RTCStats quality sampling, and adaptive send-profile selection — so the
// React layer (useVideoCall / VideoCallPanel) only has to wire it to the
// mahjong match. Mahjong has no managed-TURN endpoint, so iceConfigUrl is left
// empty and PeerJS's default STUN is used; the ICE plumbing is kept so a TURN
// endpoint can be dropped in later without touching callers.

import type Peer from "peerjs";
import type { MediaConnection } from "peerjs";

export interface VideoProfile {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
  scaleResolutionDownBy: number;
}

export const VIDEO_PROFILES: Readonly<Record<string, VideoProfile>> = Object.freeze({
  high: Object.freeze({ name: "high", width: 1280, height: 720, frameRate: 30, maxBitrate: 1_600_000, scaleResolutionDownBy: 1 }),
  medium: Object.freeze({ name: "medium", width: 960, height: 540, frameRate: 24, maxBitrate: 900_000, scaleResolutionDownBy: 4 / 3 }),
  low: Object.freeze({ name: "low", width: 640, height: 360, frameRate: 20, maxBitrate: 450_000, scaleResolutionDownBy: 2 }),
});

const PROFILE_ORDER = ["high", "medium", "low"] as const;
const ICE_FETCH_TIMEOUT_MS = 3_000;
const ICE_FAILURE_RETRY_MS = 60_000;
const ICE_EXPIRY_SAFETY_MS = 60_000;

export type ProfileName = "high" | "medium" | "low";
export type CallQuality = "connecting" | "poor" | "fair" | "good";

function selectedProfile(name: string): VideoProfile {
  return VIDEO_PROFILES[name] || VIDEO_PROFILES.high;
}

function preferredDevice(deviceId: string): ConstrainDOMString | undefined {
  return deviceId ? { exact: String(deviceId) } : undefined;
}

export interface MediaPreferences {
  profile?: string;
  audioDeviceId?: string;
  videoDeviceId?: string;
  facingMode?: "user" | "environment";
}

export function buildCallMediaConstraints({
  profile = "high",
  audioDeviceId = "",
  videoDeviceId = "",
  facingMode = "user",
}: MediaPreferences = {}): MediaStreamConstraints {
  const videoProfile = selectedProfile(profile);
  const video: MediaTrackConstraints = {
    width: { ideal: videoProfile.width },
    height: { ideal: videoProfile.height },
    frameRate: { ideal: videoProfile.frameRate, max: videoProfile.frameRate },
    aspectRatio: { ideal: 16 / 9 },
  };
  const selectedVideoDevice = preferredDevice(videoDeviceId);
  if (selectedVideoDevice) video.deviceId = selectedVideoDevice;
  else video.facingMode = { ideal: facingMode === "environment" ? "environment" : "user" };

  const audio: MediaTrackConstraints = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48_000 },
    sampleSize: { ideal: 16 },
  };
  const selectedAudioDevice = preferredDevice(audioDeviceId);
  if (selectedAudioDevice) audio.deviceId = selectedAudioDevice;

  return { audio, video };
}

function normalizeUrls(value: unknown): string[] {
  const urls = Array.isArray(value) ? value : [value];
  return urls
    .filter((url): url is string => typeof url === "string" && /^(stun|stuns|turn|turns):/i.test(url.trim()))
    .map((url) => url.trim())
    .slice(0, 8);
}

function normalizeIceServer(server: any): RTCIceServer | null {
  if (!server || typeof server !== "object") return null;
  const urls = normalizeUrls(server.urls || server.url);
  if (!urls.length) return null;
  const usesTurn = urls.some((url) => /^turns?:/i.test(url));
  if (usesTurn && (typeof server.username !== "string" || typeof server.credential !== "string")) {
    return null;
  }
  const normalized: RTCIceServer = { urls: urls.length === 1 ? urls[0] : urls };
  if (typeof server.username === "string") normalized.username = server.username;
  if (typeof server.credential === "string") normalized.credential = server.credential;
  return normalized;
}

function parseExpiry(source: any, now: number): number {
  const explicit = source?.expiresAt ?? source?.expires_at;
  if (explicit) {
    const asNumber = Number(explicit);
    if (Number.isFinite(asNumber)) return asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber;
    const parsed = Date.parse(explicit);
    if (Number.isFinite(parsed)) return parsed;
  }
  const ttl = Number(source?.ttl ?? source?.ttlSeconds ?? source?.ttl_seconds);
  return Number.isFinite(ttl) && ttl > 0 ? now + ttl * 1000 : now + 10 * 60_000;
}

export interface IceConfiguration {
  iceServers: RTCIceServer[];
  expiresAt: number;
  hasTurn: boolean;
}

export function normalizeIceConfiguration(payload: any, now = Date.now()): IceConfiguration | null {
  const source = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const rawServers = Array.isArray(source) ? source : source?.iceServers || source?.ice_servers || source?.servers;
  if (!Array.isArray(rawServers)) return null;
  const iceServers = rawServers.map(normalizeIceServer).filter((server): server is RTCIceServer => Boolean(server)).slice(0, 12);
  if (!iceServers.length) return null;
  return {
    iceServers,
    expiresAt: parseExpiry(source, now),
    hasTurn: iceServers.some((server) => normalizeUrls(server.urls).some((url) => /^turns?:/i.test(url))),
  };
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function rounded(value: unknown, digits = 0): number | null {
  const numeric = num(value);
  if (numeric === null) return null;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function statsValues(report: any): any[] {
  if (!report) return [];
  if (typeof report.values === "function") return Array.from(report.values());
  if (typeof report.forEach === "function") {
    const values: any[] = [];
    report.forEach((value: any) => values.push(value));
    return values;
  }
  return Array.isArray(report) ? report : [];
}

function bitrateKbps(current: any, previous: any, bytesKey: string): number | null {
  const bytes = num(current?.[bytesKey]);
  const oldBytes = num(previous?.[bytesKey]);
  const timestamp = num(current?.timestamp);
  const oldTimestamp = num(previous?.timestamp);
  if (bytes === null || oldBytes === null || timestamp === null || oldTimestamp === null) return null;
  const elapsedMs = timestamp - oldTimestamp;
  const byteDelta = bytes - oldBytes;
  if (elapsedMs <= 0 || byteDelta < 0) return null;
  return (byteDelta * 8) / elapsedMs;
}

function packetLossPercent(current: any, previous: any): number | null {
  const received = num(current?.packetsReceived);
  const oldReceived = num(previous?.packetsReceived);
  const lost = num(current?.packetsLost);
  const oldLost = num(previous?.packetsLost);
  if ([received, oldReceived, lost, oldLost].some((value) => value === null)) return null;
  const receivedDelta = Math.max(0, (received as number) - (oldReceived as number));
  const lostDelta = Math.max(0, (lost as number) - (oldLost as number));
  const total = receivedDelta + lostDelta;
  return total > 0 ? (lostDelta / total) * 100 : 0;
}

function codecName(stat: any, byId: Map<string, any>): string {
  const codec = stat?.codecId ? byId.get(stat.codecId) : null;
  return typeof codec?.mimeType === "string" ? codec.mimeType.slice(0, 40) : "";
}

interface RtpSample {
  bitrateKbps: number | null;
  packetLossPercent: number | null;
  jitterMs: number | null;
  width: number | null;
  height: number | null;
  framesPerSecond: number | null;
  freezeCount: number | null;
  totalFreezeDurationMs: number | null;
  jitterBufferDelayMs: number | null;
  codec: string;
  qualityLimitationReason: string;
}

function emptyRtpSample(): RtpSample {
  return {
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
}

export interface CallStatsSample {
  capturedAt: string;
  connection: { state: string };
  network: {
    rttMs: number | null;
    availableOutgoingBitrateKbps: number | null;
    localCandidateType: string;
    remoteCandidateType: string;
    protocol: string;
    relayProtocol: string;
    relayed: boolean;
  };
  inbound: { audio: RtpSample; video: RtpSample };
  outbound: { audio: RtpSample; video: RtpSample };
  quality?: CallQuality;
  profile?: string;
}

export function classifyCallQuality(sample: CallStatsSample): CallQuality {
  const state = sample?.connection?.state;
  if (state && !["connected", "completed"].includes(state)) return "connecting";
  const rtt = num(sample?.network?.rttMs);
  const losses = [num(sample?.inbound?.audio?.packetLossPercent), num(sample?.inbound?.video?.packetLossPercent)].filter(
    (value): value is number => value !== null,
  );
  const maxLoss = losses.length ? Math.max(...losses) : 0;
  const audioJitter = num(sample?.inbound?.audio?.jitterMs) || 0;
  const inboundFps = num(sample?.inbound?.video?.framesPerSecond);
  const limitedByBandwidth = sample?.outbound?.video?.qualityLimitationReason === "bandwidth";
  const hasQualitySignal =
    rtt !== null || losses.length > 0 || audioJitter > 0 || inboundFps !== null || num(sample?.outbound?.video?.bitrateKbps) !== null;
  if (!hasQualitySignal) return "connecting";

  if ((rtt !== null && rtt >= 500) || maxLoss >= 8 || audioJitter >= 60 || (inboundFps !== null && inboundFps > 0 && inboundFps < 12))
    return "poor";
  if (
    (rtt !== null && rtt >= 250) ||
    maxLoss >= 3 ||
    audioJitter >= 30 ||
    limitedByBandwidth ||
    (inboundFps !== null && inboundFps > 0 && inboundFps < 18)
  )
    return "fair";
  return "good";
}

export function summarizeRtcStats(
  report: any,
  previousById: Map<string, any> = new Map(),
): { sample: CallStatsSample; nextById: Map<string, any> } {
  const values = statsValues(report);
  const byId = new Map<string, any>(values.filter((stat) => stat?.id).map((stat) => [stat.id, stat]));
  const nextById = new Map<string, any>();
  const sample: CallStatsSample = {
    capturedAt: new Date().toISOString(),
    connection: { state: "" },
    network: {
      rttMs: null,
      availableOutgoingBitrateKbps: null,
      localCandidateType: "",
      remoteCandidateType: "",
      protocol: "",
      relayProtocol: "",
      relayed: false,
    },
    inbound: { audio: emptyRtpSample(), video: emptyRtpSample() },
    outbound: { audio: emptyRtpSample(), video: emptyRtpSample() },
  };

  let selectedPair: any = null;
  for (const stat of values) {
    if (stat?.id) nextById.set(stat.id, stat);
    if (stat?.type === "transport" && stat.selectedCandidatePairId) {
      selectedPair = byId.get(stat.selectedCandidatePairId) || selectedPair;
    }
    if (stat?.type === "candidate-pair" && stat.state === "succeeded" && (stat.selected || stat.nominated)) {
      selectedPair = stat;
    }
    if (!["inbound-rtp", "outbound-rtp"].includes(stat?.type) || stat.isRemote) continue;
    const kind = stat.kind || stat.mediaType;
    if (!["audio", "video"].includes(kind)) continue;
    const direction = stat.type === "inbound-rtp" ? "inbound" : "outbound";
    const target = sample[direction][kind as "audio" | "video"];
    const previous = previousById.get(stat.id);
    target.bitrateKbps = rounded(bitrateKbps(stat, previous, direction === "inbound" ? "bytesReceived" : "bytesSent"));
    target.packetLossPercent = direction === "inbound" ? rounded(packetLossPercent(stat, previous), 1) : null;
    target.jitterMs = direction === "inbound" && num(stat.jitter) !== null ? rounded(stat.jitter * 1000) : null;
    target.width = rounded(stat.frameWidth);
    target.height = rounded(stat.frameHeight);
    target.framesPerSecond = rounded(stat.framesPerSecond, 1);
    target.freezeCount = rounded(stat.freezeCount);
    target.totalFreezeDurationMs = num(stat.totalFreezesDuration) !== null ? rounded(stat.totalFreezesDuration * 1000) : null;
    target.jitterBufferDelayMs =
      num(stat.jitterBufferDelay) !== null && (num(stat.jitterBufferEmittedCount) || 0) > 0
        ? rounded((stat.jitterBufferDelay / stat.jitterBufferEmittedCount) * 1000)
        : null;
    target.codec = codecName(stat, byId);
    target.qualityLimitationReason = typeof stat.qualityLimitationReason === "string" ? stat.qualityLimitationReason : "";
  }

  if (selectedPair) {
    const local = byId.get(selectedPair.localCandidateId);
    const remote = byId.get(selectedPair.remoteCandidateId);
    sample.network.rttMs = num(selectedPair.currentRoundTripTime) !== null ? rounded(selectedPair.currentRoundTripTime * 1000) : null;
    sample.network.availableOutgoingBitrateKbps =
      num(selectedPair.availableOutgoingBitrate) !== null ? rounded(selectedPair.availableOutgoingBitrate / 1000) : null;
    sample.network.localCandidateType = String(local?.candidateType || "").slice(0, 16);
    sample.network.remoteCandidateType = String(remote?.candidateType || "").slice(0, 16);
    sample.network.protocol = String(local?.protocol || remote?.protocol || "").slice(0, 12);
    sample.network.relayProtocol = String(local?.relayProtocol || remote?.relayProtocol || "").slice(0, 12);
    sample.network.relayed = local?.candidateType === "relay" || remote?.candidateType === "relay";
  }

  sample.quality = classifyCallQuality(sample);
  return { sample, nextById };
}

export interface AdaptationCounters {
  poorSamples?: number;
  goodSamples?: number;
}

export function nextAdaptiveProfile(
  currentProfile: string,
  quality: CallQuality,
  counters: AdaptationCounters = {},
): { profile: string; poorSamples: number; goodSamples: number; changed: boolean } {
  const currentIndex = Math.max(0, PROFILE_ORDER.indexOf(currentProfile as ProfileName));
  let poorSamples = Math.max(0, Number(counters.poorSamples) || 0);
  let goodSamples = Math.max(0, Number(counters.goodSamples) || 0);

  if (quality === "poor") {
    poorSamples += 1;
    goodSamples = 0;
  } else if (quality === "good") {
    goodSamples += 1;
    poorSamples = 0;
  } else {
    poorSamples = 0;
    goodSamples = 0;
  }

  let nextIndex = currentIndex;
  if (poorSamples >= 2 && currentIndex < PROFILE_ORDER.length - 1) {
    nextIndex += 1;
    poorSamples = 0;
  } else if (goodSamples >= 5 && currentIndex > 0) {
    nextIndex -= 1;
    goodSamples = 0;
  }
  return { profile: PROFILE_ORDER[nextIndex], poorSamples, goodSamples, changed: nextIndex !== currentIndex };
}

function setTrackContentHints(stream: MediaStream): void {
  for (const track of stream.getAudioTracks()) {
    try {
      (track as any).contentHint = "speech";
    } catch {
      /* contentHint is best-effort */
    }
  }
  for (const track of stream.getVideoTracks()) {
    try {
      (track as any).contentHint = "motion";
    } catch {
      /* contentHint is best-effort */
    }
  }
}

export interface CallMonitor {
  stop(): void;
  sampleNow(): Promise<void>;
  getProfile(): string;
}

export interface MonitorOptions {
  intervalMs?: number;
  initialProfile?: string;
  onSample?: (sample: CallStatsSample) => void;
  onProfileChange?: (profile: string) => void;
}

export interface VideoCallRuntimeOptions {
  Peer: typeof Peer;
  iceConfigUrl?: string;
  getAccessToken?: () => string;
  fetchImpl?: typeof fetch;
  mediaDevices?: MediaDevices;
  now?: () => number;
  logger?: Pick<Console, "warn" | "debug"> | null;
}

export interface VideoCallRuntime {
  createPeer(id?: string): Promise<Peer>;
  acquireMedia(preferences?: MediaPreferences): Promise<MediaStream>;
  enumerateInputDevices(): Promise<{ audioInputs: MediaDeviceInfo[]; videoInputs: MediaDeviceInfo[] }>;
  applyVideoProfile(call: MediaConnection, profileName: string): Promise<boolean>;
  monitorCall(call: MediaConnection, options?: MonitorOptions): CallMonitor;
  replaceInputTrack(args: {
    call: MediaConnection;
    stream: MediaStream;
    kind: "audio" | "video";
    deviceId?: string;
    facingMode?: "user" | "environment";
  }): Promise<{ track: MediaStreamTrack; settings: MediaTrackSettings }>;
  getInfrastructureStatus(): { managedTurnConfigured: boolean; managedTurnLoaded: boolean };
}

export function createVideoCallRuntime({
  Peer: PeerCtor,
  iceConfigUrl = "",
  getAccessToken = () => "",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  mediaDevices = globalThis.navigator?.mediaDevices,
  now = () => Date.now(),
  logger = globalThis.console,
}: VideoCallRuntimeOptions): VideoCallRuntime {
  let iceCache: IceConfiguration | null = null;
  let iceRequest: Promise<IceConfiguration | null> | null = null;
  let iceRetryAfter = 0;

  async function fetchIceConfiguration(): Promise<IceConfiguration | null> {
    const currentTime = now();
    if (iceCache && currentTime < iceCache.expiresAt - ICE_EXPIRY_SAFETY_MS) return iceCache;
    if (!iceConfigUrl || !fetchImpl || currentTime < iceRetryAfter) return null;
    if (iceRequest) return iceRequest;

    iceRequest = (async () => {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), ICE_FETCH_TIMEOUT_MS) : null;
      try {
        const token = getAccessToken?.() || "";
        const response = await fetchImpl(iceConfigUrl, {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "same-origin",
          signal: controller?.signal,
        });
        if (!response.ok) throw new Error(`ICE configuration returned HTTP ${response.status}`);
        const normalized = normalizeIceConfiguration(await response.json(), currentTime);
        if (!normalized?.hasTurn) throw new Error("ICE configuration did not include a credentialed TURN server");
        iceCache = normalized;
        return iceCache;
      } catch (error) {
        iceRetryAfter = currentTime + ICE_FAILURE_RETRY_MS;
        logger?.warn?.("[video-call] managed TURN unavailable; using PeerJS fallback", (error as Error)?.message || error);
        return null;
      } finally {
        if (timeout) clearTimeout(timeout);
        iceRequest = null;
      }
    })();
    return iceRequest;
  }

  async function createPeer(id?: string): Promise<Peer> {
    if (typeof PeerCtor !== "function") throw new Error("PeerJS is unavailable");
    const ice = await fetchIceConfiguration();
    const options = ice
      ? { config: { iceServers: ice.iceServers, iceCandidatePoolSize: 4, bundlePolicy: "max-bundle" as RTCBundlePolicy } }
      : undefined;
    if (options) return id ? new PeerCtor(id, options) : new PeerCtor(options);
    return id ? new PeerCtor(id) : new PeerCtor();
  }

  async function acquireMedia(preferences: MediaPreferences = {}): Promise<MediaStream> {
    if (!mediaDevices?.getUserMedia) throw new Error("Camera and microphone access is unavailable");
    const stream = await mediaDevices.getUserMedia(buildCallMediaConstraints(preferences));
    setTrackContentHints(stream);
    return stream;
  }

  async function enumerateInputDevices(): Promise<{ audioInputs: MediaDeviceInfo[]; videoInputs: MediaDeviceInfo[] }> {
    if (!mediaDevices?.enumerateDevices) return { audioInputs: [], videoInputs: [] };
    const devices = await mediaDevices.enumerateDevices();
    return {
      audioInputs: devices.filter((device) => device.kind === "audioinput"),
      videoInputs: devices.filter((device) => device.kind === "videoinput"),
    };
  }

  async function applyVideoProfile(call: MediaConnection, profileName: string): Promise<boolean> {
    const pc = call?.peerConnection as RTCPeerConnection | undefined;
    const sender = pc?.getSenders?.().find((candidate) => candidate.track?.kind === "video");
    if (!sender?.setParameters) return false;
    const profile = selectedProfile(profileName);
    try {
      const parameters = sender.getParameters?.() || ({} as RTCRtpSendParameters);
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      parameters.encodings[0] = {
        ...parameters.encodings[0],
        active: true,
        maxBitrate: profile.maxBitrate,
        maxFramerate: profile.frameRate,
        scaleResolutionDownBy: profile.scaleResolutionDownBy,
      };
      parameters.degradationPreference = "maintain-framerate";
      await sender.setParameters(parameters);
      return true;
    } catch (error) {
      logger?.debug?.("[video-call] sender profile not supported", (error as Error)?.message || error);
      return false;
    }
  }

  function monitorCall(
    call: MediaConnection,
    { intervalMs = 3_000, initialProfile = "high", onSample = () => {}, onProfileChange = () => {} }: MonitorOptions = {},
  ): CallMonitor {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let running = false;
    let previousById = new Map<string, any>();
    let profile = selectedProfile(initialProfile).name;
    let counters: AdaptationCounters = { poorSamples: 0, goodSamples: 0 };

    const tick = async (): Promise<void> => {
      if (stopped || running) return;
      const pc = call?.peerConnection as RTCPeerConnection | undefined;
      if (!pc?.getStats) return;
      running = true;
      try {
        const { sample, nextById } = summarizeRtcStats(await pc.getStats(), previousById);
        previousById = nextById;
        sample.connection.state = pc.connectionState || pc.iceConnectionState || "";
        sample.quality = classifyCallQuality(sample);
        const adaptation = nextAdaptiveProfile(profile, sample.quality, counters);
        counters = { poorSamples: adaptation.poorSamples, goodSamples: adaptation.goodSamples };
        if (adaptation.changed) {
          profile = adaptation.profile;
          await applyVideoProfile(call, profile);
          onProfileChange(profile);
        }
        sample.profile = profile;
        onSample(sample);
      } catch (error) {
        logger?.debug?.("[video-call] stats sample failed", (error as Error)?.message || error);
      } finally {
        running = false;
      }
    };

    applyVideoProfile(call, profile).catch(() => {});
    timer = setInterval(tick, Math.max(1_000, intervalMs));
    setTimeout(tick, 500);
    return {
      stop() {
        stopped = true;
        if (timer) clearInterval(timer);
      },
      sampleNow: tick,
      getProfile: () => profile,
    };
  }

  async function replaceInputTrack({
    call,
    stream,
    kind,
    deviceId = "",
    facingMode = "user",
  }: {
    call: MediaConnection;
    stream: MediaStream;
    kind: "audio" | "video";
    deviceId?: string;
    facingMode?: "user" | "environment";
  }): Promise<{ track: MediaStreamTrack; settings: MediaTrackSettings }> {
    if (!mediaDevices?.getUserMedia || !stream || !["audio", "video"].includes(kind)) {
      throw new Error("Cannot switch this call device");
    }
    const preferences: MediaPreferences = kind === "audio" ? { audioDeviceId: deviceId } : { videoDeviceId: deviceId, facingMode };
    const base = buildCallMediaConstraints(preferences);
    const constraints: MediaStreamConstraints =
      kind === "audio" ? { audio: base.audio, video: false } : { audio: false, video: base.video };
    const replacementStream = await mediaDevices.getUserMedia(constraints);
    setTrackContentHints(replacementStream);
    const replacement = kind === "audio" ? replacementStream.getAudioTracks()[0] : replacementStream.getVideoTracks()[0];
    if (!replacement) throw new Error(`No ${kind} input was available`);

    const previous = kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
    replacement.enabled = previous?.enabled ?? true;
    const sender = (call?.peerConnection as RTCPeerConnection | undefined)?.getSenders?.().find(
      (candidate) => candidate.track?.kind === kind,
    );
    try {
      if (sender?.replaceTrack) await sender.replaceTrack(replacement);
      if (previous) {
        stream.removeTrack(previous);
        previous.stop();
      }
      stream.addTrack(replacement);
      return { track: replacement, settings: replacement.getSettings?.() || {} };
    } catch (error) {
      replacement.stop();
      throw error;
    }
  }

  return Object.freeze({
    createPeer,
    acquireMedia,
    enumerateInputDevices,
    applyVideoProfile,
    monitorCall,
    replaceInputTrack,
    getInfrastructureStatus: () => ({
      managedTurnConfigured: !!iceConfigUrl,
      managedTurnLoaded: !!iceCache?.hasTurn,
    }),
  });
}
