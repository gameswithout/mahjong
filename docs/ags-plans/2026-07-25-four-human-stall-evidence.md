# Four-Human Stall — Investigation and Resolution Evidence

- Date: 2026-07-25
- Namespace: `gameswithout-mahjong`
- Match pool: `mahjong-test-pool`
- Status: gameplay stall resolved and deployed; AGS Wallet convergence
  verified
- Related:
  [Staked Bamboo quick play](./2026-07-24-staked-bamboo-quick-play.md) and
  [current release evidence](./2026-07-24-staked-bamboo-quick-play-evidence.md)

## Historical symptom

Early `npm run test:four-human` runs progressed through real matchmaking,
Session creation, private-seat verification, and more than 100 legal actions,
then all four tables disappeared together:

| Run | Hand budget | Actions | Outcome |
| --- | --- | --- | --- |
| 1 | 900s | 117 | HTTP 400 on `GetMatchState`; all seats wedged |
| 2 | 300s | 121 | Same HTTP 400 wedge |
| 3 | 240s | 71 | Still progressing when the budget ended |
| 4 | 1200s | 75 | Draw fallback detached during a harness click |
| 5 | 1800s | 100+ | Reconnect behavior verified; external timeout |
| 6 | 1800s | 107 | HTTP 400 response body captured |

The captured response was:

```json
{"code":9,"message":"reserve Jade before joining a public match"}
```

The client mapped that failed precondition to `protocol`. A failed poll then
replaced the joined state, discarded the last authoritative view, and
unmounted every table.

## Root cause

The server-side sequence was deterministic:

1. `SettleJadeMatch` consumed all four reservations.
2. Clients continued polling `GetMatchState` to read the hand result.
3. Every state read called `economy.Bind`.
4. `BindJadeReservation` accepted only active or bound reservations.
5. The just-consumed reservation therefore produced
   `ErrReservationMissing`, surfaced as HTTP 400.

Practice was unaffected because bot-containing matches skip Jade binding.
This is why the issue appeared only at the end of an all-human staked hand.

## Repairs retained on `main`

### Authoritative service

`BindJadeReservation` now treats a reservation consumed by the same runtime as
a successful bind. The lookup remains scoped to player and runtime, so an old
match cannot satisfy a different match's entry requirement. The PostgreSQL
integration test proves both the post-settlement read and the unreserved-player
rejection.

### Live-table resilience

A failed poll no longer destroys an established table. The last good view
stays mounted behind a reconnecting notice, pending controls are released, and
the normal polling loop can recover. A persistent failure escalates to the
manual error panel 30 seconds after the first failure; later failures do not
extend that deadline.

The automatic-draw fallback remains mounted and disabled while a draw request
is pending. This prevents the control from disappearing underneath a pointer
or touch when the 320 ms automatic draw fires.

### Four-account harness

The harness now:

- retries clicks when React replaces a frequently polled control;
- asserts a transient sync failure keeps the table mounted;
- verifies the reconnect notice appears and clears without changing seats;
- counts committed legal actions rather than tile inspections;
- captures failed requests and error response bodies;
- requires all result views to report the same settlement journal;
- requires exact post-write `AGS Wallet synced` readback before passing.

## Verification

After deploying the server repair, four distinct guest accounts created a real
four-member AGS Session, joined the deployed service, passed private-seat and
reconnect checks, played 125 authoritative actions, and reached the shared Jade
settlement result. That first run isolated a separate Wallet release gate.

The final production journey against image `wallet-reconcile-20260725-r3`
closed that gate: four distinct seats completed 123 legal actions; all four
result views reported Wallet status `synced`; one settlement journal was
shared across the table; total Jade remained 20,000; every player returned
with 5,000 Jade; and all four Session leave responses succeeded.

Regression coverage retained on `main` includes:

- post-settlement reservation binding;
- rejection of a player who never reserved;
- table preservation and recovery after a failed poll;
- fixed grace-period escalation;
- pending-command release after failure;
- stable, disabled draw fallback during automatic draw.

## Provenance

The obsolete investigation branch ended at `8cd9355`. Its functional work was
superseded by `d4c0047` on `main`; the still-useful resilience tests, draw
control behavior, and historical run evidence were adapted to the current
codebase before that branch and its worktree were removed.
