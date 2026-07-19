# AGS Environment Setup — Mahjong

This game runs on its **own AGS account/studio**, separate from any other AccelByte account you may use (e.g., an employer studio). Every developer on this repo — currently the Product Owner and one teammate — must point their tooling at the game's account before doing any AGS work here.

**The one rule:** this repo's project config (`.env`, once the workspace exists) is the source of truth for namespace and base URL. If your CLI profile, MCP server, or muscle memory disagrees with it, stop and fix the tooling — never "just run it" against whatever account your tools happen to be logged into.

## 0. Values for this project (account owner fills in, then commits)

| Key | Value |
| --- | --- |
| Deployment type | Shared Cloud |
| Studio namespace | `gameswithout` |
| Tooling/API base URL | `https://gameswithout.prod.gamingservices.accelbyte.io` |
| Browser/game-title base URL | `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io` |
| AGS API MCP URL | `https://gameswithout.prod.gamingservices.accelbyte.io/mcp/gameswithout-mahjong` |
| Game namespace (dev) | `gameswithout-mahjong` |
| Game namespace (prod) | *(created later — Admin Portal, human in the loop)* |
| Public IAM client (web/PWA) | `<PUBLIC_CLIENT_ID — still required for browser/player login>` |
| Confidential IAM client (tooling/CI/Extend) | `373617a151fe4d3f92be11f4a045cba5` — secret NEVER in this repo |

The tooling/API host is the publisher-level Shared Cloud shape; the browser
SDK uses the game-title-level host shown above for Lobby and player APIs. If
the game account is Private Cloud, use the account owner's supplied host
instead; do not infer or swap hosts without confirmation.

## 1. One-time, account owner (Admin Portal of the game account)

1. **Invite each developer** as an Admin Portal member of the game account with their **own login** (Admin Portal → members/roles). Never share one login between people — audit trails (§13.4, §15.10 of the product spec) assume individual identities.
2. **Create the dev namespace** in the Admin Portal. Namespace creation is a portal operation with a human in the loop — don't script it.
3. **Create IAM clients** in that namespace (via `/ags connect-portal` from a correctly-profiled session, or manually in the portal):
   - **Public** client for the web/PWA game client (PKCE; no secret in any client-side config). Must allow redirect URI `http://127.0.0.1:8080` if you also want it usable for `ags auth login`.
   - **Confidential** client for server-side tooling, CI, and Extend apps. Store its secret in a password manager / secrets vault and share person-to-person — never in this repo, never in chat logs you keep.
4. Fill in the table above and commit this file.

## 2. Per-developer: AGS CLI profile (both of you)

The CLI supports named profiles; keep the game's account in its own profile so it never collides with any other AccelByte login you have.

```bash
# one-time: creates/updates the mahjong profile with non-secret project values
./scripts/configure-ags-cli.sh
./scripts/login-ags-cli.sh  # enter the secret from the project vault
ags auth status         # verify: right portal, namespace, and tooling client
ags profile show        # verify: base-url + namespace match the table above
```

Do not use plain `ags auth login` for this profile. The CLI defaults that
command to browser authorization-code login even when `grant-type` is present
in profile config. The project login script explicitly selects
`client-credentials`, which is required by the confidential tooling client.

Daily hygiene:

```bash
ags profile list                 # shows which profile is active
ags profile use mahjong          # before any AGS work on this repo
ags profile use default          # back to your other account afterwards
```

Before any state-changing command, run `ags auth status` and `ags profile show` and check they match Section 0. If the active profile and this repo's `.env` ever disagree, stop.

## 3. Per-developer: AGS API MCP server (Claude Code plugin)

The `accelbyte-ai-plugins` plugin reads its MCP URL from plugin config (`AGS_API_MCP_URL`), stored in your **user-level** `~/.claude/settings.json` under `pluginConfigs."accelbyte-ai-plugins@accelbyte".options`.

- **Teammate (no other AccelByte account):** set it once to the game URL from Section 0 and forget it.
- **If you also use another AGS studio at work:** the user-level value is machine-global, so it will point *all* your Claude Code sessions at whichever studio it names. Options, in order of preference:
  1. Try a **project-level override**: add the same `pluginConfigs` block to this repo's `.claude/settings.json` with the game URL. Claude Code merges project settings over user settings; verify the plugin honors it by restarting the session in this repo and making one lightweight read-only MCP call, then checking which studio answered. *(Not yet verified — whoever tests this first, record the result here.)*
  2. If project scope doesn't take: **toggle the user-level value** when you switch contexts, and treat the MCP as untrusted-for-this-repo whenever you haven't checked it. The CLI profile path (Section 2) always works regardless.
- After any change: restart the Claude Code session, then confirm auth freshness with one read-only MCP call before real work.

## 4. Project runtime config (`.env`)

When the app workspace exists, each developer keeps a local, **gitignored** `.env`; the repo carries a committed `.env.example` with everything except secrets:

```bash
# .env.example — copy to .env and fill in
ACCELBYTE_BASE_URL=https://gameswithout-mahjong.prod.gamingservices.accelbyte.io
ACCELBYTE_NAMESPACE=gameswithout-mahjong
ACCELBYTE_CLIENT_ID=<PUBLIC_CLIENT_ID>
ACCELBYTE_MATCH_POOL=mahjong-test-pool
ACCELBYTE_SESSION_TEMPLATE=mahjong-test-none
ACCELBYTE_SESSION_CLIENT_VERSION=web-0.0.0
# Confidential secret: tooling/CI only, from the secrets vault — never committed:
# ACCELBYTE_CLIENT_SECRET=
```

The CLI profile and `AGS_BASE_URL` remain on the publisher-level tooling host
for admin/API operations. The browser `.env` uses the game-title host above.
The CLI also honors `AGS_BASE_URL` / `AGS_CLIENT_ID` / `AGS_CLIENT_SECRET`
environment variables for non-interactive use — that's the CI path
(client-credentials grant with the confidential client):
`ags auth login --grant client-credentials`.

## 5. Environment separation

- One namespace per environment inside the game account (dev now; staging/prod when the dev plan's Phase 0 IaC lands). Never test against prod namespaces.
- Per-environment `.env` files (`.env`, `.env.staging`, …) all gitignored; the committed `.env.example` documents the shape only.
- The dev plan's P0 AGS capability-mapping spike (plan §1.3 item 1) runs entirely in the dev namespace under the `mahjong` profile.

## 6. Teammate onboarding checklist

1. Accept the Admin Portal invite for the game account; verify you can log in.
2. Install the AGS CLI if missing (`/ags install-cli`, or grab the latest release of `AccelByte/accelbyte-ags-cli`).
3. Run the Section 2 profile setup; confirm `ags auth status` shows the game account.
4. Install/configure the Claude Code AccelByte plugin; set `AGS_API_MCP_URL` per Section 3.
5. Copy `.env.example` → `.env` (once it exists); get any secret you're entitled to from the vault, not from chat.
6. Read this file's one rule again. Welcome aboard.
