# mahjong-match-service — Implementation Plan

## Target

A Go Service Extension providing the authoritative Mahjong match API.

Owned RPCs:

- `JoinMatch`
- `GetMatchState`
- `SubmitMatchCommand`

Server-internal transitions such as initial Flower replacement and claim
resolution will not be exposed as client RPCs.

REST surface:

- `POST /v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}/join`
- `GET /v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}`
- `POST /v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}/commands`

`JoinMatch` conditionally creates the match from the fixed AGS Session roster,
persists one randomized seat assignment, and returns only the caller's
projection.

## Proto provenance

- `pkg/proto/service.proto` — owned by this project; replace the template's
  Guild example with the versioned Mahjong API.
- `pkg/proto/permission.proto` — retained from the official template.
- No AGS event or Override proto is consumed.
- Generated files under `pkg/pb/` must only be regenerated through the
  template's `make proto` workflow.

## Files to create

- `pkg/match/runtime.go` — match registry and single-writer actor ownership.
- `pkg/match/runtime_test.go` — concurrent initialization, authorization,
  retry, and recovery tests.
- `pkg/session/resolver.go` — AGS Session roster resolver interface.
- `pkg/session/ags_resolver.go` — confidential-client Session lookup adapter.
- `pkg/session/fake_resolver.go` — deterministic local/test roster resolver.
- `pkg/storage/migrations/001_match_runtime.sql` — match, seat-assignment,
  event, and snapshot schema.
- `pkg/storage/match_repository.go` — conditional match creation and seat
  persistence.
- `pkg/storage/event_store.go` — ordered transactional append-before-ack
  adapter.
- `pkg/storage/event_store_test.go` — sequence, concurrency, rollback, and
  recovery tests.
- `pkg/service/match_service.go` — implementations of the three owned RPCs.
- `pkg/service/match_service_test.go` — gRPC authorization and redaction tests.

## Files to modify

- `pkg/proto/service.proto` — replace Guild RPCs/messages and Cloud Save
  permissions.
- `main.go` — register the Mahjong service, resolver, actor registry, and
  PostgreSQL repositories.
- `pkg/storage/storage.go` — remove temporary `GuildProgress`; retain
  PostgreSQL pool construction.
- `docker-compose.yaml` — retain PostgreSQL and add only non-secret local
  configuration.
- `.env.template` — document Session resolver and SQL settings with
  placeholders.
- `go.mod` — replace the template's `extend-custom-guild-service` module
  identity.
- Root Go module — decide how the existing rules engine is shared without
  copying divergent implementations.
- README and Swagger assets — replace Guild instructions and generated API
  documentation.

## Storage contract

The SQL adapter must provide:

- conditional match creation keyed by namespace/session/match;
- canonical roster hash;
- immutable player-to-seat assignment;
- ordered per-match event sequence;
- unique request/idempotency keys;
- event append and actor acknowledgement ordering;
- periodic snapshots;
- replay hash verification;
- transaction rollback without state acknowledgement.

Cloud Save will not be used for gameplay events.

## External AGS APIs called

- IAM client-credentials/token flow used by the official Service Extension
  template.
- IAM token validation performed by the template interceptor.
- AGS Session detail lookup for the exact game-session roster.
- AGS Platform Wallet balance lookup, credit, debit, and post-write balance
  verification for asynchronous Jade reconciliation.

The implementation uses the generated AGS Go SDK
`GameSessionService.GetGameSessionShort` operation and extracts the fixed
non-terminal member roster from `ApimodelsGameSessionResponse.Members`.

## Authorization preflight

```text
Caller:                Backend Service Extension
Environment:           AGS Shared Cloud
Environment evidence:  gameswithout-mahjong.prod.gamingservices.accelbyte.io;
                       namespace gameswithout-mahjong
Token source:          Confidential service/server token
IAM client type:       Confidential, dedicated per app
Secret location:       Extend deployment secret configuration only
AGS calls:             IAM bootstrap/token validation; Session detail lookup;
                       Platform Wallet summary, credit, debit, and readback
Permission discovery:  AGS CLI operation discovery plus the pinned AGS Go SDK
                       OpenAPI spec
Required permissions:  Session game-session READ; Wallet READ and UPDATE
Shared Cloud groups:   Session / Game Session; Platform Store / Wallet
Verified access:       Session READ yes; Wallet READ/UPDATE yes — verified by
                       IAM readback and live credit/debit/readback
```

**Deployed runtime client differs from the discovery client above.** The
live Extend deployment (see "Deployment record" below) runs under an
AGS-platform-provisioned confidential client
(`AB_CLIENT_ID=72498bf13af54deabafdcba90d1ce497`, managed as an Extend app
secret, not the manually created `e411a963a6bc42239dc27e39e3a03440` client
referenced in local `.env`). Its Session game-session READ and Platform Store /
Wallet READ + UPDATE permissions are live-verified. The final four-account
journey converged all four Wallets to the authoritative PostgreSQL ledger.

Browser players continue authenticating with the existing Public client and
user access token. No confidential credential enters the browser, repository,
image, event log, or public payload.

## Open prerequisites

- [ ] Rotate the unrelated confidential credential exposed by Compose
  interpolation.
- [x] Create a dedicated confidential IAM client for
  `mahjong-match-service`.
- [x] Run live Session-operation and Shared Cloud permission-group discovery.
- [x] Confirm the dedicated runtime client's IAM bootstrap and Session-read
  permissions.
- [x] Grant and verify the deployed runtime client's minimum Shared Cloud
  **Platform Store / Wallet READ + UPDATE** permission.
- [x] Decide the inbound player permission annotations for the custom RPCs:
  bearer validation is required, while no unverified custom AGS permission
  resource is fabricated.
- [x] Provision the managed SQL resource and obtain its Aurora CA path.
  Provisioned via AGS Extend's SQL cluster offering (AWS RDS Aurora
  Postgres, `extend-sql-gameswithout-prod` cluster, `us-east-2`), linked to
  the `mahjong-match-service` Extend app through the Admin Portal — not
  self-hosted Postgres. The platform auto-injects connection config
  (`SQLDB_HOST`/`SQLDB_DATABASE_NAME`/`SQLDB_USERNAME`/`SQLDB_PASSWORD`) and
  auto-mounts the CA bundle at `/srv/certs/sql/global-bundle.pem` as a
  non-editable app variable; these are not hand-provisioned or baked into
  the image.
- [x] Select a versioned migration mechanism: embedded ordered SQL migrations
  with a transactional `schema_migrations` ledger.
- [x] Keep the existing `rulesengine` as the single implementation used by
  both the local walking skeleton and Extend image. Local compilation consumes
  the canonical parent module through a Go `replace`; the checked-in Go vendor
  bundle supplies that same source to standalone image builds. Publish an
  immutable parent-module version as a future cleanup.
- [x] Keep v1 transport on REST commands plus state polling. Persistent Extend
  ingress is not required for P0; AGS Lobby notifications remain a later
  latency optimization.
- [ ] Benchmark synchronous append latency against the deployed Aurora
  cluster. Local PostgreSQL baseline on an Apple M1 Pro is 1.47–1.56 ms per
  transactional append (three 500-operation samples). **Still not repeated
  against the managed SQL from the deployed region** — the 2026-07-19 deploy
  (see "Deployment record" below) went ahead without this benchmark, on
  explicit user direction to proceed despite the gap. Append latency and the
  §15.5 command-ack targets are unverified in production; run this before
  trusting the deployment under real match load.
- [ ] Decide whether `mahjong-match-service` remains a separate repository or
  becomes a tracked directory in the parent repository.

## Verification

- [x] Concurrent `JoinMatch` calls create exactly one roster and seat
  assignment.
- [x] Four fixed Session members receive one E/S/W/N permutation.
- [x] Non-members and fifth players fail without creating state.
- [x] Seats remain identical after process restart.
- [x] Commands are durably appended before acknowledgement.
- [x] Duplicate requests return their original committed result.
- [x] Final-claim resolution recovers from a cross-replica sequence race, and
  a duplicate final response retries or returns the committed resolution.
- [x] Recovery produces byte-equivalent per-seat projections.
- [x] No concealed tiles, wall order, private claims, tokens, or secrets leak
  through the caller projection.
- [x] Unit, contract, race, PostgreSQL migration/concurrency, two-replica
  initialization, two-replica command, and local REST restart-recovery checks
  pass. The complete unit/contract suite also passes with the Dockerfile's
  exact Go 1.24.10 toolchain. The PostgreSQL two-replica suite passes 20
  consecutive runs, including simultaneous inserts that may conflict on
  either the match identity or deterministic runtime primary key. State and
  command requests also restore on a replica that never handled `JoinMatch`,
  and cached replicas refresh from the persisted event head before serving, so
  the service does not rely on load-balancer affinity or serve indefinitely
  stale projections. Runtime locking is keyed by match, preserving table order
  without serializing unrelated matches.
- [ ] Docker/Compose image build passes after replacing the parent-module
  `replace` directive with an immutable shared rules-engine version — the
  immutable-version replacement itself is still not done, so this box stays
  open. What **is** now confirmed (2026-07-19): the vendor-mode build
  (`-mod=vendor`, the exact build the Extend image uses) passes today as-is,
  still on the `replace` directive plus the checked-in vendor bundle.
  Protobuf/gRPC/gateway/OpenAPI generator versions are already pinned in the
  Dockerfile.
- [x] AGS-backed Session flow verified with four distinct guest accounts:
  matchmaking created a real four-member Session, all four players joined
  the live service, completed a full authoritative hand, reached the shared
  result, converged all four Wallets, and left the Session cleanly.

## Deployment record

First deployed 2026-07-19 to AGS Extend, on explicit user direction to proceed
ahead of the append-latency benchmark. The current 2026-08-03 deployment adds
the authoritative match-history endpoint used by the lobby while retaining the
Full Rotation, achievement-experience, and mobile-network work.

**Keep this block current.** Its staleness caused a 2026-07-25 mis-diagnosis:
the record said 2026-07-20 while the live service already carried the Jade
economy, so the hosted client was wrongly suspected of calling endpoints that
did not exist. Anyone deploying this app updates this block in the same change.

```text
App:            mahjong-match-service (service-extension scenario)
Namespace:      gameswithout-mahjong
Base URL:       https://gameswithout-mahjong.prod.gamingservices.accelbyte.io
Base path:      /ext-gameswithout-mahjong-mahjong-match-service
                (platform-assigned; NOT /mahjong — anything wiring a client
                at this service must use the real base path, not the local
                dev value from README/.env.template)
Service URL:    .../ext-gameswithout-mahjong-mahjong-match-service
Image tag:      match-history-a38b406 (deployment created
                2026-08-03T19:27:56.981Z, healthy; deployment
                a4f75f77-e9df-44c1-9f51-c1df2a11370e). Adds the authoritative
                /v1/namespaces/{namespace}/match-history endpoint, including
                completed practice sessions used to reconcile lobby totals.

Previous image: full-rotation-gate-cd6179e (deployment created
                2026-07-31T03:11Z; deployment
                48a106e6-835e-4d94-83a5-118f44d2f484). Added the §10.1
                server-side ranked-account gate: Full Rotation entry now
                requires a linked account, decided by the match service
                rather than by the client hiding a button. A guest is a
                headless account (no email address), the same definition
                client/iam.ts uses; emailVerified is deliberately not
                required, since §10.2's upgrade attaches an email and this
                namespace does not deliver verification mail. The gate
                refuses when it cannot tell — unreachable IAM, a 401, a
                malformed profile, or an unconfigured resolver all refuse
                ranked entry rather than defaulting open.
                Verified live after rollout: a guest holding a valid token
                was refused a seat at a real ranked table with HTTP 403 and
                the linked-account message, while four linked accounts
                seated at that same table and played a rotation through to
                rotation_complete (4 hands, 4 dealers, winds turned, no Jade
                moved). Quick Play remains ungated. Evidence:
                docs/ags-plans/2026-07-31-ranked-account-gate-evidence.md.
                Still unproven in production: settlement with a non-zero
                table-point transfer — all three live rotations ran entirely
                to exhaustive draws.

                Deploying needs the publisher subdomain and a publisher
                *user* token. Neither stored client secret works
                ("unknown client"), and the ambient AB_CLIENT_ID /
                AB_CLIENT_SECRET in the shell profile silently override a
                browser login — extend-helper-cli reports the wrong studio
                until they are unset. `ags csm` reaches Extend with
                ordinary game-namespace auth and covers everything except
                the image push (apps get, images list, deployments create),
                so prefer it for reads and deployment status.
                Preceding images, newest first:
                full-rotation-1b717ff (deployment created
                2026-07-31T01:37:35.243Z, healthy at
                2026-07-31T01:38:07.848Z; deployment
                dd7d3d3d-45b4-48a2-9754-a68236132837). Completes the §8.4
                Full Rotation player flow on top of the existing rotation
                container: new rotation hands use the ranked 12-second
                turn and 5-second interception deadlines, while Bamboo
                Quick Play is pinned separately to 15/10 and Practice
                remains untimed.
                Verified after rollout: Extend reports deployment-running
                on this exact image; deployed OpenAPI returns 200; and an
                unauthenticated Jade request returns 401 rather than 404
                or 5xx. The dedicated mahjong-full-rotation-pool and
                mahjong-full-rotation Session template are live. A
                four-player production run joined without any Jade
                reservation, completed four hands with four distinct
                dealers and rotating winds, produced a four-place podium,
                paid per-hand and placement XP, and left every player's
                Jade balance and reserved amount unchanged. All four live
                hands were exhaustive draws, so deterministic integration
                tests remain the evidence for non-zero point transfer.

                Deploying this app needs the *publisher* subdomain
                (https://gameswithout.prod.gamingservices.accelbyte.io)
                even though the app lives in gameswithout-mahjong. The
                game subdomain returns "(20030) data not found: subdomain
                mismatch" for both get-app-info and deploy-app. The vendor
                bundle is not checked in, so `make vendor` must run before
                image-upload or the build fails on modules.txt drift.
                Preceding images, newest first:
                full-rotation-c50ca0f (active since
                2026-07-30T22:16:54Z; deployment
                9b78e3c4-33df-4ec2-9460-41f2b4f0e923). Added the §8.4
                rotation container, migration 007, Session-attribute mode
                selection, table-point settlement with no Jade, and
                per-hand/final-placement XP.
                p2-2-achievements-94508d7 (active since
                2026-07-30T13:25:23.392Z; deployment
                69c9da91-31ef-42d6-9fbd-3668f17d32df),
                p22-achievements-4b266d4 (active since
                2026-07-30T12:01:49.565Z; deployment
                f9dd0216-c98b-456f-a0b4-418e8c8b4e09). Adds the P2.2
                player achievement experience: a caller-only
                GetPlayerAchievements RPC with no user-id input, exact
                progress merged with the complete 32-entry visible catalog,
                explicit eligibility reasons for the nine unavailable
                entries, and hand-result unlock retention across later polls.
                Verified after rollout: Extend reports
                deployment-running on this exact image; the deployed OpenAPI
                path set equals the source tree and includes
                /v1/namespaces/{namespace}/achievements; an unauthenticated
                request returns 401 rather than 404; and the browser-origin
                CORS preflight returns 204.
                Preceding images, newest first:
                ach-sweep-20260730 (active since
                2026-07-30T02:13:21.998Z; deployment
                3d4db67e-b598-4c8c-8bd2-bd38ce995272),
                stats-p23-05fe308 (active since
                2026-07-29T16:55:33.103Z; deployment
                8c3cb8ab-5854-4377-baf1-90828ff3b840). Adds the P2.3
                statistics dashboard: two new counters
                (public-hands-dealt-in, public-hands-ting) written from
                the completed-hand projection, and a
                GetPlayerStatistics RPC serving the caller their own
                record. The RPC exists because the AGS Social API sends
                no CORS headers, so the browser cannot read AGS
                Statistics directly even though the configurations are
                public and the player owns the record; AGS IAM does send
                them, which is why the rest of the client can talk to AGS
                and this could not. Verified live end to end with a
                seeded player: 26% win rate over 120 hands, 39% Zimo
                share over 31 wins, correct denominators throughout. The
                seeded values were reset afterwards so they do not skew
                the namespace. Carries no schema migration.
                cond204-ec995cd (active since
                2026-07-29T03:55:32.353Z; deployment
                c12927a8-6196-4c7c-87d9-80b5c5ca2095). Makes conditional
                GET actually work for the browser client, which it never
                had. Two things were wrong. ETag is not a CORS-safelisted
                response header, so without Access-Control-Expose-Headers
                the client could not read the tag and never sent a
                conditional request at all -- the feature had been inert
                since it shipped, and a curl check could not see that
                because curl ignores CORS. Fixing only that made it worse:
                a 304 tells a browser to serve a copy it holds, these
                responses carry Authorization so no copy is stored, and
                Chrome cancelled every poll. An unchanged poll is now
                answered with 204, which needs no cache entry.
                Verified against the live client on a throttled link
                (scripts/mobile-network-probe.mjs): 14 of 16 answered
                polls came back 204, about 28KB saved in two minutes,
                and no failed polls outside a deliberate offline window.
                Carries no schema migration, and no service code beyond
                this differs from achievements-20260728.
                Preceding images, newest first:
                cors-etag-1cf6d68 (2026-07-29, deployed and rolled back
                within minutes -- it exposed the ETag without the 204
                change, so the client began sending conditional requests
                that Chrome then cancelled; the rollback restored
                mobile-net-fc0b648 and was re-measured clean),
                achievements-20260728 (active since
                2026-07-29T02:54:02Z; deployment
                54ed9b72-e708-4778-b72f-69f66a084149). P2.2: writes the
                §12.3 achievement statistics after every completed public
                hand, and pays the §12.3 achievement XP for unlocks AGS
                reports. Carries no schema migration — the XP awards reuse
                xp_awards with achievement:<code>:<user> award IDs.
                Verified after deploy: a real Practice hand played end to
                end on the live service left all 18 stat values at 0.0,
                confirming the §11.4 "Practice grants no achievements"
                guard holds in production and not only in tests. The public
                path is NOT yet verified live — see Not verified.
                Preceding images, newest first:
                progression-20260727 (active since
                2026-07-27T18:37:38.108Z; deployment
                c390b637-1533-41e5-bdec-f4e78b367955). P2.1 basic XP and
                levels: §12.1 hand awards, the §12.2 curve derived from
                lifetime XP, the GetProgression and AwardOnboardingXP RPCs,
                and migrations 005_progression.sql and
                006_progression_hardening.sql (player_xp, xp_awards,
                onboarding_progress, progression_reward_grants). Verified
                after deploy: GET /progression and POST
                /progression/onboarding both return 401 rather than 404,
                so the routes exist and enforce auth. Both migrations were
                applied against a real PostgreSQL 16 alongside the full
                integration suite before deploying; in production they are
                inferred from a clean startup, not read back.
                Preceding images, newest first:
                mobile-net-fc0b648 (active since
                2026-07-27T15:49:32.900Z; deployment
                3737f469-91aa-4a5f-933e-40e626d49079). The mobile-network
                work: gzip compression on every response, conditional GET
                (weak ETag over the response bytes, 304 on a matching
                If-None-Match), and read/write/idle timeouts on the HTTP
                server. Verified against the live URL after deploy — a
                first GET returns an ETag and the repeat returns 304 with
                no body, so Envoy passes both through intact.
                Carries no schema migration.
                faucets-20260726 (2026-07-27T12:33:12.002Z; deployment
                e4b631e7-a545-4d6a-a0d0-9bf6220d22f1 — added the §7.5
                faucets: the ClaimJadeWelfare RPC, the daily play grants,
                and migration 004_jade_faucets.sql
                (jade_hand_participation, jade_daily_grants), the first
                schema migration since the Jade economy itself. Note that
                this image already carried the gzip middleware: it was
                built from a main that had merged it, so compression went
                live here rather than with the image named for it),
                wallet-reconcile-20260725-r3 (2026-07-26T03:38:53.301Z;
                deployment f9fee13c-2aa5-40ad-99cf-570d1c7443df — fixed the
                live Wallet API's mixed-case "System" balance origin, gave
                each reconciliation target its own timeout, prioritized
                pending targets, and projected sanitized sync failure
                state),
                wallet-reconcile-20260725-r2,
                wallet-reconcile-20260725-r1,
                wallet-verify-20260725,
                jade-stall-fix-d4c0047, runtime-fixes-c90b3bb,
                opening-delay-6911e8f, gang-zimo-6c8c18a,
                video-chat-6a5825e, ai-practice-b5314bd
                (2026-07-20, itself superseding ai-practice-
                ca9d3d2, which supersedes cors-fix-1; adds AI Practice
                solo-vs-bots — ai_practice roster padding with bot seats,
                untimed §5.10 preset, is_bot projection — plus driveLocked
                resolution of rob windows and §5.9 offers, which previously
                could stall any match a bot declared an added Kong in, and
                deadlock untimed matches on offers. ai-practice-b5314bd
                fixes a follow-up bug ca9d3d2 shipped with: is_bot was
                added to rulesengine.PlayerView but never added to
                service.proto or projectState's manual copy into the
                protobuf-generated pb.PlayerView, so it never reached the
                wire — every bot seat showed "Auto-playing" instead of
                "Bot" against the real deployment despite every unit test
                passing, because none of them exercise the protobuf
                mapping layer)
Database:       AGS Extend SQL cluster — AWS RDS Aurora Postgres,
                extend-sql-gameswithout-prod, us-east-2
Verified:       Image push + deploy succeeded; app status
                deployment-running; unauthenticated request to the live
                REST surface returns 401 (service reachable, auth enforced);
                CORS preflight (OPTIONS) against the live URL confirmed
                returning Access-Control-Allow-Origin: * (2026-07-19); local
                end-to-end browser run (guest sign-in → real AGS Session →
                join → full match table render) verified against this same
                code running locally, including the new projection fields
                arriving over the wire with correct snake_case names.
                2026-07-19: runtime IAM client's Session-read permission
                confirmed against a REAL (non-test-mode) AGS Session, on the
                live deployed URL specifically — see below.
                2026-07-20: an AI Practice solo hand played end-to-end
                against the live deployed URL (guest sign-in → Practice vs
                Bots → real AGS Session with attributes.ai_practice → Join
                against the deployed service → roster padded with bot IDs
                → South/West/North marked taken_over + is_bot in the wire
                response → client rendered the "Bot" badge). This is the
                first live four-seat match played end-to-end against this
                deployment.
                2026-07-25: four distinct guest accounts created a real
                four-member AGS Session and played 125 authoritative actions
                to a shared Jade settlement result on the deployed URL.
                2026-07-25: final four-account release journey completed 123
                legal actions; all Wallet statuses synced; total Jade stayed
                20,000; all returned balances were 5,000; four Session leaves
                succeeded.
                2026-07-27: faucets-20260726 deployed; app status
                deployment-running; POST /jade/welfare moved from 404 to
                401 against the live URL, which is what confirms the new
                route exists and enforces auth rather than merely that the
                deploy command returned success.
                2026-07-28: scripts/verify-live-progression.mjs ran a real
                guest account through the deployed service end to end —
                real IAM login, a real AGS Session, nine real AI Practice
                hands played turn by turn through actual draw/discard/pass
                commands (not a test harness bypass). Confirmed live:
                AwardOnboardingXP grants 500 XP once and is idempotent and
                monotonic (an outcome can move skipped -> completed but not
                back); each of the first eight Practice hands paid exactly
                25 XP; the ninth reported capped_by_daily with zero XP,
                matching the §12.1 200/day cap precisely; final lifetime XP
                (700) and level (2, 200/600 into it) matched the §12.2
                curve exactly; and the account's Jade balance stayed at
                5,000 through all nine hands — Practice truly never touches
                Jade in production, not just in the test suite. This
                confirms migration 005/006's player_xp, xp_awards, and
                onboarding_progress tables are live and correct: nine real
                award rows were written, one of them a genuine zero-amount
                capped award, and none of it double-paid across the
                projection poll that repeats a finished hand.
Not verified:   Append latency against the real Aurora cluster.
                The §12.3 statistics have never been written for a real
                public hand in production. Only the negative case is
                proven: Practice writes nothing. Confirming the positive
                case needs four humans in one public hand, which no
                automated script here can currently produce.
                Achievement XP has likewise never been paid live. All 23
                achievement configs now exist (2026-07-29) and are
                cross-checked against the Go reward table and the stat
                definitions, but no unlock has actually fired in production
                because that needs a public hand.
                The §7.5 Jade side of the faucets — the welfare top-up and
                the daily public-hand play grants — remains unexercised in
                production, and migration 004's jade_daily_grants table has
                never been written to live. This is not an oversight: both
                require an account to actually lose Jade in a staked hand,
                which requires winning a legal Taiwanese Mahjong hand
                against it, which the 2026-07-28 verification's simplest
                possible legal play (draw, discard, pass every claim) does
                not attempt to force and cannot reliably force. That path
                remains proven only by the storage-layer integration tests
                against real PostgreSQL (pkg/storage/jade_faucets_integration_test.go),
                not against production.
```

### Reading deployment state

Two ways to ask the live deployment what it is, in preference order:

1. **Authenticated (authoritative, gives the image tag).** Needs an account
   with `ADMIN:NAMESPACE:gameswithout-mahjong:EXTEND:IMAGE [READ]`:

   ```shell
   AGS_PROFILE=mahjong-admin ags csm images list \
     --app mahjong-match-service --namespace gameswithout-mahjong
   ```

   **Solved 2026-07-25.** The `mahjong` profile's client credentials do have
   the right, but its stored base URL is the publisher domain
   `gameswithout.prod...` while CSM resources for this namespace live under
   `gameswithout-mahjong.prod...` — hence error 20030 `subdomain mismatch`.
   Override the base URL per-invocation and the call works:

   ```shell
   AGS_BASE_URL=https://gameswithout-mahjong.prod.gamingservices.accelbyte.io \
   AGS_PROFILE=mahjong \
     ags csm images list --app mahjong-match-service --namespace gameswithout-mahjong
   ```

   The other profiles remain dead ends, so reach for the override rather
   than them: `mahjong-admin` has the right base URL but no `client_id`
   (its stored authorization-code token is not enough for the CLI), and
   `mahjong-match-service` authenticates but returns error 20013 — its
   client holds only IAM bootstrap and Session-read permissions.
   `extend-helper-cli` has the same problem from the other end — it ships
   logged in to an unrelated studio (`seal-chessags`), so check
   `extend-helper-cli status` before trusting any deploy command.

2. **Unauthenticated (no credentials, gives the API surface, not the tag).**
   The service serves its own generated OpenAPI document publicly:

   ```shell
   curl -s "$SERVICE_URL/apidocs/api.json"
   ```

   Diff its path set and definition/property/enum surface against this tree's
   `gateway/apidocs/service.swagger.json`. Equality proves the live binary
   carries every proto-affecting commit in the tree. It says nothing about
   non-proto changes, so it bounds the deployed commit from below rather than
   pinning it. This is what established the current record entry.

   Routing runs before auth, which is what makes this probe readable at all:
   an unknown path under the base path returns 404 while a real one returns
   401. So `curl -o /dev/null -w '%{http_code}'` against a specific route
   distinguishes "not deployed" (404) from "deployed, needs a token" (401).

**IAM permission verification (2026-07-19, updated 2026-07-25):** the
platform-provisioned confidential client the live deployment runs as
(`72498bf13af54deabafdcba90d1ce497`, `extend-mahjong-match-service`) was
found to have **zero permissions granted**
(`clientPermissions: []`, `modulePermissions: []`, confirmed via
`ags iam clients get`) — this is why every real `JoinMatch` call against a
real AGS Session failed with an opaque `500 "match runtime failed"`
(`GetGameSessionShort` rejected before reaching any app logic). User granted
`m_session` / `g_game_session` READ (plus `g_session_storage` READ) via
Admin Portal. The running process had already cached a pre-grant OAuth
token from its one-time startup `LoginClient` call, so the fix didn't take
effect until the app was restarted (`stop-app` + `start-app`) to force
re-authentication. After restart, a real guest sign-in → real AGS Session →
`JoinMatch` call against the live URL returned
`400 "game session does not have exactly four active members: got 1"` —
i.e. `GetGameSessionShort` now succeeds and the app's own roster-count
business rule runs correctly. This is conclusive: the permission works.
The 2026-07-25 four-account journey subsequently exercised that real
four-member path through settlement.

The latest runtime-client readback shows `m_session / g_game_session [READ]`,
`m_session / g_session_storage [READ]`, and
`m_platform_store / g_wallet [READ, UPDATE]`. After redeploying for a fresh
client-credentials token, a reversible one-Jade probe verified live credit and
debit. The probe also found a generated-SDK mismatch: uppercase `SYSTEM`
passes local validation but the live API requires `System`. Image
`wallet-reconcile-20260725-r3` corrects both request shapes, and the final
four-account journey verified post-write readback for all seats.

**Revision history:**
- `9eb21b7` — initial deployment (REST match service live).
- `43da5de-wip` — extended `MatchState` to feature parity with the client's
  `SeatView` (waits, melds, discards, turn_deadline, hand_result,
  settlement, next_dealer, claim.options with win preview), switched the
  gRPC-gateway JSON marshaler to `UseProtoNames` (snake_case wire format
  matching the client's existing types). Done to unblock retargeting the
  browser client from the undeployed `server/cmd/walking-skeleton` WS
  prototype to this REST service.
- `cors-fix-1` — added CORS middleware (`main.go`). Discovered via a real
  browser (Playwright) end-to-end test: the deployed service had no
  `Access-Control-Allow-Origin` handling at all, and neither does AGS's
  platform gateway in front of it — every browser call was silently blocked
  by CORS preflight. This was a hard blocker for the REST client, not a
  nice-to-have.

## Out of scope

- Live IAM permission mutation during implementation.
- Lobby notification transport.
- Matchmaking Override.
- Bots, settlement, Jade ledger, progression, ratings, or achievements.
- Regional failover and production capacity rollout.
- Reusing the unrelated tooling credential.
