# Full Rotation player flow — release evidence

- Date: 2026-07-30
- Status: Complete
- Plan:
  [Full Rotation player flow](./2026-07-30-full-rotation-player-flow.md)
- Release source: `1b717ff`
- Namespace: `gameswithout-mahjong`
- Pool: `mahjong-full-rotation-pool`
- Session template: `mahjong-full-rotation`

## Released player journey

```text
Linked player
  -> Full Rotation
  -> queue in the dedicated four-player pool
  -> automatic shared Session join
  -> four rotating dealerships
  -> inter-hand result and countdown
  -> final four-place podium
  -> Play Again in the Full Rotation pool

Guest
  -> Full Rotation remains locked
  -> create or sign in to a full account
```

The selected matchmaking mode is retained across ticket creation, polling,
cancellation, Session handoff, error retry, and post-result requeue. Full
Rotation never enters the Quick Play Jade reserve, release, stake-copy, or
settlement paths.

## Production configuration

Live AGS reads confirmed:

- `mahjong-full-rotation-pool` uses the existing four-player ruleset,
  `mahjong-test-rules`, and creates `mahjong-full-rotation` Sessions.
- `mahjong-full-rotation` carries `full_rotation: true` and automatic member
  leave behavior.
- The production Pages build receives
  `ACCELBYTE_ROTATION_MATCH_POOL=mahjong-full-rotation-pool`.
- A four-ticket infrastructure smoke formed one Session, joined a four-member
  roster, and left successfully.

The production client is
[https://gameswithout.github.io/mahjong/](https://gameswithout.github.io/mahjong/).
Its release workflow for `1b717ff` completed successfully and the deployed page
returned HTTP 200.

## Extend deployment

```text
App:            mahjong-match-service
Scenario:       service-extension
Image:          full-rotation-1b717ff
Deployment:     dd7d3d3d-45b4-48a2-9754-a68236132837
Created:        2026-07-31T01:37:35.243Z
Healthy:        2026-07-31T01:38:07.848Z
Status:         deployment-running
Service URL:    https://gameswithout-mahjong.prod.gamingservices.accelbyte.io/ext-gameswithout-mahjong-mahjong-match-service
```

Post-rollout probes confirmed:

- the deployed OpenAPI document returns HTTP 200;
- a protected Jade request without a bearer token returns HTTP 401 rather than
  404 or 5xx;
- the active Extend image tag and deployment ID match the release above.

## Complete live rotation

`node scripts/verify-live-full-rotation.mjs` used four isolated disposable
players to exercise the production infrastructure below the browser
eligibility gate. One clean run proved:

- four seats joined a dedicated Full Rotation Session without reserving Jade;
- four hands completed and all four players dealt exactly once;
- all four dealer identities were distinct, winds turned, and table positions
  remained stable;
- every hand paid the mode-specific 50 XP;
- final placement contained four entries and placement XP matched the
  published 400/250/150/100 schedule;
- each player's 5,000 Jade balance was unchanged and no Jade remained
  reserved;
- the rotation ended with reason `rotation_complete`.

All four hands happened to be exhaustive draws. Table points therefore stayed
at zero for every seat and the conservation assertion passed, but this live
sample did not exercise a non-zero transfer. Deterministic rules and service
integration tests cover winner, loser, dealer, multiple-winner, uncapped
transfer, and idempotent settlement cases.

The disposable-player harness intentionally bypasses the browser's
linked-account gate so it can validate backend mode selection and sequencing.
It does not claim to prove guest eligibility enforcement. The guest lock and
defensive client guard are instead pinned by component tests; authoritative
good-standing enforcement will be added with P2.4 rating writes.

## Automated verification

| Check | Result |
| --- | --- |
| Client unit/component suite | 50 files, 439 tests passed |
| Client production build | Passed |
| Root Go module | Passed |
| Match Service Go module | Passed |
| Rules engine | Passed |
| Chromium UI evidence | Visibility, touch, responsive, accessibility, runtime-error, and bundle-budget gates passed |
| Focused queue/requeue and telemetry tests | 20 tests passed |
| Full Rotation script syntax | Passed |
| Git diff whitespace check | Passed |

The matching
[CI run](https://github.com/gameswithout/mahjong/actions/runs/30596719781)
passed the client, root Go, Match Service Go race/vendor, and rendered-UI jobs.
The matching
[Pages run](https://github.com/gameswithout/mahjong/actions/runs/30596719784)
also passed.

## Authorization evidence

```text
Player caller:          browser public OAuth client + player bearer token
Browser secret:         none
Runtime caller:         Extend-injected confidential client
Runtime access:         existing Session READ access
Operator caller:        AGS authorization-code CLI session
Operator scope:         Session configuration and Matchmaking pool reads/writes
Live guest gate proof:  no — deliberately verified locally at the UI boundary
```

No OAuth secret, access token, device ID, ticket ID, Session ID, party ID, or
full user ID is retained in this evidence.

## Release conclusion

Full Rotation is playable and production-released as its own no-Jade mode. The
remaining competitive-progression work is P2.4: Elo, seasonal leaderboard
publication, persisted placement statistics, server-authoritative ranked
eligibility, and the four rotation achievement counters.
