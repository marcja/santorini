#!/bin/sh
# Opt-in local enforcement: points git at the version-controlled .githooks/
# directory so `git commit` runs pre-commit (Biome lint/format). Run once
# per clone: `sh scripts/install-hooks.sh`. CI enforces the same check
# regardless, so skipping this is safe, just less convenient.
set -e
git config core.hooksPath .githooks
echo "Installed: git commit now runs .githooks/pre-commit (Biome lint/format)."
