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

## Local match runtime and rules core

The repository includes the deterministic tile/wall/deal rules core and an
early Go match-runtime prototype (`server/cmd/walking-skeleton`, WebSocket
transport). Run their tests explicitly (the repository also contains the
TypeScript client):

```bash
go test ./server/... ./rulesengine
```

**The browser client talks to `mahjong-match-service` (REST, an AGS Extend
Service Extension — see that directory's own README), not
`walking-skeleton`.** `walking-skeleton` remains in the repo as a rules-core
exercise but is not wired to the client and has never been deployed.

For local end-to-end play, start `mahjong-match-service` per its own
README's "Fully local test mode" (a fixed four-seat roster with auth
disabled, no real AGS Session needed), then point the browser at it:

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

The current rules slice includes a deterministic 144-tile catalog, seeded
shuffle, dice-selected wall flattening, four-pass deal plus East's extra tile,
front draws, a 16-tile replacement reserve, mandatory initial/in-play Flower
replacement, the versioned turn/claim core, structural evaluation and Tai
scoring, and a match actor with append-before-ack event logging and per-seat
redacted views — all shared by both `mahjong-match-service` and
`walking-skeleton` via the `rulesengine` package. Evaluator boundaries are
documented in [the rules
evidence](/Users/junaililie/personal-project/mahjong/docs/mahjong-rules-evaluator-evidence.md),
and actor/projection evidence is in [the match actor evidence](/Users/junaililie/personal-project/mahjong/docs/mahjong-match-actor-evidence.md).
