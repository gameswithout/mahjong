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

The repository now includes a small Go match-runtime walking skeleton and the
deterministic tile/wall/deal core. Run their tests explicitly (the repository
also contains the TypeScript client):

```bash
go test ./server/... ./rulesengine
```

Start the local WebSocket server with the title-level AGS settings from
`.env` (the server only needs the base URL and namespace; the browser player
token is supplied during the WebSocket handshake):

```bash
set -a; source .env; set +a
AGS_BASE_URL="$ACCELBYTE_BASE_URL" \
AGS_NAMESPACE="$ACCELBYTE_NAMESPACE" \
MATCH_RUNTIME_ADDR=:8081 \
go run ./server/cmd/walking-skeleton
```

`GET http://127.0.0.1:8081/healthz` is a no-credential readiness check. The
authenticated endpoint is `ws://127.0.0.1:8081/ws`. Local browser clients
offer the fixed `ags.bearer` protocol plus a separate base64url credential
offer; the server selects only the fixed protocol, so the credential is not
echoed in the upgrade response. The server verifies the token against AGS IAM
before accepting the connection.

In a second terminal, start the browser:

```bash
npm install
npm run dev
```

Open the printed local URL, sign in as a guest, create or join a test Session,
then select **Connect test hand**. East starts with 17 tiles after initial
Flower replacement and should discard first. Other eligible seats can select
**Pass claim**; after the claim window resolves, South draws next. Runtime
events default to `tmp/match-events.jsonl`.

The current rules slice includes a deterministic 144-tile catalog, seeded
shuffle, dice-selected wall flattening, four-pass deal plus East's extra tile,
front draws, a 16-tile replacement reserve, mandatory initial/in-play Flower
replacement, the versioned turn/claim core, structural evaluation and Tai
scoring, and a match actor with append-before-ack event logging and per-seat
redacted views. Set `ACCELBYTE_MATCH_RUNTIME_URL=ws://127.0.0.1:8081/ws` for
the browser adapter in [client/match-runtime.ts](/Users/junaililie/personal-project/mahjong/client/match-runtime.ts).
The local `rulesengine.FileEventStore` is a recovery-test adapter; the
production AGS/Extend app-owned storage adapter and AGS Session-authoritative
seat resolver are still deployment work. Typed command envelopes and per-seat
broadcasts are integrated locally. Evaluator boundaries are documented in [the rules
evidence](/Users/junaililie/personal-project/mahjong/docs/mahjong-rules-evaluator-evidence.md),
and actor/projection evidence is in [the match actor evidence](/Users/junaililie/personal-project/mahjong/docs/mahjong-match-actor-evidence.md).
