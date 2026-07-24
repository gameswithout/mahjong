import { useCallback, useEffect, useRef, useState } from "react";
import Peer, { type MediaConnection } from "peerjs";

import type { SeatId } from "./matchTableTypes";
import { createVideoCallRuntime, type CallQuality } from "./videoCall";
import { isInitiator, peerId, seatFromPeerId } from "./videoMesh";

// Mahjong is a 4-player server-authoritative match, not the 2-player PeerJS
// game the chess project reused for its call, so there is no ready-made peer
// link to place a call over. Instead every seat registers a PeerJS peer under a
// deterministic id derived from the shared match id and its own seat (see
// videoMesh) so each client can address the other three with no extra
// signalling channel, and a glare rule keeps each pair to one connection.

const CALL_RETRY_MS = 4_000;
const MAX_CALL_ATTEMPTS = 8;

export type VideoCallStatus = "off" | "starting" | "live" | "error";

export interface RemotePeerState {
  seat: SeatId;
  stream: MediaStream | null;
  quality: CallQuality;
}

export interface VideoCallController {
  status: VideoCallStatus;
  errorMessage: string;
  localStream: MediaStream | null;
  remotes: Record<string, RemotePeerState>;
  micEnabled: boolean;
  camEnabled: boolean;
  start: () => void;
  stop: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
}

/**
 * Drives the peer mesh for one seat. `enabled` gates the whole feature (online
 * human match + the player opted in); `humanSeats` are the other seats holding
 * a real person to connect to. Bots and empty seats are never dialled.
 */
export function useVideoCall({
  matchId,
  localSeat,
  humanSeats,
}: {
  matchId: string;
  localSeat: SeatId;
  humanSeats: SeatId[];
}): VideoCallController {
  const [status, setStatus] = useState<VideoCallStatus>("off");
  const [errorMessage, setErrorMessage] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Record<string, RemotePeerState>>({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);

  const peerRef = useRef<Peer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const callsRef = useRef<Map<SeatId, MediaConnection>>(new Map());
  const attemptsRef = useRef<Map<SeatId, number>>(new Map());
  const retryTimersRef = useRef<Map<SeatId, ReturnType<typeof setTimeout>>>(new Map());
  const runtimeRef = useRef<ReturnType<typeof createVideoCallRuntime> | null>(null);
  const startedRef = useRef(false);
  // Keep the latest human-seat list reachable from stable callbacks without
  // making them dependencies that would tear the mesh down on every re-render.
  const humanSeatsRef = useRef<SeatId[]>(humanSeats);
  humanSeatsRef.current = humanSeats;

  const setRemoteState = useCallback((seat: SeatId, patch: Partial<RemotePeerState>) => {
    setRemotes((current) => {
      const existing: RemotePeerState = current[seat] ?? { seat, stream: null, quality: "connecting" };
      return { ...current, [seat]: { ...existing, ...patch, seat } };
    });
  }, []);

  const clearRetry = useCallback((seat: SeatId) => {
    const timer = retryTimersRef.current.get(seat);
    if (timer) {
      clearTimeout(timer);
      retryTimersRef.current.delete(seat);
    }
  }, []);

  const wireCall = useCallback(
    (seat: SeatId, call: MediaConnection) => {
      callsRef.current.set(seat, call);
      call.on("stream", (remoteStream: MediaStream) => {
        setRemoteState(seat, { stream: remoteStream, quality: "good" });
      });
      call.on("close", () => {
        if (callsRef.current.get(seat) === call) {
          callsRef.current.delete(seat);
          setRemoteState(seat, { stream: null, quality: "connecting" });
        }
      });
      call.on("error", () => {
        if (callsRef.current.get(seat) === call) {
          callsRef.current.delete(seat);
        }
      });
    },
    [setRemoteState],
  );

  // The initiator side dials, retrying until the callee's peer is registered
  // (they may enable video later than us) or the attempt budget runs out.
  const dialSeat = useCallback(
    (seat: SeatId) => {
      const peer = peerRef.current;
      const stream = streamRef.current;
      if (!peer || !stream || callsRef.current.has(seat)) return;
      const attempts = attemptsRef.current.get(seat) ?? 0;
      if (attempts >= MAX_CALL_ATTEMPTS) return;
      attemptsRef.current.set(seat, attempts + 1);

      try {
        const call = peer.call(peerId(matchId, seat), stream);
        if (!call) throw new Error("call not created");
        wireCall(seat, call);
      } catch {
        // Broker/peer not ready yet — fall through to the retry below.
      }

      clearRetry(seat);
      retryTimersRef.current.set(
        seat,
        setTimeout(() => {
          if (!callsRef.current.has(seat)) dialSeat(seat);
        }, CALL_RETRY_MS),
      );
    },
    [matchId, wireCall, clearRetry],
  );

  const teardown = useCallback(() => {
    startedRef.current = false;
    for (const timer of retryTimersRef.current.values()) clearTimeout(timer);
    retryTimersRef.current.clear();
    attemptsRef.current.clear();
    for (const call of callsRef.current.values()) {
      try {
        call.close();
      } catch {
        /* already closed */
      }
    }
    callsRef.current.clear();
    const peer = peerRef.current;
    peerRef.current = null;
    if (peer) {
      try {
        peer.destroy();
      } catch {
        /* already destroyed */
      }
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    setLocalStream(null);
    setRemotes({});
  }, []);

  const start = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus("starting");
    setErrorMessage("");

    const runtime =
      runtimeRef.current ??
      (runtimeRef.current = createVideoCallRuntime({ Peer, mediaDevices: navigator.mediaDevices }));

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await runtime.acquireMedia({ profile: "medium" });
      } catch (error) {
        startedRef.current = false;
        setStatus("error");
        setErrorMessage(
          (error as Error)?.name === "NotAllowedError"
            ? "Camera and microphone permission was denied."
            : "Could not start your camera or microphone.",
        );
        return;
      }
      if (!startedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;
      setLocalStream(stream);
      setMicEnabled(stream.getAudioTracks().every((track) => track.enabled));
      setCamEnabled(stream.getVideoTracks().every((track) => track.enabled));

      let peer: Peer;
      try {
        peer = await runtime.createPeer(peerId(matchId, localSeat));
      } catch {
        teardown();
        setStatus("error");
        setErrorMessage("Video calling is unavailable right now.");
        return;
      }
      if (!startedRef.current) {
        try {
          peer.destroy();
        } catch {
          /* noop */
        }
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      peerRef.current = peer;

      peer.on("open", () => {
        setStatus("live");
        for (const seat of humanSeatsRef.current) {
          if (isInitiator(localSeat, seat)) dialSeat(seat);
        }
      });

      // The callee side: answer with our own stream and read the caller's seat
      // straight off their deterministic peer id.
      peer.on("call", (call: MediaConnection) => {
        const seat = seatFromPeerId(call.peer);
        if (!seat || !streamRef.current) {
          try {
            call.close();
          } catch {
            /* noop */
          }
          return;
        }
        callsRef.current.get(seat)?.close();
        clearRetry(seat);
        call.answer(streamRef.current);
        wireCall(seat, call);
      });

      peer.on("error", (error: { type?: string }) => {
        // peer-unavailable is expected while a partner hasn't joined the call
        // yet; the dial retry loop handles it. Only surface fatal broker errors.
        if (error?.type && ["network", "server-error", "socket-error", "socket-closed"].includes(error.type)) {
          setStatus("error");
          setErrorMessage("Lost connection to the video service.");
        }
      });
    })();
  }, [matchId, localSeat, dialSeat, wireCall, clearRetry, teardown]);

  const stop = useCallback(() => {
    teardown();
    setStatus("off");
    setErrorMessage("");
  }, [teardown]);

  const toggleMic = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !stream.getAudioTracks().every((track) => track.enabled);
    for (const track of stream.getAudioTracks()) track.enabled = next;
    setMicEnabled(next);
  }, []);

  const toggleCam = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !stream.getVideoTracks().every((track) => track.enabled);
    for (const track of stream.getVideoTracks()) track.enabled = next;
    setCamEnabled(next);
  }, []);

  // When a seat's occupant changes (a human disconnects and a bot takes over,
  // or vice versa) prune calls to seats that are no longer human, and dial any
  // newly-human seats we are the initiator for.
  useEffect(() => {
    if (status !== "live") return;
    const humanSet = new Set(humanSeats);
    for (const seat of Array.from(callsRef.current.keys())) {
      if (!humanSet.has(seat)) {
        callsRef.current.get(seat)?.close();
        callsRef.current.delete(seat);
        clearRetry(seat);
        attemptsRef.current.delete(seat);
        setRemotes((current) => {
          const next = { ...current };
          delete next[seat];
          return next;
        });
      }
    }
    for (const seat of humanSeats) {
      if (isInitiator(localSeat, seat) && !callsRef.current.has(seat)) {
        attemptsRef.current.set(seat, 0);
        dialSeat(seat);
      }
    }
  }, [status, humanSeats, localSeat, dialSeat, clearRetry]);

  // Tear the mesh down if the match identity changes or the component unmounts.
  useEffect(() => {
    return () => {
      teardown();
    };
  }, [matchId, localSeat, teardown]);

  return { status, errorMessage, localStream, remotes, micEnabled, camEnabled, start, stop, toggleMic, toggleCam };
}
