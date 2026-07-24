import { useEffect, useRef } from "react";

import type { SeatId } from "./matchTableTypes";
import { windName } from "./matchTableTypes";
import type { RemotePeerState, VideoCallController } from "./useVideoCall";
import "./video-call.css";

// Binds a MediaStream to a <video> imperatively — srcObject is not a
// serialisable attribute, so it has to be set on the element, not via JSX.
function VideoTile({
  stream,
  label,
  muted = false,
  mirror = false,
  placeholder,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  mirror?: boolean;
  placeholder?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    if (stream) {
      void video.play().catch(() => {
        // Autoplay can be blocked until a user gesture; the controls the panel
        // renders count as one, so a later play() attempt succeeds.
      });
    }
  }, [stream]);

  return (
    <div className="video-tile">
      <video
        ref={videoRef}
        className={`video-tile-media${mirror ? " video-tile-mirror" : ""}`}
        autoPlay
        playsInline
        muted={muted}
        aria-label={label}
      />
      {!stream ? <span className="video-tile-placeholder">{placeholder ?? "Connecting…"}</span> : null}
      <span className="video-tile-label">{label}</span>
    </div>
  );
}

export function VideoCallPanel({
  controller,
  humanSeats,
  seatName,
}: {
  controller: VideoCallController;
  humanSeats: SeatId[];
  seatName: (seat: SeatId) => string;
}) {
  const { status, errorMessage, localStream, remotes, micEnabled, camEnabled } = controller;

  if (humanSeats.length === 0) {
    return null;
  }

  if (status === "off") {
    return (
      <div className="video-call video-call-collapsed">
        <button type="button" className="video-call-start" onClick={controller.start}>
          <span aria-hidden="true">📹</span> Video chat
        </button>
      </div>
    );
  }

  return (
    <div className="video-call" role="region" aria-label="Video chat">
      <div className="video-call-tiles">
        <VideoTile stream={localStream} label="You" muted mirror placeholder="Starting camera…" />
        {humanSeats.map((seat) => {
          const remote: RemotePeerState | undefined = remotes[seat];
          return (
            <VideoTile
              key={seat}
              stream={remote?.stream ?? null}
              label={`${seatName(seat)} · ${windName(seat)}`}
              placeholder={status === "live" ? "Ringing…" : "Connecting…"}
            />
          );
        })}
      </div>

      <div className="video-call-controls">
        <button
          type="button"
          className={`video-call-control${micEnabled ? "" : " video-call-control-off"}`}
          onClick={controller.toggleMic}
          aria-pressed={!micEnabled}
          aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
          title={micEnabled ? "Mute" : "Unmute"}
        >
          {micEnabled ? "🎙️" : "🔇"}
        </button>
        <button
          type="button"
          className={`video-call-control${camEnabled ? "" : " video-call-control-off"}`}
          onClick={controller.toggleCam}
          aria-pressed={!camEnabled}
          aria-label={camEnabled ? "Turn camera off" : "Turn camera on"}
          title={camEnabled ? "Camera off" : "Camera on"}
        >
          {camEnabled ? "🎥" : "🚫"}
        </button>
        <button
          type="button"
          className="video-call-control video-call-control-leave"
          onClick={controller.stop}
          aria-label="Leave video chat"
          title="Leave video chat"
        >
          📴
        </button>
      </div>

      {status === "error" ? (
        <p className="video-call-error" role="alert">
          {errorMessage || "Video chat error."}{" "}
          <button type="button" className="video-call-retry" onClick={controller.start}>
            Retry
          </button>
        </p>
      ) : null}
    </div>
  );
}
