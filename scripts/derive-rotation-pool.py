#!/usr/bin/env python3
"""Derive the §8.4 Full Rotation match pool from Quick Play's.

Only two things may differ: the pool name, and the session template that
carries full_rotation. Everything else — the ruleset above all — is copied,
because both modes seat exactly four players with no skill input and a second
hand-written ruleset would only be an opportunity for the two to drift.

Usage: derive-rotation-pool.py <quick-play-pool.json> <name> <template> <out>
"""

import json
import sys


def field(source, *names, default=None):
    """Read a field under any of its spellings.

    The AGS matchmaking API uses snake_case, but responses have been seen
    camelCased depending on the path they came through, and silently falling
    back to a default for a required field would produce a pool that matches
    differently from Quick Play with nothing to show for it.
    """
    for name in names:
        if name in source and source[name] is not None:
            return source[name]
    return default


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    source_path, pool_name, template_name, out_path = sys.argv[1:]

    with open(source_path) as handle:
        source = json.load(handle)
    # Some CLI outputs wrap the resource; unwrap before reading fields.
    if isinstance(source, dict) and "data" in source and isinstance(source["data"], dict):
        source = source["data"]

    ruleset = field(source, "rule_set", "ruleSet")
    if not ruleset:
        print(
            f"No ruleset on the Quick Play pool in {source_path}.\n"
            "Inspect that file: the rotation pool must reuse it, not invent one.",
            file=sys.stderr,
        )
        return 1

    match_function = field(source, "match_function", "matchFunction")
    if not match_function:
        print(
            f"No match function on the Quick Play pool in {source_path}.\n"
            "It is required by the create API and must not be guessed.",
            file=sys.stderr,
        )
        return 1

    pool = {
        "name": pool_name,
        "rule_set": ruleset,
        "session_template": template_name,
        "match_function": match_function,
        "ticket_expiration_seconds": field(
            source, "ticket_expiration_seconds", "ticketExpirationSeconds", default=300
        ),
        "backfill_ticket_expiration_seconds": field(
            source,
            "backfill_ticket_expiration_seconds",
            "backfillTicketExpirationSeconds",
            default=300,
        ),
        "backfill_proposal_expiration_seconds": field(
            source,
            "backfill_proposal_expiration_seconds",
            "backfillProposalExpirationSeconds",
            default=300,
        ),
        "auto_accept_backfill_proposal": field(
            source,
            "auto_accept_backfill_proposal",
            "autoAcceptBackfillProposal",
            default=True,
        ),
    }

    for optional, camel in (
        ("crossplay_disabled", "crossplayDisabled"),
        ("platform_group_enabled", "platformGroupEnabled"),
        ("best_latency_calculation_method", "bestLatencyCalculationMethod"),
    ):
        value = field(source, optional, camel)
        if value is not None:
            pool[optional] = value

    with open(out_path, "w") as handle:
        json.dump(pool, handle, indent=2)
        handle.write("\n")
    print(json.dumps(pool, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
