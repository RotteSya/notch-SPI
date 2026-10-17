#!/usr/bin/env bash
# Assemble an ad-hoc signed app bundle from the SwiftPM debug binary.
# Callers run with the repository as the working directory.

assemble_qa_app() {
  local app_path="$1"
  local bundle_id="$2"
  local bundle_name="$3"
  local display_name="$4"
  local bin_dir="$5"
  local capture_usage="${6:-}"
  local resources_dir
  resources_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/Resources"
  if [[ ! -x "$bin_dir/NotchSPI" ]]; then
    echo "qa-app: missing binary $bin_dir/NotchSPI" >&2
    return 1
  fi
  if [[ ! -d "$bin_dir/SwiftMath_SwiftMath.bundle" ]]; then
    echo "qa-app: SwiftMath resources missing in $bin_dir" >&2
    return 1
  fi
  if [[ ! -d "$resources_dir/ThirdParty" ]]; then
    echo "qa-app: missing $resources_dir/ThirdParty" >&2
    return 1
  fi
  mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources"
  cp "$bin_dir/NotchSPI" "$app_path/Contents/MacOS/NotchSPI.next"
  mv -f "$app_path/Contents/MacOS/NotchSPI.next" "$app_path/Contents/MacOS/NotchSPI"
  ditto "$bin_dir/SwiftMath_SwiftMath.bundle" "$app_path/Contents/Resources/SwiftMath_SwiftMath.bundle"
  ditto "$resources_dir/ThirdParty" "$app_path/Contents/Resources/ThirdParty"
  local capture_xml=""
  if [[ -n "$capture_usage" ]]; then
    capture_xml="<key>NSScreenCaptureUsageDescription</key><string>${capture_usage}</string>"
  fi
  cat > "$app_path/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundle_id}</string>
<key>CFBundleExecutable</key><string>NotchSPI</string>
<key>CFBundleName</key><string>${bundle_name}</string>
<key>CFBundleDisplayName</key><string>${display_name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
${capture_xml}
</dict></plist>
PLIST
  codesign --force --sign - --timestamp=none "$app_path"
  codesign --verify --strict "$app_path"
}
