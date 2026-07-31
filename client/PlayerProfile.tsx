import { useState } from "react";

import { TileFace } from "./TileFace";
import {
  MAX_PROFILE_NICKNAME_LENGTH,
  PROFILE_TILE_OPTIONS,
  type PlayerProfileConfig,
} from "./player-profile";

export function PlayerProfileBadge({
  profile,
  className = "",
}: {
  profile: PlayerProfileConfig;
  className?: string;
}) {
  return (
    <div className={`player-profile-badge ${className}`.trim()}>
      <span className="profile-icon-row">
        {profile.tileSlotIds.map((tileId, index) => (
          <span
            className="profile-tile-icon"
            key={`${tileId}-${index}`}
            aria-label={`Profile slot ${index + 1}`}
          >
            <TileFace id={tileId} size="sm" />
          </span>
        ))}
      </span>
      <span className="profile-nickname">{profile.nickname}</span>
    </div>
  );
}

type ProfileSlot = 0 | 1 | 2;

function tileForSlot(profile: PlayerProfileConfig, slot: ProfileSlot): string {
  return profile.tileSlotIds[slot];
}

function updateSlot(
  profile: PlayerProfileConfig,
  slot: ProfileSlot,
  tileId: string,
): PlayerProfileConfig {
  const tileSlotIds: [string, string, string] = [...profile.tileSlotIds];
  tileSlotIds[slot] = tileId;
  return { ...profile, tileSlotIds };
}

export function PlayerProfileEditor({
  profile,
  guest,
  onChange,
}: {
  profile: PlayerProfileConfig;
  guest: boolean;
  onChange: (profile: PlayerProfileConfig) => void;
}) {
  const [activeSlot, setActiveSlot] = useState<ProfileSlot>(0);
  const slots: { id: ProfileSlot; label: string }[] = [
    { id: 0, label: "Slot 1" },
    { id: 1, label: "Slot 2" },
    { id: 2, label: "Slot 3" },
  ];

  return (
    <section className="profile-editor" aria-labelledby="profile-editor-title">
      <div className="profile-editor-heading">
        <div>
          <p className="status-label">Player profile</p>
          <h2 id="profile-editor-title">Personalize your player profile</h2>
        </div>
      </div>

      <label className="profile-nickname-field">
        Nickname
        <input
          type="text"
          maxLength={MAX_PROFILE_NICKNAME_LENGTH}
          value={profile.nickname}
          disabled={guest}
          onChange={(event) => onChange({ ...profile, nickname: event.target.value })}
        />
      </label>

      <div className="profile-slot-picker" role="tablist" aria-label="Profile icon slot">
        {slots.map((slot) => (
          <button
            key={slot.id}
            type="button"
            role="tab"
            aria-selected={activeSlot === slot.id}
            className={activeSlot === slot.id ? "profile-slot-active" : ""}
            onClick={() => setActiveSlot(slot.id)}
          >
            <span className="profile-tile-icon" aria-hidden="true">
              <TileFace id={tileForSlot(profile, slot.id)} size="sm" />
            </span>
            {slot.label}
          </button>
        ))}
      </div>

      <div className="profile-tile-picker" aria-label={`Choose slot ${activeSlot + 1} tile`}>
        {PROFILE_TILE_OPTIONS.map((option) => {
          const selected = tileForSlot(profile, activeSlot) === option.id;
          return (
            <button
              type="button"
              key={option.id}
              className={selected ? "profile-tile-option-selected" : ""}
              aria-label={`Use ${option.label} for slot ${activeSlot + 1}`}
              aria-pressed={selected}
              title={option.label}
              onClick={() => onChange(updateSlot(profile, activeSlot, option.id))}
            >
              <TileFace id={option.id} size="sm" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
