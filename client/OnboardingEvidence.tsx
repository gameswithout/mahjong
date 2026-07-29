import type { JadeAccount, PlayerProgression } from "../protocol/envelope";
import { LobbyHeader } from "./LobbyHeader";
import { LockedTiers } from "./LockedTiers";
import { PracticeLaunchCard } from "./PracticeLaunchCard";
import { playableTier, tierSummary } from "./lobby-tiers";
import { defaultPlayerProfile } from "./player-profile";
import {
  queueElapsedLabel,
  queueHealth,
  queueHealthMessage,
} from "./queue-health";
import { TutorialScreen } from "./tutorial/TutorialScreen";

export type OnboardingEvidenceScenario =
  | "lobby"
  | "queue-normal"
  | "queue-slow"
  | "tutorial";

const EVIDENCE_ACCOUNT: JadeAccount = {
  currency_code: "JADE",
  balance: 12_480,
  reserved: 0,
  available: 12_480,
  eligible: true,
  minimum_balance: 1_000,
  stake_per_tai: 10,
  debit_cap: 300,
  wallet_sync_status: "synced",
  welfare_eligible: false,
  welfare_amount: 0,
  welfare_reason: "balance_sufficient",
};

const EVIDENCE_PROGRESSION: PlayerProgression = {
  level: 4,
  lifetime_xp: 1_850,
  xp_into_level: 350,
  xp_for_next_level: 750,
  at_cap: false,
};

const QUEUE_ELAPSED_MS = {
  "queue-normal": 45_000,
  "queue-slow": 95_000,
} as const;

function QueueState({ elapsedMs }: { elapsedMs: number }) {
  const health = queueHealth(elapsedMs);
  return (
    <div
      className={`matchmaking-result queue-panel queue-${health}`}
      role="status"
      aria-live="polite"
      data-testid="queue-state"
    >
      <p className="queue-message">{queueHealthMessage(health)}</p>
      <p className="queue-elapsed">{queueElapsedLabel(elapsedMs)}</p>
      {health === "slow" ? (
        <div className="queue-alternatives">
          <p className="session-detail">
            You can keep waiting, or play a Practice hand now instead.
          </p>
          <button className="secondary-action session-action" type="button">
            Practice instead
          </button>
        </div>
      ) : null}
      <button className="secondary-action session-action" type="button">
        Cancel
      </button>
      <p className="session-detail queue-ticket">Ticket: 2e8f4d10…7c31</p>
    </div>
  );
}

function LobbySurface({
  scenario,
}: {
  scenario: Exclude<OnboardingEvidenceScenario, "tutorial">;
}) {
  const queueElapsedMs =
    scenario === "lobby" ? null : QUEUE_ELAPSED_MS[scenario];
  return (
    <main className="bootstrap-shell onboarding-evidence-shell">
      <section
        className="bootstrap-card onboarding-evidence-card"
        aria-labelledby="onboarding-evidence-title"
      >
        <p className="eyebrow">Mahjong Online</p>
        <h1 id="onboarding-evidence-title">Play a hand with friends.</h1>
        <p className="intro">
          Choose a safe Practice hand, learn the basics, or join one live Bamboo
          Courtyard hand.
        </p>

        <div className="success-panel">
          <LobbyHeader
            guest
            account={EVIDENCE_ACCOUNT}
            jadeStatus="ready"
            connection="connected"
            progression={EVIDENCE_PROGRESSION}
            progressionStatus="ready"
            profile={defaultPlayerProfile(true)}
          />

          <div className="session-panel">
            <section className="tutorial-card" aria-labelledby="tutorial-title">
              <p className="status-label">Learn</p>
              <h2 id="tutorial-title">How to play</h2>
              <p className="practice-description">
                Learn turns, winning shapes, claim words, and Tai on the real
                table. Your first completion or intentional skip awards 500 XP.
              </p>
              <button className="secondary-action session-action" type="button">
                Start the tutorial
              </button>
            </section>

            <PracticeLaunchCard
              busy={false}
              hasSelectedSession={false}
              matchServiceAvailable
              onStart={() => undefined}
            />

            <section
              className="matchmaking-panel online-card"
              aria-labelledby="online-title"
            >
              <p className="status-label">Quick Play</p>
              <h2 id="online-title">{playableTier().name}</h2>
              <p className="practice-description">
                One live hand against three humans · about 8 to 15 minutes.
              </p>
              <p className="practice-description">
                {tierSummary(playableTier())}
              </p>
              <div className="jade-balance" data-testid="jade-balance">
                <p>
                  <strong>{EVIDENCE_ACCOUNT.available.toLocaleString()}</strong>{" "}
                  Jade available
                </p>
              </div>

              {queueElapsedMs === null ? (
                <button className="primary-action session-action" type="button">
                  Find a table
                </button>
              ) : (
                <QueueState elapsedMs={queueElapsedMs} />
              )}
            </section>

            <LockedTiers />
          </div>
        </div>
      </section>
    </main>
  );
}

export function OnboardingEvidence({
  scenario,
}: {
  scenario: OnboardingEvidenceScenario;
}) {
  if (scenario === "tutorial") {
    return <TutorialScreen onExit={() => undefined} />;
  }
  return <LobbySurface scenario={scenario} />;
}
