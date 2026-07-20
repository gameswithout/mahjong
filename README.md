# mahjong

## AGS CLI setup

Configure the project-specific AGS profile once:

```bash
./scripts/configure-ags-cli.sh
./scripts/login-ags-cli.sh
```

The setup script stores the confidential tooling client ID and other non-secret
project settings in the local `mahjong` AGS CLI profile. It never stores the
client secret in this repository. Each developer must obtain that secret from
the project secrets vault for the one-time client-credentials login.

Use the login script instead of plain `ags auth login`. The CLI defaults the
plain command to browser authorization-code login, which is incompatible with
this project's confidential tooling client.

## Running the game locally

The browser client (`client/`, run with `npm run dev`) talks to
`mahjong-match-service` — a Go match runtime deployed as an AGS Extend
Service Extension — over REST. There are two ways to get a match backend for
the client to talk to; pick based on what you're testing.

### Option A — point at the live deployed service (fastest; recommended for playtesting)

No Docker, no Postgres, no Go toolchain. This is the quickest way for a
teammate to just run and play the game.

```bash
git clone <this repo> && cd mahjong
npm install
cp .env.example .env
```

Edit `.env` and point `ACCELBYTE_MATCH_SERVICE_URL` at the live deployment's
base path (see `mahjong-match-service/IMPLEMENTATION_PLAN.md`'s "Deployment
record" for the current base URL if this ever changes):

```text
ACCELBYTE_MATCH_SERVICE_URL=https://gameswithout-mahjong.prod.gamingservices.accelbyte.io/ext-gameswithout-mahjong-mahjong-match-service
```

Leave the rest of `.env.example`'s defaults as-is (`ACCELBYTE_BASE_URL`,
`ACCELBYTE_NAMESPACE`, `ACCELBYTE_CLIENT_ID`, `ACCELBYTE_SESSION_TEMPLATE`,
`ACCELBYTE_SESSION_CLIENT_VERSION`) — those already point at the
`gameswithout-mahjong` AGS namespace this deployment lives in.

```bash
npm run dev
```

Open the printed local URL, click **Continue as Guest**, then:

- **Practice vs Bots** — the fastest path to an actual playable hand solo:
  creates a session, fills the other three seats with permanent AI bots, and
  needs no other players. Click it, then **Connect test hand** in the "Local
  match runtime" panel that appears.
- **Create test table** + **Find a table** (matchmaking, needs
  `ACCELBYTE_MATCH_POOL` configured) are for testing with real second/third/
  fourth players instead.

### Option B — full local stack (for match-service development)

Needed when you're changing `mahjong-match-service` itself and want a fast
inner loop without redeploying. Start it per that directory's own README's
"Fully local test mode" (a fixed four-seat roster with auth disabled, no
real AGS Session needed), then point the browser at it:

```bash
# terminal 1 — from mahjong-match-service/, per its own README
docker compose up -d postgres
PLUGIN_GRPC_SERVER_AUTH_ENABLED=false \
MATCH_TEST_ROSTER=local-east,local-south,local-west,local-north \
MATCH_TEST_USER_ID=local-east \
BASE_PATH=/mahjong \
SQLDB_HOST=127.0.0.1:5432 SQLDB_USERNAME=postgres SQLDB_PASSWORD=postgres SQLDB_DATABASE_NAME=mahjong_match \
go run .

# terminal 2 — from the repo root
ACCELBYTE_MATCH_SERVICE_URL=http://127.0.0.1:8000/mahjong npm run dev
```

Open the printed local URL, sign in as a guest, create or join a test Session,
then select **Connect test hand**. East starts with 17 tiles after initial
Flower replacement and should discard first. Other eligible seats can select
**Pass claim**; after the claim window resolves, South draws next.

**This fixed test roster is always four real (test) IDs — `MATCH_TEST_ROSTER`
bypasses the real AGS Session lookup entirely, so it never goes through the
roster padding that fills empty seats with bots.** Practice vs Bots only
works against a real AGS Session (Option A, or "AGS-backed local mode" in
`mahjong-match-service/README.md`, which needs a confidential service
client's secret from the project secrets vault).

## Rules core and match-runtime tests

The repository includes the deterministic tile/wall/deal rules core
(`rulesengine/`) and an early Go match-runtime prototype
(`server/cmd/walking-skeleton`, WebSocket transport) alongside
`mahjong-match-service`. Run their tests explicitly:

```bash
go test ./server/... ./rulesengine
```

**`walking-skeleton` is not wired to the client and has never been
deployed** — it remains in the repo as a rules-core exercise only. The
browser client always talks to `mahjong-match-service` (see above).

The current rules slice includes a deterministic 144-tile catalog, seeded
shuffle, dice-selected wall flattening, four-pass deal plus East's extra tile,
front draws, a 16-tile replacement reserve, mandatory initial/in-play Flower
replacement, the versioned turn/claim core, structural evaluation and Tai
scoring, and a match actor with append-before-ack event logging and per-seat
redacted views — all shared by both `mahjong-match-service` and
`walking-skeleton` via the `rulesengine` package. Evaluator boundaries are
documented in [the rules
evidence](docs/mahjong-rules-evaluator-evidence.md),
and actor/projection evidence is in [the match actor evidence](docs/mahjong-match-actor-evidence.md).
