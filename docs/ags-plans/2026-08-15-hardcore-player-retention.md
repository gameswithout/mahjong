# Hardcore player retention suite — integration plan

- Date: 2026-08-15
- Approved feature: the six highest-priority improvements from the completed playtest
- Approval: the user explicitly requested implementation of all six items

## Confirmed context

- React 19 / TypeScript browser game using AGS Web SDK 4.3.2.
- IAM, Lobby, Session, Matchmaking, Statistics, and the authoritative match service are already integrated.
- A dedicated `mahjong-full-rotation-pool` and multi-hand runtime already exist.
- Practice hands already enter the authoritative XP ledger and Match History, but currently award 0 XP.
- The server already projects legal waits and visible remaining copies without revealing concealed opponent information.
- Player preferences use private Cloud Save with a local cache.

## Goal

Expose serious match formats, make Practice persistently useful, add public-information analysis during and after play, and let experienced players control table pacing.

## Non-goals

- No client-authoritative Jade, rating, achievement, or competitive result changes.
- No opponent concealed-hand inference during live play.
- No new AGS namespace resources or IAM permission changes.
- No automated “best discard” or action that plays strategic decisions for the user.

## Affected areas

- Lobby mode cards and Full Rotation entry.
- Match service Practice XP calculation and history.
- Match table expert analysis and pacing preferences.
- Exhaustive-draw and deal-in result analysis.
- Settings, localization, styles, and focused tests.

## AGS modules

- Existing IAM player token flow.
- Existing Matchmaking and Session flow for Quick Play and Full Rotation.
- Existing match-service progression ledger and Match History endpoint.
- Existing private Cloud Save record for preferences.

## Service selection

- Match format remains AGS Matchmaking + Session; the dedicated rotation pool is reused.
- Practice XP and history remain server-authoritative in the match-service ledger.
- Preferences remain Cloud Save because they are private, noncompetitive UI settings.
- AGS Statistics remains the public/competitive source; Practice does not update it.

## Authorization plan

- Caller: browser game client plus existing authoritative match service.
- Token source: player access token in the browser; existing server token in the match service.
- IAM clients: existing public web client and existing confidential service client.
- AGS calls: no new calls; existing Session, Matchmaking, settings, progression, and history paths only.
- Permission discovery: not required for this local-only change because no API operation or resource is added.
- Verified access: existing integration tests and local player-flow verification.

## Implementation steps

1. Expose Quick Hand and Full Rotation as explicit lobby formats, retaining the linked-account gate.
2. Award 25 Practice Mastery XP per completed hand, capped at 100 XP per UTC day, while keeping Practice out of rating, Jade, public statistics, and achievements.
3. Persist and display Practice history and refresh it immediately after a completed hand.
4. Add an optional Expert HUD with waits, visible-copy counts, public danger signals, and visible-tile counts.
5. Add exhaustive-draw tenpai/wait analysis and discard-win decision review using only end-state/public data.
6. Add Fast/Normal bot pacing, auto-pass preferences, compact claim prompts, and claim-impact previews.
7. Run focused unit/component tests, Go tests, production build, and an end-to-end browser pass.

## Verification

- Focused Vitest coverage for lobby modes, settings, MatchTable, result analysis, and Practice flow.
- Go progression/storage tests for daily cap and history.
- `npm run build`, client tests, and relevant Go suites.
- Browser verification of the deterministic table/result harnesses; lobby,
  Practice, rotation-pool routing, and history refresh through component-flow tests.

## Risks and controls

- Daily Practice XP races: use the authoritative ledger’s UTC-day total and idempotent award ID.
- Expert aids leaking hidden information: derive only from own hand, discards, exposed melds, and server-projected waits.
- Full Rotation accidentally touching Jade: retain the existing no-Jade path and regression tests.
- Auto-pass submitting twice: key it to the authoritative discard/claim identity.
- Preference migration: normalize all new fields with safe defaults.

## Deferred requested integrations

- None. All six requested improvements are included.

## Completion evidence

- `npm test`: 56 files and 488 tests passed.
- `npm run build`: TypeScript and production Vite build passed.
- Root and match-service `go test ./...`: passed.
- Generated protobuf, gRPC, and OpenAPI artifacts from the updated contract.
- 640×360 table validator: no overflow, clipping, runtime, or touch-target failures.
- Five desktop/compact result scenarios: no missing copy, horizontal overflow, or runtime failures.
- No live AGS resources, IAM permissions, or namespace configuration were mutated.
