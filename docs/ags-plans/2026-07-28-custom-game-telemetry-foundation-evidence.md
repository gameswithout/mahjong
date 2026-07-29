# AGS-Only Custom Game Telemetry Evidence

## Result

The initial custom telemetry slice is **Game-flow integrated** and its AGS
ingestion path is **Smoke-verified**.

The web game now sends custom events directly to AGS Game Telemetry through:

`POST /game-telemetry/v1/protected/events`

No custom telemetry RPC, Extend collector, PostgreSQL outbox, Cloud Save record,
local event file, external warehouse, or third-party analytics destination is
present.

## Player-Facing Triggers

- App load and first interactive render.
- Tab visibility changes.
- Authenticated lobby arrival.
- Optional analytics consent toggle on the sign-in screen.
- Tutorial start, step display/completion/retry/replay, chapter completion,
  skip, and completion.
- Tutorial, Practice, replay-Practice, and Bamboo Quick Play selection.
- Queue entry success/failure.
- Queue p50 and 90-second patience thresholds.
- Practice alternative shown and selected.
- Queue cancel success/failure.
- Matched AGS Session join success/failure.

## AGS Request Evidence

- Source of truth: AccelByte Go SDK v0.87.1
  `spec/gametelemetry.json` and its generated Game Telemetry client.
- Operation:
  `protected_save_events_game_telemetry_v1_protected_events_post`.
- Request:
  `TelemetryBody[]` containing `ClientTimestamp`, `DeviceType`, `EventId`,
  `EventName`, `EventNamespace`, and `Payload`.
- Authentication: the authenticated player's bearer user token.
- Success response: HTTP 204.
- The operation exposes bearer/cookie security and no resource/action client
  permission in `x-security`.

## Live Smoke Evidence

`npm run smoke:telemetry`:

- created a fresh AGS headless guest using the configured Public IAM client;
- submitted one `telemetry_smoke` event to the protected endpoint;
- received HTTP 204;
- correlation ID:
  `telemetry-smoke-9b9bbbc2-455c-408f-abad-26a821e65083`;
- never printed or persisted the user token.
- a production-origin CORS preflight from
  `https://gameswithout.github.io` returned HTTP 200 and allowed `POST`,
  `authorization`, and `content-type`.

Admin readback was attempted separately and returned AGS error 20030,
`data not found: subdomain mismatch`. The CLI profile targets
`gameswithout.prod.gamingservices.accelbyte.io`, while the game targets
`gameswithout-mahjong.prod.gamingservices.accelbyte.io`. This does not invalidate
the protected-ingestion 204, but event-browser/readback visibility remains
unverified until the operator CLI/profile uses the matching subdomain and has
`ADMIN:NAMESPACE:{namespace}:TELEMETRY [READ]`.

## Privacy Evidence

- Optional tutorial and journey events are suppressed before opt-in.
- Withdrawing consent removes queued optional events.
- The client rejects non-contract fields such as `email`.
- Payloads contain no bearer token or caller-supplied player identity.
- AGS associates the user through the request token.
- Only coarse browser family, device class, orientation, locale, and
  locale-derived region are common context.
- Caller event IDs are repeated in `Payload.event_id` because AGS documents
  that `TelemetryBody.EventId` does not replace the server-generated ID.

## Destination Evidence

Repository searches confirm the removed design no longer exists:

- no `/v1/namespaces/{namespace}/telemetry` custom route;
- no `CollectTelemetry` protobuf RPC or service handler;
- no `telemetry_outbox` table or migration;
- no `StoreTelemetryBatch` repository;
- no third-party analytics SDK.

The browser transport has exactly one event destination:

`${ACCELBYTE_BASE_URL}/game-telemetry/v1/protected/events`

## Verification

- `client/telemetry.test.ts`: direct AGS URL, `TelemetryBody[]`, bearer auth,
  consent, privacy rejection, batching, and retry tests passed.
- `client/App.telemetry.test.tsx`: lifecycle and visible consent wiring passed.
- `npm test`: 40 test files and 318 tests passed.
- `npm run build`: TypeScript and Vite production build passed.
- Match-service `go test ./...`: passed after regenerating the protobuf
  surface without the removed collector RPC.
- `git diff --check`: passed.
- `npm run smoke:telemetry`: live AGS HTTP 204 passed.

## Remaining Work

1. Correct or select an AGS CLI profile for the namespace-specific subdomain,
   authenticate an administrator user, and verify the smoke event through
   `game-telemetry events search`.
2. Add authoritative match lifecycle, reconnect/takeover, Jade, XP, error, and
   performance events using the same AGS-only destination.
3. Synchronize optional consent to a player privacy profile where required.
