import type { SeatId } from "./matchTableTypes";

// Pure addressing/glare logic for the video mesh, kept free of the peerjs
// import so it stays unit-testable without a browser RTCPeerConnection.

export const SEAT_ORDER: SeatId[] = ["E", "S", "W", "N"];

// Every seat registers a PeerJS peer under a deterministic id built from the
// shared match id and its own seat, so each client can address the other three
// with no extra signalling. PeerJS ids ride in URLs, so strip the match id down
// to the broker-safe [A-Za-z0-9] set.
export function peerId(matchId: string, seat: SeatId): string {
  const safeMatch = matchId.replace(/[^A-Za-z0-9]/g, "");
  return `mahjong-${safeMatch}-${seat}`;
}

export function seatFromPeerId(id: string): SeatId | null {
  const suffix = id.split("-").pop();
  return SEAT_ORDER.includes(suffix as SeatId) ? (suffix as SeatId) : null;
}

// Glare rule: the seat earlier in turn order dials, the later one answers, so
// each human pair opens exactly one media connection instead of two.
export function isInitiator(local: SeatId, target: SeatId): boolean {
  return SEAT_ORDER.indexOf(local) < SEAT_ORDER.indexOf(target);
}
