# Casual queue on Xsolla Gaming Services (AccelByte Matchmaking V2)

## Provider configuration

Target namespace: `936895-314916`. Authentication remains Xsolla Login; its game-service token exchange supplies the authenticated Matchmaking V2 requests. This integration uses the deployed provider, not an in-process matchmaker.

Create these dedicated resources in the namespace shown in the user's portal:

1. **Game Sessions → session templates:** export or duplicate the working Mahjong template used by existing Bot play. Name the duplicate `mahjong-casual`. Preserve deployment, timeouts and client version. Use minPlayers 1, maxPlayers 4, preserve the working autoJoin policy, with attributes `{ "game_mode":"unranked", "full_rotation":true, "ai_practice":true }`. The last flag authorizes the existing runtime's deterministic Bot-seat padding, not a Practice mode; game_mode takes precedence. Do not change the Ranked template.
2. **Matchmaking → Matchmaking Configurations → Create Rulesets:** name `mahjong-casual-rules`, use the built-in match function (custom function disabled), one team with four players. Flex after 10 seconds to min one/max four players. Disable auto-backfill: no new human is admitted after Bot seats are assigned. The API payload is [casual-rules.json](casual-rules.json); if the portal editor accepts only rule data, paste just its `data` object.
3. **Match Pools:** create `mahjong-casual-pool`, select the Casual ruleset and template, built-in default match function, ticket lifetime 120 seconds. [casual-pool.json](casual-pool.json) is the intended mapping; verify the available match-function name in this deployment rather than guessing a custom function.

To prepare a complete template while retaining the working deployment fields:

```sh
node scripts/prepare-casual-matchmaking.mjs /path/to/exported-working-template.json
```

This creates reviewable JSON under `.artifacts/casual-matchmaking` and makes no provider changes. The current session resolver already supports one to three humans plus deterministic Bots when these attributes are present.

## Client enablement

Only after provider resources are created and verified, set `ACCELBYTE_UNRANKED_MATCH_POOL=mahjong-casual-pool` in local `.env` and the Pages build configuration; restart Vite/rebuild. The environment variable retains its historical protocol name, while the player-facing label is Casual. Do not substitute the legacy Jade-staked pool.

With a configured pool, the service owns the ten-second relaxation and Bot fallback; the client waits up to 60 seconds for a concrete session ID. Network errors or a provider timeout never silently split queued humans into private Bot tables. Match-found without a session ID keeps polling. A retained ticket is reused after a handoff or cancellation failure. With no pool, legacy solo Bot play remains available; parties explicitly report unconfigured matchmaking rather than splitting up.

The party leader submits one ticket with the Party session ID; followers never create tickets. They watch their authenticated session list for a newly created active Casual table containing every connected party member, then use the ordinary join flow. Old/unrelated sessions and non-Casual templates are ignored. This follower discovery needs the provider's session-list response to expose active state, creation time, attributes and the full roster; verify that contract in the live party smoke test.

## Acceptance checks before enabling production

- One solo ticket: no four-human match before flexing; after flexing one human and three Bots start a full rotation without Jade reservation.
- Two/three concurrent solo tickets: same table with two/one Bots.
- Four humans or a four-person party: same table without waiting for flexing.
- Two/three-person party: one ticket, same table for every member, fill remaining seats with humans where available and then Bots.
- Only party leader queues; followers enter through service session discovery.
- Cancel before match: ticket removed, no orphan table. Cancellation race: adopt the service match; do not create another table.
- Expired session renews once; rejected renewal returns to login. Outage is an error, not evidence that nobody is queuing.
- Ranked remains human-only and uses its own pool and policy.

Provider rules reference: https://docs.accelbyte.io/gaming-services/modules/multiplayer/matchmaking/configuring-match-rulesets/

## Verification status

The user confirmed creation of both Casual and Ranked rulesets, session templates and match pools in the Xsolla portal on November 6, 2026. The supplied pool-list screenshot confirms the expected ruleset/template mapping and default match function. The user also confirmed creation of the server-maintained `elo` statistic, with proposed initial value 1200.

Local `.env` now selects `mahjong-casual-pool` for integration testing. Production enablement and live one/two/three/four-player/party smoke checks remain pending. Ranked is enabled locally through `ACCELBYTE_ROTATION_MATCH_POOL=mahjong-ranked-pool`. It submits individual tickets (multi-member parties are blocked), requires four humans and reports timeout after 120 seconds with confirmed cancellation/race recovery. The provider may expire the ticket first. Authoritative Elo initialization/settlement and the approved Ranked Jade policy still require integration; queue timeout testing does not verify those systems. Production enablement remains pending.
