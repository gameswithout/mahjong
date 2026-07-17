#!/usr/bin/env sh
set -eu

"$(dirname "$0")/configure-ags-cli.sh"

exec ags auth login --grant client-credentials "$@"
