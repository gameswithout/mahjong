// Offline checks for the live verification script's play policy.
//
// The policy decides discards and claims for all four seats during a live
// Full Rotation, and a live run costs ten minutes and four real accounts. These
// checks are what make it worth starting one: a policy that discards a tile it
// does not hold, or answers a claim window with tiles the server did not offer,
// fails every hand and is indistinguishable from a server bug from the outside.
//
// Usage:  node scripts/check-rotation-policy.mjs

import { readFileSync } from "node:fs";
const src = readFileSync("scripts/verify-live-full-rotation.mjs", "utf8");
// The policy functions are pure, so they are lifted out of the script rather
// than duplicated here — a copy would drift from what actually runs.
const start = src.indexOf("const SUITS = new Set");
const end = src.indexOf("// --- Rotation assertions");
const mod = await import("data:text/javascript," + encodeURIComponent(
  src.slice(start, end) + "\nexport { chooseDiscard, chooseClaim, chowTiles };"
));
const { chooseDiscard, chooseClaim } = mod;

const T = (kind, rank, copy = 1) => ({ id: `${kind}-${rank}-${copy}`, kind, rank, copy });
let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  got ${got} want ${want}`}`);
};

// An isolated honour is the most disposable tile in a hand.
check("drops the lone wind",
  chooseDiscard([T("characters",4), T("characters",5), T("characters",6), T("wind",1)]),
  "wind-1-1");

// A paired honour is kept over an isolated suited tile.
check("keeps a wind pair over a floater",
  chooseDiscard([T("wind",1,1), T("wind",1,2), T("dots",2)]),
  "dots-2-1");

// Among isolated suited tiles, terminals go before simples.
check("prefers the terminal",
  chooseDiscard([T("bamboo",1), T("bamboo",5)]),
  "bamboo-1-1");

// A tile with an adjacent neighbour beats a truly isolated one.
check("keeps a connected pair of neighbours",
  chooseDiscard([T("dots",3), T("dots",4), T("characters",9)]),
  "characters-9-1");

// Claims: winning first, then the largest set.
check("wins over everything", chooseClaim({ can_win: true, can_kong: true, can_pong: true }).type, "win");
check("kong over pong",      chooseClaim({ can_kong: true, can_pong: true }).type, "kong");
check("pong over chow",      chooseClaim({ can_pong: true, chow_sets: [{ tile_ids: ["a","b"] }] }).type, "pong");
check("chow when only one",  chooseClaim({ chow_sets: [{ tile_ids: ["a","b"] }] }).type, "chow");
check("passes with nothing", chooseClaim({}).type, "pass");
check("passes on undefined", chooseClaim(undefined).type, "pass");

// A chow must carry the tiles the server named, or the claim is illegal.
//
// The fixture is the *wire* shape, { tile_ids: [...] }, which is what this
// script actually receives. An earlier version of this check used the tuple
// form from protocol/envelope.ts and passed while the live run died on
// "chow is not iterable" — envelope.ts types the shape the browser client has
// already normalized, not the shape on the wire.
const wire = chooseClaim({ chow_sets: [{ tile_ids: ["x1","x2"] }] });
check("carries the chow tiles (wire form)", wire.tile_ids.join(","), "x1,x2");
// The normalized tuple form is accepted too, so the policy does not depend on
// which side of the normalization its input came from.
const tuple = chooseClaim({ chow_sets: [["y1","y2"]] });
check("carries the chow tiles (tuple form)", tuple.tile_ids.join(","), "y1,y2");
check("malformed chow set falls back to pass", chooseClaim({ chow_sets: [{}] }).type, "pass");
check("empty chow list passes", chooseClaim({ chow_sets: [] }).type, "pass");

// Never returns a tile that is not in hand.
const hand = [T("dots",1), T("dots",2), T("dots",3)];
const picked = chooseDiscard(hand);
check("discards from hand", hand.some(t => t.id === picked), true);
check("empty hand yields null", chooseDiscard([]), null);

process.exit(failures ? 1 : 0);
