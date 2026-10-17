#!/usr/bin/env bash
# Offline, isolated UI fixtures; this app never answers real questions.
set -euo pipefail
cd "$(dirname "$0")/.."
scenario="${1:-answer}"
shift "$(( $# > 0 ? 1 : 0 ))"
case "$scenario" in
  trial|guide-walkthrough|network-wait|network-failure|retake-review|shelf-motion|reading-stability|math-reading|reading-consistency|expanded-answer|history|history-empty|month-pass|settings|motion-review|intake-review|permission|ready|answer|success|welcome|working|failure|long|multiline|multiple|mixed|collecting|collecting-1|collecting-2|collecting-3|collecting-4|multi-flow|reasoning) ;;
  *) echo "Unknown design fixture: $scenario" >&2; exit 2 ;;
esac
swift build
bin_dir="$(swift build --show-bin-path)"
qa_app="$PWD/output/design-qa/NotchSPI Design QA.app"
# shellcheck source=scripts/lib/qa-app.sh
source "$PWD/scripts/lib/qa-app.sh"
assemble_qa_app "$qa_app" "com.rottesya.notchspi.design-qa" "NotchSPI Design QA" "NotchSPI Offline Design QA" "$bin_dir"
echo "Offline design fixture: $scenario. No real requests or account."
NSPI_QA_EPHEMERAL=1 NSPI_VISUAL_QA=1 "$qa_app/Contents/MacOS/NotchSPI" \
  --qa-regular --qa-design-review "$scenario" "$@"
