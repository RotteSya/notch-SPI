#!/usr/bin/env bash
# Build and run the real onboarding against an isolated, key-free local mock service.
# Does not replace /Applications/NotchSPI.app or use its defaults/account/observation journal.
set -euo pipefail

# This is a UI fixture, not a usable tutor. Require an explicit opt-in so the
# canned practice answer cannot be mistaken for the normal application.
if [[ "${1:-}" != "--mock" ]]; then
  echo "Usage: $0 --mock [client arguments]" >&2
  echo "UI-only fixture: all questions receive the same canned answer." >&2
  echo "For normal use with the configured service: ./scripts/run-local.sh" >&2
  exit 2
fi
shift
echo "Starting MOCK onboarding preview: fixed answers, temporary account."

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
QA_PORT="${NSPI_ONBOARDING_PORT:-18929}"
QA_OUTPUT="$REPO_ROOT/output/onboarding-qa"
QA_APP="$QA_OUTPUT/NotchSPI Guide QA.app"
QA_SERVER_PID=""
cleanup() {
  if [[ -n "$QA_SERVER_PID" ]]; then
    kill "$QA_SERVER_PID" 2>/dev/null || true
    wait "$QA_SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM
mkdir -p "$QA_OUTPUT"
swift build
bin_dir="$(swift build --show-bin-path)"
# shellcheck source=scripts/lib/qa-app.sh
source "$REPO_ROOT/scripts/lib/qa-app.sh"
assemble_qa_app "$QA_APP" "com.rottesya.notchspi.onboarding-qa" "NotchSPI Guide QA" "NotchSPI Mock QA" "$bin_dir" \
  "Capture a practice question to verify the welcome guide."
PORT="$QA_PORT" ./scripts/dev.sh --server-only --free-trial > "$QA_OUTPUT/server.log" 2>&1 &
QA_SERVER_PID=$!
QA_READY=0
for _ in {1..50}; do
  if ! kill -0 "$QA_SERVER_PID" 2>/dev/null; then
    cat "$QA_OUTPUT/server.log" >&2
    exit 1
  fi
  if rg -q 'server-only mode' "$QA_OUTPUT/server.log"; then QA_READY=1; break; fi
  sleep 0.2
done
[[ "$QA_READY" == 1 ]] || { echo "Local QA server did not start; see $QA_OUTPUT/server.log" >&2; exit 1; }
NSPI_QA_EPHEMERAL=1 NSPI_VISUAL_QA=1 \
  "$QA_APP/Contents/MacOS/NotchSPI" --qa-regular --qa-onboarding \
  -official.baseURL "http://127.0.0.1:$QA_PORT" "$@"
