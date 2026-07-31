# Full Rotation player flow — integration plan

- Date: 2026-07-30
- Namespace: `gameswithout-mahjong`
- Feature: public ranked Full Rotation (§8.4)
- Goal: make the already-built rotation runtime enterable, honest, and
  recoverable through the production player journey.

## Scope

The release owns the dedicated AGS matchmaking configuration, linked-account
entry gate, queue lifecycle, Session handoff, multi-hand runtime timing,
inter-hand/final UI, no-Jade invariant, requeue behavior, and completion
telemetry.

P2.4 Elo, the seasonal leaderboard, persisted placement statistics, and the
four rotation achievement counters are follow-up progression integrations.
Private Full Rotation is also out of scope.

## Services and ownership

| Area | Owner | Integration |
| --- | --- | --- |
| Identity | AGS IAM | Browser public client and player token; the client uses the current-user record to distinguish headless Guest from linked account |
| Queue | AGS Matchmaking | `mahjong-full-rotation-pool`, reusing the proven four-player ruleset |
| Game Session | AGS Session | `mahjong-full-rotation`, mirroring Quick Play except for name and `full_rotation: true` |
| Match runtime | AGS Extend | Existing `mahjong-match-service`; Session attribute selects the rotation container |
| Progression | Extend + AGS Statistics | Existing idempotent hand/placement XP; Elo and placement statistics deferred to P2.4 |
| Analytics | AGS Game Telemetry | Mode-aware hand completion plus one privacy-safe rotation completion event |

## Authorization plan

- Browser calls use the public web OAuth client and the signed-in player's
  bearer token. No client secret is shipped.
- Extend uses its injected confidential client and existing Session READ
  permission to resolve the fixed four-player roster and template attributes.
- Operator configuration uses an AGS CLI authorization-code session.
- Required operator permissions:
  - `ADMIN:NAMESPACE:{namespace}:SESSION:CONFIGURATION [READ, CREATE]`
  - `NAMESPACE:{namespace}:MATCHMAKING:POOL [READ, CREATE]`
- Guest accounts see no Full Rotation queue action; a defensive function guard
  also rejects a replayed/programmatic UI call. Server-authoritative ranked
  standing and good-standing enforcement belongs with P2.4 rating writes.

## Implementation sequence

1. Mirror the working Quick Play Session template, changing only its name and
   `full_rotation` attribute.
2. Mirror the working Quick Play pool and point it at the new template.
3. Forward `ACCELBYTE_ROTATION_MATCH_POOL` into the production Pages build.
4. Track the selected queue mode across create, poll, cancel, join, retry, and
   post-result requeue.
5. Keep every Full Rotation branch out of Jade reserve/release/settlement.
6. Apply ranked 12-second turn and 5-second interception deadlines to new
   rotation hands; keep Bamboo at 15/10 and Practice untimed.
7. Lock the lobby entry for Guest accounts and test both guest and linked
   account paths.
8. Emit mode-correct hand analytics and one rotation completion event.
9. Run client, rules-engine, service, production-build, live AGS resource, and
   deployed-service verification.

## Risks and controls

- A copied template can drift silently. Resource creation derives from Quick
  Play rather than guessing required fields, and live GET verifies the result.
- A single global queue state can cancel in the wrong pool. The selected mode
  is retained for the whole lifecycle and tests assert every client
  construction uses the rotation pool.
- Reusing Quick Play requeue can reserve Jade. Tests assert reserve, release,
  stake copy, and extra Jade reads are absent from rotation requeue/cancel.
- A generic engine default can violate ranked timing. A server unit test pins
  both public presets at actor creation.
- Live linked test accounts are not stored in the repository. The player-facing
  linked/Guest distinction is verified locally; live service verification may
  use isolated disposable Guest identities only to exercise infrastructure,
  explicitly bypassing (and not claiming to verify) the UI eligibility gate.
