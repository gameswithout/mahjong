# AGS-Only Custom Game Telemetry

## Approved Feature

Send the first production-shaped set of custom Mahjong events directly to AGS
Game Telemetry. AGS is the sole telemetry destination.

The user's instruction to "start implementing custom telemetry events" and
"make sure they are sent to AGS telemetry only" approves this revision of the
existing Game Flow Plan.

## Confirmed Context

- The web client authenticates players through AGS IAM and can read the current
  player's user access token.
- The active project and CLI both target the Shared Cloud namespace
  `gameswithout-mahjong`.
- `ags auth status` reports a valid session.
- Live CLI discovery exposes the admin event-search operation but not protected
  event ingestion.
- The official AccelByte Go SDK v0.87.1 OpenAPI specification and generated
  client expose:
  `POST /game-telemetry/v1/protected/events`.
- The protected operation accepts an array of `TelemetryBody`, uses a bearer or
  cookie user token, returns HTTP 204 on success, and has no resource/action
  client permission in its OpenAPI `x-security` metadata.
- Nineteen initial custom event names and their player-facing triggers have
  already been implemented locally.

## Goal

Emit privacy-safe, consent-aware custom events from the authenticated web game
directly into AGS Game Telemetry. Keep gameplay non-blocking when telemetry is
unavailable and retain a bounded in-memory retry queue only for the active tab.

## Non-Goals

- Persisting telemetry events in PostgreSQL, Cloud Save, local files, another
  warehouse, or a third-party analytics service.
- Adding a custom Extend telemetry collector or publisher.
- Duplicating AGS-native IAM, matchmaking, Session, or wallet events.
- Collecting raw email, full IP address, date of birth, access tokens, display
  names, free text, full user-agent strings, opponent identities, concealed
  tiles, claim choices, or wall contents.
- Advertising, fingerprinting, or session replay.
- Instrumenting every authoritative match transition in this first slice.

## Affected Areas

- `client/telemetry.ts`: strict schema, consent, bounded batching/retry, and the
  official AGS protected-event transport.
- `client/App.tsx`: lifecycle, lobby, tutorial, Practice, queue, and Session
  join triggers.
- `client/tutorial/analytics.ts`: live telemetry sink documentation.
- Client tests for consent, batching, privacy rejection, retry, AGS request
  shape, and visible UI wiring.
- Removal of the custom protobuf collector, match-service handler, PostgreSQL
  outbox migration, repository, and generated API surface.

## AGS Modules

- IAM supplies the player's user access token.
- Game Telemetry accepts the custom event batch.

## Service Selection

AGS Game Telemetry is the purpose-built and exclusive event destination.
PostgreSQL, Cloud Save, Extend Event Handler, and external analytics services
are rejected because the user explicitly requires AGS-only telemetry.

## Authorization Preflight

  Caller:                web game client
  Environment:           shared cloud
  Environment evidence:  `.env` and `ags auth status` target `gameswithout-mahjong.prod.gamingservices.accelbyte.io`
  Token source:          authenticated player's user access token
  IAM client type:       public
  Secret location:       none
  AGS calls:             `POST /game-telemetry/v1/protected/events`
  Permission discovery:  official v0.87.1 AGS SDK OpenAPI and generated client; operation is absent from CLI catalogue
  Required permissions:  bearer user authentication; no resource/action permission exposed by the operation
  Shared Cloud groups:   none required for protected event ingestion
  Verified access:       yes — a fresh guest user token received HTTP 204

Admin readback is a separate trusted-tool operation:
`GET /game-telemetry/v1/admin/namespaces/{namespace}/events`, requiring
`ADMIN:NAMESPACE:{namespace}:TELEMETRY [READ]`. The current CLI uses
`https://gameswithout.prod.gamingservices.accelbyte.io`, while the game uses
`https://gameswithout-mahjong.prod.gamingservices.accelbyte.io`; the readback
attempt returned error 20030, `data not found: subdomain mismatch`. Readback is
therefore not part of the verified game-client authorization path.

## Event Contract

Each AGS `TelemetryBody` contains:

- `EventName`: the allowlisted custom event name;
- `EventNamespace`: `gameswithout-mahjong`;
- `ClientTimestamp`: the browser occurrence time;
- `DeviceType`: `web`;
- `EventId`: the client event ID for operational correlation (AGS documents
  that this does not replace its server-generated ID);
- `Payload`: schema version, analytics session ID, privacy class, allowlisted
  coarse dimensions, numeric measurements, and the client event ID for
  downstream deduplication.

The game never sends player identity in the payload. AGS associates the event
with the authenticated user token.

Initial event names:

- `app_session_started`
- `app_interactive`
- `app_visibility_changed`
- `lobby_impression`
- `mode_selected`
- `queue_entry_result`
- `queue_threshold_reached`
- `queue_alternative_offered`
- `queue_alternative_selected`
- `queue_cancel_result`
- `session_join_result`
- the existing eight `tutorial_*` events

Lifecycle and reliability events are essential. Tutorial and product-journey
events are optional and emit only after explicit device-local consent.

## Implementation Steps

1. Replace the first-party collector request with the official AGS protected
   telemetry request and exact `TelemetryBody[]` JSON shape.
2. Point the browser telemetry client at `ACCELBYTE_BASE_URL`.
3. Remove the custom service RPC, handler, storage migration/repository, tests,
   and generated protobuf/OpenAPI output.
4. Update tests to assert the AGS endpoint, bearer token, 204 response, payload
   privacy, batching, and retry behavior.
5. Run a live guest-token smoke event and require HTTP 204.
6. Run the full frontend and match-service regression suites.

## Verification

- Unit tests prove optional events are suppressed until consent and essential
  events remain enabled.
- Unit tests prove the request goes only to
  `/game-telemetry/v1/protected/events` on the configured AGS base URL.
- Unit tests prove the request is an AGS `TelemetryBody[]` and excludes tokens,
  player identity, and unknown fields.
- A fresh AGS guest user token published `telemetry_smoke` with correlation ID
  `telemetry-smoke-9b9bbbc2-455c-408f-abad-26a821e65083` and received HTTP 204.
- Full `npm test`, `npm run build`, and match-service `go test ./...` pass.

## Risks And Open Questions

- In-memory retries are lost if the tab closes while offline; this is preferred
  to persisting telemetry outside AGS under the AGS-only requirement.
- AGS documents that caller-provided `EventId` does not override its generated
  ID, so downstream analysis must deduplicate on `Payload.event_id`.
- Admin readback needs a CLI/profile pointed at the same namespace subdomain
  plus an administrator user with
  `ADMIN:NAMESPACE:{namespace}:TELEMETRY [READ]`; the successful 204 proves
  ingestion acceptance but not event-browser visibility.
- Optional consent should later synchronize to the player's privacy profile
  where legally required.

## Next Slice

Add server-authoritative custom events for match start/end, reconnect/takeover,
Jade settlement, XP/progression, and performance outcomes. Those producers
must also publish only to AGS Game Telemetry and must not store analytics
copies in the game database.

## Deferred Requested Integrations

- [ ] Authoritative match lifecycle and command outcome telemetry.
- [ ] Reconnect, takeover, Jade, XP, error, and performance telemetry.
- [ ] Admin event-browser/readback verification with a suitable administrator
      user token.
