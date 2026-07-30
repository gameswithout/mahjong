# P2.2 Player Achievement Experience

- Date: 2026-07-29
- Approved feature: finish P2.2 with exact achievement progress, eligibility,
  a complete launch catalog, and post-hand unlock presentation
- Approval: the user selected P2.2 and replied “proceed”
- Status: implementation, verification, and production release complete

## Confirmed context

- The client is a React/Vite web game.
- Browser players authenticate with the existing Public IAM client and a user
  access token.
- The browser already calls the match-service gateway for progression and
  Statistics because those reads belong behind the authenticated service
  boundary.
- The match service is an Extend Service Extension using a platform-managed
  Confidential client and server token.
- Eighteen AGS Statistics counters and 23 statistic-backed launch achievements
  are live.
- The match service already calls AGS
  `AdminListUserAchievementsShort`, pays achievement XP idempotently, and
  projects newly paid awards in `MatchState.achievements`.
- Nine of the 32 launch achievements are not configured because five lack
  canonical counters and four require Full Rotation.
- The client now normalizes and retains `MatchState.achievements`, renders
  public-hand unlocks, and exposes the full catalog from Progress.

## Goal

Give every authenticated player a truthful P2.2 experience:

1. Show all 32 launch achievements.
2. Show exact current value and goal for every earnable achievement.
3. Label the nine unavailable achievements and explain why they are not
   currently eligible.
4. Explain that Practice does not advance achievements.
5. Celebrate achievements unlocked by the completed public hand and retain the
   celebration across result-screen polling.

## Non-goals

- Creating or changing AGS achievement or Statistic configurations.
- Adding the five missing gameplay counters.
- Implementing Full Rotation or its four achievements.
- Retroactive event-log backfill.
- Achievement icons, missions, rating, leaderboards, or entitlement rewards.
- Changing IAM clients, login behavior, or authentication storage.

## Affected areas

- `mahjong-match-service/pkg/progression`: launch catalog and AGS player
  progress reads.
- `mahjong-match-service/pkg/proto/service.proto`: authenticated
  `GetPlayerAchievements` contract.
- `mahjong-match-service/pkg/service`: caller-only endpoint and projections.
- Generated protobuf, gateway, and OpenAPI artifacts.
- `protocol/envelope.ts` and `client/match-runtime.ts`: result unlock transport.
- Achievement client and screen in the existing progression surface, plus
  `App.tsx`, progression navigation, styles, and tests.
- P2.2 backlog and deployment evidence after verification.

## AGS modules

- Achievements: native definitions, player progress, and unlock status.
- Statistics: existing authoritative source counters; no new Statistics work.
- IAM: existing inbound player-token validation and outbound service token;
  unchanged.

## Service Selection

- Chosen: AGS Achievements for configured achievement state and exact
  `latestValue`; the local product catalog supplies the fixed launch order,
  goals, rewards, and honest unavailable entries.
- Rejected: Cloud Save. Achievement progress is native AGS state, not generic
  save data.
- Rejected: browser-direct AGS calls. The existing server boundary prevents
  CORS drift, keeps the caller pinned to their own user ID, and reuses the
  confidential integration already used for XP.
- Rejected: a second PostgreSQL achievement-progress table. It would duplicate
  AGS and could disagree with the unlock authority.

## Authorization Plan

### Browser to match service

- Caller: web game.
- Token source: authenticated player user access token.
- IAM client type: Public.
- Call: `GET /v1/namespaces/{namespace}/achievements`.
- Identity: derived from the validated bearer token; no `user_id` request
  field.
- Required AGS permission: none added; this is the existing custom
  bearer-validated service boundary.
- Verified access: the same bearer path is live for progression and
  Statistics.

### Match service to AGS

- Caller: backend Service Extension.
- Environment: AGS Shared Cloud.
- Token source: service/server token.
- IAM client type: Confidential, platform-managed client
  `72498bf13af54deabafdcba90d1ce497`; secret remains in Extend configuration.
- Call:
  `GET /achievement/v1/admin/namespaces/{namespace}/users/{userId}/achievements`
  through `AdminListUserAchievementsShort`.
- Required permission:
  `ADMIN:NAMESPACE:{namespace}:USER:{userId}:ACHIEVEMENT [READ]`.
- Shared Cloud group: not exposed by the current CLI permission-catalog path;
  no group is guessed.
- Verified access: yes. The deployed achievement-XP sweep already executes
  this exact call and the four-account production hand observed unlocks and
  paid their XP.

## Player flow

- Trigger: Lobby → Progress → Achievements.
- Loading: visible polite status.
- Success: catalog summary followed by earnable and unavailable achievements,
  each with explicit status and counts.
- Error: stable message, retry action, and Back action.
- Completion: Back returns to Progress; Back there returns to the lobby.
- Result trigger: automatic after a completed non-Practice hand when the server
  reports newly paid achievement awards.
- Practice: catalog remains visible, but explains that only public play
  advances it; no Practice result can display an unlock.

## Implementation steps

1. Expand the product achievement catalog to all 32 entries while keeping the
   23-entry XP reward map restricted to configured achievements.
2. Extend the AGS reader to return per-code latest values and unlock status,
   then merge it with the catalog in the progression coordinator.
3. Add and generate the authenticated `GetPlayerAchievements` API and cover
   identity, namespace, ordering, exact values, and unavailable entries.
4. Add the browser client, screen, Progress navigation, loading/error states,
   and responsive/accessibility styles.
5. Normalize `MatchState.achievements`, retain awards across later empty polls,
   and render the result unlock celebration.
6. Update P2.2 documentation and add unit, contract, component, and integration
   regression tests.

## Verification

- `make test`: passed; all root and match-service Go packages passed with the
  race detector where configured, and all 396 client tests passed.
- `npm run build`: passed with the production Vite bundle.
- Protobuf, gateway, OpenAPI, caller-identity, and no-user-ID contract checks:
  passed.
- Rendered Chromium verification: 32 cards, 23 available progress bars, nine
  unavailable cards, named Back action, and no horizontal overflow at 1280×720
  or 390×844.
- Rendered result verification: two simultaneous unlock cards remained
  readable beside settlement and XP with no horizontal overflow.
- Authenticated live service read and production deployment health: passed;
  the release evidence is recorded below.

## Risks and open questions

- AGS unlock evaluation is asynchronous. Result awards must be accumulated by
  award ID so a later empty poll cannot erase the celebration.
- AGS may omit untouched progress rows. Missing configured rows must display
  zero, not disappear.
- The nine unavailable entries must remain visible without implying they can
  currently unlock.
- Integer product goals are merged with AGS floating-point latest values;
  non-finite and negative values are clamped safely.
- Live verification may need an already authenticated player with existing
  progress; zero progress is still valid service evidence.

## Implementation outcome

- The service merges AGS `latestValue` and unlock state with the complete
  catalog without accepting a caller-supplied player ID.
- Missing AGS rows resolve to exact zero. Duplicate rows merge
  conservatively, and invalid negative/non-finite progress is clamped.
- The 23 configured entries remain the only achievement XP reward map; the
  nine unavailable entries cannot accidentally pay.
- Result unlocks are deduplicated by award ID and retained across later
  same-match polls that omit the one-shot award.
- The browser wireframe uses the production components for desktop and compact
  rendered review.

## Release

- Branch: `agent/p2-2-achievement-experience-v2`
- Production target: Extend app `mahjong-match-service` in namespace
  `gameswithout-mahjong`.
- Deployed image: `p2-2-achievements-94508d7`, deployment
  `69c9da91-31ef-42d6-9fbd-3668f17d32df`, active since
  `2026-07-30T13:25:23.392Z`.
- Extend readback reports `deployment-running` on that exact image.
- The live OpenAPI path set matches the source tree and includes
  `/v1/namespaces/{namespace}/achievements`.
- The live endpoint returns `401` without a token rather than `404`, proving
  the new route is present and enforcing caller authentication. Its
  browser-origin CORS preflight returns `204`.
- An authenticated read with a stable zero-progress verification identity
  returned `200` with 32 unique entries: 23 eligible, nine unavailable, and
  an explicit reason for every unavailable entry.

## Deferred Requested Integrations

- [ ] Claim Student/Scholar canonical claim counters.
- [ ] Ready Regular/Veteran “reached Ting” counters.
- [ ] Stone Wall no-deal-in streak tracking.
- [ ] Full Rotation mode and its four achievements.
- [ ] Historical achievement-progress backfill.
- [ ] Achievement icons and entitlement/cosmetic grants.
