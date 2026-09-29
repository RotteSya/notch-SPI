#!/usr/bin/env bash
# Build and run the real onboarding against an isolated, key-free local mock service.
# Does not replace /Applications/NotchSPI.app or use its defaults/account/observation journal.
set -euo pipefail
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
mkdir -p "$QA_APP/Contents/MacOS"
# Replace the executable inode instead of overwriting a previously validated Mach-O.
cp .build/debug/NotchSPI "$QA_APP/Contents/MacOS/NotchSPI.next"
mv -f "$QA_APP/Contents/MacOS/NotchSPI.next" "$QA_APP/Contents/MacOS/NotchSPI"
cat > "$QA_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.rottesya.notchspi.onboarding-qa</string>
<key>CFBundleExecutable</key><string>NotchSPI</string>
<key>CFBundleName</key><string>NotchSPI Guide QA</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSScreenCaptureUsageDescription</key><string>Capture a practice question to verify the welcome guide.</string>
</dict></plist>
PLIST
# Local ad-hoc signing seals the assembled bundle; never use the release signing identity.
codesign --force --sign - --timestamp=none "$QA_APP"
codesign --verify --strict "$QA_APP"
PORT="$QA_PORT" ./scripts/dev.sh --server-only > "$QA_OUTPUT/server.log" 2>&1 &
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
