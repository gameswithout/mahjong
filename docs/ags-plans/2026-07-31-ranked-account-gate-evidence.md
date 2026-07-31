# §10.1 ranked-account gate — live evidence

- Date: 2026-07-31
- Image: `full-rotation-gate-cd6179e` (deployment
  `48a106e6-835e-4d94-83a5-118f44d2f484`, healthy within ~30s of rollout)
- Script: `scripts/verify-live-full-rotation.mjs`
- Session: `68bc7d8a5e104328887feaa1917e0e4a`, pool
  `mahjong-full-rotation-pool`

## Why this existed to prove

Full Rotation shipped with the guest gate in the client only: `isGuestAccount`
checks in `App.tsx` that hide the lobby entry and guard the click. That stops
real players in the real UI and nothing else.

It was not a theoretical gap. The 2026-07-30 live verification of Full Rotation
**seated four headless guest accounts in a ranked rotation** — it talks to the
match service directly and never runs the client code the gate lives in. Ranked
results feed §12.4 rating, so the service has to decide for itself.

## What one clean run shows

```
guest_refused       403 · code 7 · "Full Rotation is ranked and needs a linked
                    account. Create or sign in to a full account to play it."
all_seats_joined    four linked accounts, no Jade reservation, hand 1 open
hand 1  dealer 9027334d  seats_dealt 1  exhaustive_draw  xp 50
hand 2  dealer ba821252  seats_dealt 2  exhaustive_draw  xp 50
hand 3  dealer 28d11548  seats_dealt 3  exhaustive_draw  xp 50
hand 4  dealer d3a5029d  seats_dealt 4  exhaustive_draw  xp 50
rotation_completed  reason rotation_complete · 4 distinct dealers ·
                    winds_turned true · podium of 4
player_result       jade 5000 -> 5000 for all four; nothing reserved
                    lifetime XP 700 / 450 / 400 / 550
```

The refusal is the load-bearing line. A guest holding a **valid** token was
refused a seat at the *same* ranked table that four linked accounts then joined,
so this is the service enforcing §10.1 rather than the client declining to offer
it.

## What counts as a guest

An account with no email address — the definition `client/iam.ts` already uses,
taken rather than invented so the two halves cannot disagree.

Two apparently better signals were checked and rejected:

- `authType` reads `EMAILPASSWD` on a headless account too, so it separates
  nothing.
- The JWT's `jflgs` and `ipf` claims do differ for a device login (`jflgs: 4`,
  `ipf: "device"`), but both are undocumented, and `ipf` describes how *this
  token* was obtained rather than whether the account has an identity — a guest
  who upgrades still holds the token they logged in with.

`emailVerified` is deliberately **not** required. §10.2's upgrade attaches an
email and the account stops being a guest at that moment; requiring verification
would gate ranked play behind mail this namespace does not deliver, and would be
stricter than the client's own rule. The four accounts here are unverified and
were admitted, which is the intended behaviour.

## Failure direction

The gate refuses when it cannot tell: unreachable IAM, a 401, a malformed
profile, and an unconfigured resolver all refuse ranked entry rather than
defaulting open. A gate that opens whenever something is wrong is absent exactly
when it matters. The two outcomes carry different gRPC codes — `PermissionDenied`
for "make an account", `Unavailable` for "try again shortly" — so a player who
already has an account is never told to go and make one.

Quick Play is untouched; a guest can still take a Quick Play seat, which is the
mode the guest experience exists for.

## Not proven

**Every hand was an exhaustive draw, for the third live run running.** Table
points therefore stayed at zero, all four placements are ties, and the
balance-to-zero invariant passed on four zeroes.

**The settlement path has still never executed in production with a non-zero
number** — including `RebaseHandResult`, the wind-to-position conversion the
rotation architecture rests on. It is covered by unit and integration tests, not
by any live run. The script takes a win when one is offered, but the simple
policy it plays (discard the last tile, pass every claim) never reaches a
winning shape, so no win is ever offered. Closing this needs rules-aware play in
the verification script.

The 60-minute `time_limit` ending has also not occurred live; all three runs
completed their round.
