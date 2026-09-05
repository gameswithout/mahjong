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

## Settlement, finally exercised (run of 2026-08-01)

The first three live rotations ran entirely to exhaustive draws, so table points
stayed at zero and the settlement path never executed in production. A
win-seeking play policy in the verification script (meld whenever the server
offers a meld, discard whatever is furthest from a set) fixed that. Session
`9506df51a184401d9bdde4c8f11935b0`:

```
hand 1  dealer 1efd5718  discard        baac6a08 +2   1efd5718 -2
hand 2  dealer fd27646f  discard        44de1263 +2   baac6a08 -2
hand 3  dealer 44de1263  zimo           44de1263 +18  three opponents -6 each
hand 4  dealer 44de1263  exhaustive     seats_dealt stays 3 — continuation
hand 5  dealer baac6a08  exhaustive     seats_dealt 4
rotation_completed  reason rotation_complete · 5 hands · 4 distinct dealers
podium  44de1263 #1 +20 · fd27646f #2 -6 tie · baac6a08 #3 -6 tie · 1efd5718 #4 -8
```

What each line establishes that no earlier run could:

- **`RebaseHandResult` executed for real.** The engine reports a result in wind
  space; the rotation converts it to table positions before tallying. Hands 1
  and 2 moved exactly two seats in opposite directions, and the cumulative
  totals are the sum of both hands rather than either alone.
- **Both settlement shapes ran.** A discard win charges one payer; a Zimo
  charges all three opponents (§7.3), which hand 3 shows as +18 against three
  −6s. The dealer won that hand, so the dealer multiplier is in the numbers too.
- **The balance invariant now means something.** It had been passing on four
  zeroes; here it holds across +20 / −6 / −6 / −8.
- **A continuation is not progress.** The dealer won hand 3 and retained the
  deal, so hand 4 played with `hands_played: 4` and `seats_dealt: 3`. A progress
  bar counting hands would have called this rotation finished while a whole
  player had not yet dealt — which is why `seats_dealt` is what the UI reports.
- **The tie-break is selective.** §8.4 breaks equal table points for display but
  keeps them a genuine rating tie. Here only the two players actually level at
  −6 carry `rating_tie`; first and fourth do not. Earlier runs finished with all
  four tied at zero, where a flag set for everyone would have looked identical
  to a correct one.

Anything computing §12.4 Elo must read that flag rather than the displayed
position.

## Not proven


The 60-minute `time_limit` ending has not occurred live: all four rotations so
far completed their round. §8.4 makes the share of matches ending on the limit a
required telemetry metric, so that path is worth exercising deliberately rather
than waiting for a slow table to produce it.

No hand has yet ended by rob or by one of the §5.9 special wins (Heavenly,
Eight Flowers). The runtime declines those windows automatically because no
player command surface accepts them yet, so they cannot occur in a live run
until that gap is closed.
