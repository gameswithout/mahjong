# Game Flow Plan — IAM Browser Bootstrap

- Date: 2026-07-17
- Status: Complete
- P0 slice: IAM / browser guest bootstrap

## Approved Feature

Create the first player-facing P0 slice for the Mahjong PWA: a visible browser
flow that signs a player in with AGS Device ID, obtains a player access token,
and proves that token with a second authenticated current-user request.

The user confirmed IAM/browser bootstrap as the first slice and approved this
Game Flow Plan on 2026-07-17.

## Confirmed Context

- The repository is pre-code. It currently contains product and development
  documentation, AGS tooling setup, and no client workspace or runtime `.env`.
- The approved product stack is a React + TypeScript PWA.
- AGS environment: Shared Cloud at
  `https://gameswithout.prod.gamingservices.accelbyte.io`.
- Development namespace: `gameswithout-mahjong`.
- The `mahjong` AGS CLI profile is authenticated with the confidential tooling
  client and passes `ags doctor`.
- The configured confidential client is for tooling, CI, and trusted backend
  work only. Its ID and secret must not be used by the browser.
- The browser Public IAM client is `dc7a13b683c44822905797a8d1df39e7`, supplied
  by the user and recorded in the project environment files.
- The AGS API MCP URL is committed in `.codex/config.toml`, but this session did
  not expose callable AGS API MCP tools. CLI schema discovery is the current
  evidence source.
- Local toolchain: Node 24 and npm 11 are available; pnpm is not installed.

## Goal

A player can open the P0 bootstrap page, select **Continue as Guest**, and see
one of these explicit states:

- `Signing in`
- `Signed in` with the opaque AGS user ID
- `Sign-in failed` with a stable error code and retry action

Success requires both:

1. AGS issues a player token through Device ID login.
2. The app uses that token to retrieve the current AGS user.

No token, client secret, or raw credential is rendered or logged.

## Non-Goals

- Lobby or presence connection.
- Session creation or join.
- Matchmaking.
- Match-runtime hosting, WebSocket transport, or durability.
- Wallet, Jade, Statistics, Achievements, Leaderboards, or telemetry.
- Magic-link account upgrade, Apple login, or Google login.
- Production visual design, final onboarding, age gate, or consent UX.
- Persisting AGS tokens in `localStorage`.

## Affected Areas

- New `client/` React + TypeScript workspace.
- Root workspace/build configuration needed only for this slice.
- `.env.example` and `.gitignore`.
- Browser IAM adapter and bootstrap UI.
- Unit tests plus a live IAM smoke path.
- P0 evidence and run documentation.

## AGS Modules

- IAM only.

## Service Selection

**Selected:** AGS IAM Device ID login and the IAM current-user endpoint.

IAM is the purpose-built service for player authentication and headless guest
accounts. Cloud Save is not used: this slice does not store generic game data,
and Cloud Save must not emulate identity or session state.

The TypeScript Web SDK is the preferred integration surface if its browser
entry point exposes the required Device ID flow. If it does not, implementation
must stop and record whether the custom-engine REST fallback is required before
auth code continues.

## Authorization Plan

Authorization preflight:

| Field | Decision / evidence |
| --- | --- |
| Caller | Game client: browser-based PWA |
| Environment | Shared Cloud |
| Environment evidence | Project AGS setup document and active CLI profile both use a `gamingservices.accelbyte.io` base URL and namespace `gameswithout-mahjong` |
| Token source | Player user access token minted by Device ID login |
| IAM client type | Public; `dc7a13b683c44822905797a8d1df39e7` |
| Secret location | None. A browser client must never receive the confidential tooling secret |
| Login call | `POST /iam/v4/oauth/platforms/{platformId}/token`, discovered with `ags describe iam oauth2 grant-by-platform`; Device ID uses the platform grant with `device-id` and `create-headless` inputs |
| Proof call | `GET /iam/v3/public/users/me`, discovered with `ags describe iam users get-my` |
| Permission discovery | Live AGS CLI command metadata |
| Required permissions | Neither discovered public operation declares a client resource permission; the proof call still requires the player's bearer token |
| Shared Cloud permission groups | No additional group identified for these two public operations |
| Verified access | Yes for the Public Device ID grant and authenticated current-user proof |

The current confidential tooling token proves operator access to the namespace;
it does not prove the Public client or player-token flow.

## Required AGS Setup Before Implementation

Use `/ags connect-portal` or the Admin Portal to:

1. The Public IAM client for the Mahjong browser game is identified:
   `dc7a13b683c44822905797a8d1df39e7`.
2. Device ID / anonymous login is activated for the namespace and Public
   client; the live grant and current-user proof now succeed.
3. The Public client ID is recorded in the project `.env.example`.
4. Confirm the browser origin used for local development is allowed.

No external provider credentials are required for Device ID. Device ID is an
intentional product guest flow here, not development-only; the deferred
magic-link slice is the planned account-upgrade and recovery path.

## Player Entry And UI Surface

- Trigger: **Continue as Guest** on a minimal P0 bootstrap screen.
- Existing path: none; the repository has no client code.
- UI states: idle, signing in, signed in, and recoverable error.
- Retry: returns from error to signing in using the same persisted device
  identity.
- Logout and account linking are deferred.

The AGS UI generator does not target React/web projects, so this small P0
surface will use ordinary React components and the project's accessibility
requirements.

## Completion Contract

### Success

- The button produces an AGS player token through the Public IAM client.
- An authenticated `GET /iam/v3/public/users/me` succeeds.
- The UI shows `Signed in` and the opaque user ID.

### Error

- The UI shows a stable project error code, a safe message, and Retry.
- Raw AGS responses, tokens, device identifiers, and secrets are not shown.
- CORS, invalid-client, disabled-provider, and network failures remain
  distinguishable in development diagnostics without leaking credentials.

### Service Evidence

- Token response succeeds.
- Current-user request succeeds with that token.
- No confidential client secret appears in the built assets or network request
  parameters.

### Game-Flow Evidence

- A browser user selects **Continue as Guest**.
- The visible state advances through signing in to signed in.
- The error and retry states are manually exercised.

## Implementation Steps

1. Complete the Public IAM client and Device ID setup gate.
2. Scaffold the smallest React + TypeScript client workspace and root build
   entry needed for this slice, preserving the development plan's pnpm
   direction.
3. Add `.env.example` with the non-secret base URL, namespace, and Public
   client ID; gitignore local `.env` files.
4. Install the minimal AGS browser packages and verify the supported Device ID
   API from the installed SDK types/source before writing the adapter.
5. Implement a browser IAM adapter with an injectable device-ID store,
   in-memory token handling, and typed error mapping.
6. Implement the accessible bootstrap UI and its four states.
7. Add unit tests for state transitions, retry behavior, device-ID reuse, and
   secret/token redaction.
8. Run the production build and the live browser smoke test against
   `gameswithout-mahjong`.
9. Record service evidence, game-flow evidence, package versions, and any CORS
   or SDK limitation in the P0 evidence document.

## Verification

- Fresh install and build succeed from the repository root.
- Unit tests pass.
- Production bundle inspection contains no confidential client ID/secret or
  access token.
- Browser flow: Continue as Guest → token issued → current user returned.
- Refresh/retry reuses the persisted guest device identity.
- Failure path displays a safe error and can retry.

Completion vocabulary:

- `Smoke-verified` if only API or test-harness evidence is available.
- `Game-flow integrated` when the visible browser trigger is wired but the live
  end state has not been manually verified.
- `Complete` only after the intended browser flow and both AGS calls succeed.

## Risks And Open Questions

- The live Public Device ID grant and authenticated current-user proof pass
  after Device ID activation. The user confirmed the intended browser
  `Continue as Guest` → `Signed in` flow.
- AGS CLI 0.2.0 authenticates successfully with the Keychain-backed tooling
  credential, and `ags doctor` passes. Public namespace lookup confirms
  `gameswithout-mahjong` is the Mahjong namespace. Admin namespace and IAM
  client inventory calls fail with AGS error `20030` (`subdomain mismatch`),
  so this confidential client cannot perform the required setup gate for this
  tenant.
- The TypeScript Web SDK 4.3.2 plus IAM module 6.3.5 exposes the required V4
  Device ID grant and V3 current-user call; the production build and unit tests
  pass.
- Shared Cloud CORS behavior for the local PWA origin must be proven.
- Device ID credentials can be lost through browser storage eviction. The
  product already requires a warning and a later magic-link upgrade path.
- Token refresh and secure persistence beyond this bootstrap proof remain
  deferred design work.

## Next Step

IAM P0 is complete. The next slice is Lobby connection and presence; keep
Session, Matchmaking, and AMS deferred until Lobby evidence is captured.

## Deferred Requested Integrations

- [ ] Lobby connection and presence event.
- [x] Session membership and roster lookup.
- [ ] Session create/join lifecycle.
- [ ] Match-runtime transport and per-seat response isolation.
- [ ] Extend versus self-hosted match-runtime durability/latency proof.
- [ ] Wallet/Jade authority and reserve-semantics spike.
- [ ] Matchmaking Override feasibility spike.
- [ ] Game Telemetry privacy/export spike.
