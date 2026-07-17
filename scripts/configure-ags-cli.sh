#!/usr/bin/env sh
set -eu

profile="mahjong"

if ! command -v ags >/dev/null 2>&1; then
  echo "AGS CLI is not installed or is not on PATH." >&2
  exit 1
fi

if ! ags profile show "$profile" >/dev/null 2>&1; then
  ags profile create "$profile"
fi

ags profile use "$profile"
ags config set base-url "https://gameswithout.prod.gamingservices.accelbyte.io"
ags config set namespace "gameswithout-mahjong"
ags config set client-id "373617a151fe4d3f92be11f4a045cba5"

ags profile show "$profile"
