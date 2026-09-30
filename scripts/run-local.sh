#!/usr/bin/env bash
# Build the current app for normal local use. Keep the user's service, account,
# permissions and completed onboarding; do not start a fixture server.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ $# != 0 ]]; then
  echo "Usage: $0" >&2
  echo "Builds and opens dist-qa/NotchSPI.app using your saved settings." >&2
  exit 2
fi
if pgrep -x NotchSPI >/dev/null; then
  echo "Quit the running NotchSPI / Mock QA app first to avoid duplicate hotkeys." >&2
  exit 1
fi

./scripts/package.sh qa
echo "Opening normal local build (saved service and account; no mock or forced onboarding)."
open "$REPO_ROOT/dist-qa/NotchSPI.app"
