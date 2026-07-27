# P2.1 Basic XP and Levels

- Date: 2026-07-27
- Approved feature: P2.1 Basic XP and level presentation
- Approval: the user selected item 3 from the recommended next-work list

## Confirmed context

- The browser already signs players in through AGS IAM and plays AI Practice
  or public human Quick Play through the Mahjong Extend service.
- Canonical match commands and results are persisted in PostgreSQL before they
  are acknowledged.
- The result screen, lobby header, and three-chapter tutorial are already
  player-facing React flows.
- The configured AGS CLI target is Shared Cloud namespace
  `gameswithout-mahjong`, but its client-credentials token is expired and no
  client secret is available locally. Live Statistics, entitlement, and
  permission discovery therefore cannot be verified in this slice.

## Goal

Award the exact Section 12.1 XP for currently playable modes, derive the
Section 12.2 level curve, persist onboarding completion or intentional skip,
and make progress visible in the lobby, hand result, and a complete reward
track.

## Non-goals

- P2.2 achievements, missions, ratings, leaderboards, or competitive
  progression.
- Full Rotation and private-match XP before those player modes exist.
- Equipping level cosmetics from the progression screen.
- Creating or mutating AGS Statistics, catalog, entitlement, or IAM resources
  without authenticated permission discovery.

## Affected areas

- `mahjong-match-service/pkg/progression`
- `mahjong-match-service/pkg/storage`
- `mahjong-match-service/pkg/service`
- `mahjong-match-service/pkg/proto/service.proto`
- `protocol/envelope.ts`
- `client/App.tsx`
- tutorial, lobby, result, progression client, components, styles, and tests

## AGS modules

- IAM: existing browser user token; no auth-flow change.
- Extend Service Extension: authoritative award and read APIs.
- Statistics: intended native long-term projection for lifetime XP.
- Store/Entitlements: intended native long-term projection for earned
  cosmetics.

## Service selection

The first-party append-only XP event ledger is the immediate authority because
the award depends on canonical match events, idempotency IDs, takeover
duration, and a transactionally enforced UTC-day cap. PostgreSQL also records
monotonic reward grants so a curve change can add but never revoke a reward.

AGS Statistics and Entitlements remain the intended external projections.
They are not silently emulated with Cloud Save, and no unverified SDK calls or
permission strings are added while live discovery is blocked. A later mirror
must publish from the durable award/reward records and prove update/readback
against configured AGS resources.

## Authorization plan

- Caller: browser for progression reads/onboarding intent; backend service for
  authoritative match awards and future AGS projection.
- Environment: Shared Cloud, inferred from
  `https://gameswithout.prod.gamingservices.accelbyte.io`.
- Token source: existing user access token for browser-to-Extend calls;
  service token for future Statistics/Entitlement projection.
- IAM client type: existing public browser client; future backend projection
  requires the configured confidential service client.
- AGS calls in this slice: none beyond existing IAM and Extend traffic.
- Permission discovery: blocked because `ags auth status` reports an expired
  token and no client secret.
- Required permissions: not claimed or invented.
- Verified access: no for new native Statistics/Entitlement resources; not
  required for local Extend implementation.

## Implementation steps

1. Price each completed supported-mode hand from the authoritative result and
   immutable match history.
2. Persist award details by event ID, enforce Practice caps while holding the
   player row lock, and return the originally persisted award on every repeat
   projection.
3. Persist completed/skipped onboarding state and its one-time 500 XP award.
4. Persist monotonic level reward grants and return all 50 level thresholds.
5. Add the authenticated progression API client and normalize match XP data.
6. Show level progress in the lobby, XP breakdown after a hand, onboarding
   state in the tutorial card, and the complete progression track.

## Verification

- Pure Go award/curve tests.
- Service and API contract tests.
- PostgreSQL integration tests for idempotency, cap concurrency, onboarding
  transitions, immutable awards, and non-revoking rewards.
- Progression client and React component tests.
- Existing frontend, rules-engine, Extend service, build, and `git diff
  --check` suites.

## Risks and open questions

- AGS Statistics and entitlement mirroring cannot be smoke-verified until the
  CLI or MCP session is reauthenticated and the native resources and
  confidential-client permissions are discovered.
- XP is implemented only for modes the product can currently complete:
  AI Practice and public human Quick Play.

## Deferred Requested Integrations

- [ ] AGS Statistics lifetime-XP projection with update/readback evidence.
- [ ] AGS entitlement grants for level cosmetics with catalog evidence.
- [ ] P2.2 statistic-backed and event-derived achievements.
- [ ] Full Rotation placement XP and private-match daily caps when those modes
      become playable.

## Next step

Implement and validate the local end-to-end player flow, then publish the
feature branch to `main` only after all database and UI evidence is green.
