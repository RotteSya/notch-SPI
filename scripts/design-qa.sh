#!/usr/bin/env bash
# Offline, isolated UI fixtures; this app never answers real questions.
set -euo pipefail
cd "$(dirname "$0")/.."
scenario="${1:-answer}"
shift "$(( $# > 0 ? 1 : 0 ))"
case "$scenario" in
  ready|answer|success|welcome|working|failure|long|multiline|multiple|mixed|collecting|collecting-1|collecting-2|collecting-3|collecting-4|multi-flow|reasoning) ;;
  *) echo "Unknown design fixture: $scenario" >&2; exit 2 ;;
esac
swift build
bin_dir="$(swift build --show-bin-path)"
qa_app="$PWD/output/design-qa/NotchSPI Design QA.app"
mkdir -p "$qa_app/Contents/MacOS"
cp "$bin_dir/NotchSPI" "$qa_app/Contents/MacOS/NotchSPI.next"
mv "$qa_app/Contents/MacOS/NotchSPI.next" "$qa_app/Contents/MacOS/NotchSPI"
cat > "$qa_app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.rottesya.notchspi.design-qa</string>
<key>CFBundleExecutable</key><string>NotchSPI</string>
<key>CFBundleName</key><string>NotchSPI Design QA</string>
<key>CFBundleDisplayName</key><string>NotchSPI Offline Design QA</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - --timestamp=none "$qa_app"
echo "Offline design fixture: $scenario. No real requests or account."
NSPI_QA_EPHEMERAL=1 NSPI_VISUAL_QA=1 "$qa_app/Contents/MacOS/NotchSPI" \
  --qa-regular --qa-design-review "$scenario" "$@"
