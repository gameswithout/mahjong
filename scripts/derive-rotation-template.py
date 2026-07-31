#!/usr/bin/env python3
"""Derive the §8.4 Full Rotation session template from Quick Play's.

Only two things may differ: the template name, and the attributes that carry
full_rotation. Everything else is copied.

Hand-writing this template was a mistake worth recording. The guessed values
differed from Quick Play's in four ways that would each have broken seating
quietly rather than loudly:

  joinability     CLOSED vs OPEN — CLOSED forbids member changes after
                  creation, so matchmaking could not seat anyone.
  minPlayers      4 vs 1 — the ruleset decides how many players a match needs;
                  the template deciding differently is a second opinion.
  clientVersion   "" vs "web-0.0.0" — sessions are partitioned by client
                  version, so an empty one strands rotation players in a
                  partition no client asks for.
  autoLeaveSession / maxActiveSessions — omitted entirely, so they would have
                  taken API defaults rather than the values Quick Play runs.

None of those would have produced an error at creation time. They would have
produced a pool that never seats anybody.

Usage: derive-rotation-template.py <quick-play-template.json> <name> <out>
"""

import json
import sys

# Fields that must not be copied: identity, server-assigned metadata, and the
# attributes this mode exists to change.
NOT_COPIED = {
    "name",
    "namespace",
    "attributes",
    "createdAt",
    "updatedAt",
    "created_at",
    "updated_at",
    "version",
}


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    source_path, template_name, out_path = sys.argv[1:]

    with open(source_path) as handle:
        source = json.load(handle)
    if isinstance(source, dict) and "data" in source and isinstance(source["data"], dict):
        source = source["data"]

    if not source.get("name"):
        print(f"{source_path} does not look like a session template.", file=sys.stderr)
        return 1

    template = {key: value for key, value in source.items() if key not in NOT_COPIED}
    template["name"] = template_name
    # The one substantive difference. The match service reads this attribute to
    # play the session as a rotation; it lives on the template rather than on
    # anything a client sends, so a client cannot ask for a ranked match it was
    # not matched into.
    template["attributes"] = {"full_rotation": True}

    with open(out_path, "w") as handle:
        json.dump(template, handle, indent=2)
        handle.write("\n")
    print(json.dumps(template, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
