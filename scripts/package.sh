#!/usr/bin/env bash
# Build the macOS app. Usage: package.sh qa|release [--unsigned]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

usage() {
  echo "Usage: $0 qa|release [--unsigned]" >&2
  echo "  qa       → dist-qa/NotchSPI.app" >&2
  echo "  release  → dist/candidates/<id>/NotchSPI<version>-intel.dmg (Developer ID + notarize + staple)" >&2
  echo "  --unsigned  release only: ad-hoc signed DMG, skip notarization" >&2
}

MODE=""
UNSIGNED=0
for arg in "$@"; do
  case "$arg" in
    qa|release) MODE="$arg" ;;
    --unsigned) UNSIGNED=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "package: unknown argument: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  usage
  exit 1
fi
if [[ "$UNSIGNED" == 1 && "$MODE" != "release" ]]; then
  echo "package: --unsigned is only valid with release" >&2
  exit 1
fi

load_version() {
  local file="$REPO_ROOT/VERSION.env"
  [[ -f "$file" ]] || { echo "package: missing $file" >&2; exit 1; }
  APP_VERSION=""
  BUILD_NUMBER=""
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      APP_VERSION) APP_VERSION="$value" ;;
      BUILD_NUMBER) BUILD_NUMBER="$value" ;;
      *)
        echo "package: unexpected key in VERSION.env: $key" >&2
        exit 1
        ;;
    esac
  done < "$file"
  [[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || {
    echo "package: APP_VERSION must look like 1.2 or 1.2.3 (got '$APP_VERSION')" >&2
    exit 1
  }
  [[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || {
    echo "package: BUILD_NUMBER must be an integer (got '$BUILD_NUMBER')" >&2
    exit 1
  }
}

load_version
PUBLIC_VERSION="$APP_VERSION"
[[ "$PUBLIC_VERSION" =~ ^[0-9]+\.[0-9]+$ ]] && PUBLIC_VERSION="$PUBLIC_VERSION.0"
DMG_NAME="NotchSPI$PUBLIC_VERSION-intel.dmg"

APP_NAME="NotchSPI"
BUNDLE_ID="com.rottesya.notchspi"
ICON_FILE="NotchSPI.icns"
SHORT_VERSION="$APP_VERSION"
DISPLAY_NAME="$APP_NAME"
if [[ "$MODE" == "qa" ]]; then
  DISPLAY_NAME="$APP_NAME (test)"
fi

find_sign_id() {
  if [[ -n "${SIGN_ID:-}" ]]; then
    printf '%s' "$SIGN_ID"
    return
  fi
  security find-identity -v -p codesigning 2>/dev/null \
    | grep 'Developer ID Application' \
    | head -1 \
    | sed -E 's/.*"(.*)".*/\1/' \
    || true
}

SIGN_ID="$(find_sign_id)"
NOTARY_PROFILE="${NOTARY_PROFILE:-notchtutor}"

if [[ "$MODE" == "release" && "$UNSIGNED" != 1 && -z "$SIGN_ID" ]]; then
  echo "package: release requires a Developer ID Application certificate." >&2
  echo "    Pass --unsigned for an ad-hoc local build, or set SIGN_ID." >&2
  exit 1
fi

node scripts/lib/swift-check.mjs "$REPO_ROOT"
PROVENANCE_DIR="$(node scripts/cross-platform/mac-provenance.mjs begin "$MODE")"
CANDIDATE_ID="$(basename "$PROVENANCE_DIR")"

echo "==> Building release binary (x86_64)"
swift build --disable-automatic-resolution --skip-update -c release --arch x86_64
BINDIR="$(swift build --disable-automatic-resolution --skip-update -c release --arch x86_64 --show-bin-path)"
BIN="$BINDIR/$APP_NAME"
[[ -x "$BIN" ]] || { echo "package: missing binary $BIN" >&2; exit 1; }
echo "    $(file "$BIN")"

if [[ "$MODE" == "qa" ]]; then
  OUT="dist-qa"
  APP="$OUT/$APP_NAME.app"
  rm -rf "$APP"
  rm -f "$OUT/delivery-manifest.json"
else
  OUT="dist/candidates/$CANDIDATE_ID"
  [[ ! -e "$OUT" ]] || { echo "package: candidate already exists: $OUT" >&2; exit 1; }
  STAGING="$OUT/staging"
  APP="$STAGING/$APP_NAME.app"
fi

echo "==> Assembling $APP_NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$APP_NAME"
mkdir -p "$APP/Contents/Resources"
ditto "$BINDIR/SwiftMath_SwiftMath.bundle" "$APP/Contents/Resources/SwiftMath_SwiftMath.bundle"
ditto Resources/ThirdParty "$APP/Contents/Resources/ThirdParty"
chmod +x "$APP/Contents/MacOS/$APP_NAME"
cp "Resources/$ICON_FILE" "$APP/Contents/Resources/$ICON_FILE"
cp "$PROVENANCE_DIR/build-provenance.json" "$APP/Contents/Resources/build-provenance.json"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>NotchSPI Account</string><key>CFBundleURLSchemes</key><array><string>notchspi</string></array></dict></array>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$DISPLAY_NAME</string>
  <key>CFBundleIconFile</key><string>$ICON_FILE</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$SHORT_VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NUMBER</string>
  <key>LSMinimumSystemVersion</key><string>12.3</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>NotchSPI</string>
</dict>
</plist>
PLIST

sign_app() {
  if [[ -n "$SIGN_ID" && "$UNSIGNED" != 1 ]]; then
    echo "==> Code signing (Developer ID + hardened runtime): $SIGN_ID"
    codesign --force --deep --options runtime --timestamp --sign "$SIGN_ID" "$APP"
  else
    echo "==> Ad-hoc code signing"
    codesign --force --deep --sign - "$APP"
  fi
}

sign_app
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo "==> Verifying app signature"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/    /'

if [[ "$MODE" == "qa" ]]; then
  node scripts/cross-platform/mac-provenance.mjs finish "$PROVENANCE_DIR" "$APP"
  echo "==> Done:"
  du -sh "$APP" | sed 's/^/    /'
  echo "    $(cd "$OUT" && pwd)/$APP_NAME.app"
  exit 0
fi

echo "==> Staging DMG contents"
ln -s /Applications "$STAGING/Applications"
# Hidden window background; the layout itself is applied by Finder below.
mkdir "$STAGING/.background"
cp Resources/dmg/background.tiff "$STAGING/.background/background.tiff"

# Lay out the installer window (660×400 background from scripts/dmg-background.swift).
# Finder writes the result into the volume's .DS_Store, so the volume must be writable here.
layout_dmg() {
  local rw="$1" mount="/Volumes/$APP_NAME" attach_out device status=0
  attach_out="$(hdiutil attach -readwrite -noverify -noautoopen "$rw")" || return 1
  device="$(awk '/Apple_HFS/ {print $1}' <<<"$attach_out")"
  if [[ -z "$device" || ! -d "$mount/$APP_NAME.app" ]]; then
    echo "package: layout volume did not mount at $mount" >&2
    [[ -n "$device" ]] && hdiutil detach "$device" -quiet
    return 1
  fi
  perl -e 'alarm shift; exec @ARGV' 120 osascript - "$APP_NAME" <<'OSA' || status=1
on run argv
  set diskName to item 1 of argv
  with timeout of 90 seconds
    tell application "Finder"
      tell disk diskName
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set pathbar visible of container window to false
        set the bounds of container window to {200, 120, 860, 552}
        set opts to the icon view options of container window
        set arrangement of opts to not arranged
        set icon size of opts to 128
        set text size of opts to 13
        set background picture of opts to file ".background:background.tiff"
        set position of item (diskName & ".app") of container window to {170, 205}
        set position of item "Applications" of container window to {490, 205}
        close
        open
        update without registering applications
        delay 1
        close
      end tell
    end tell
  end timeout
end run
OSA
  if [[ "$status" == 0 ]]; then
    local waited=0
    while [[ ! -f "$mount/.DS_Store" && "$waited" -lt 10 ]]; do sleep 1; waited=$((waited + 1)); done
    [[ -f "$mount/.DS_Store" ]] || { echo "package: Finder did not write the window layout" >&2; status=1; }
  fi
  # hdiutil -srcfolder drops .VolumeIcon.icns, so add the volume icon on the mounted volume.
  if SETFILE="$(xcrun -f SetFile 2>/dev/null)"; then
    cp "Resources/$ICON_FILE" "$mount/.VolumeIcon.icns" && "$SETFILE" -a C "$mount" || true
  else
    echo "package: SetFile not found; DMG keeps the default volume icon" >&2
  fi
  rm -rf "$mount/.fseventsd"
  sync
  hdiutil detach "$device" -quiet || hdiutil detach "$device" -force -quiet || status=1
  return "$status"
}

echo "==> Creating DMG"
# Pin the distribution filesystem instead of inheriting the host's APFS default.
# The read-only installer volume holds the app, the Applications link and the hidden window styling.
if [[ -e "/Volumes/$APP_NAME" ]]; then
  echo "package: /Volumes/$APP_NAME is already mounted; eject it first so the window layout targets the new DMG" >&2
  exit 1
fi
RW_DMG="$OUT/layout-rw.dmg"
RW_MB=$(( $(du -sm "$STAGING" | cut -f1) + 20 ))
hdiutil create -volname "$APP_NAME" -fs HFS+ -srcfolder "$STAGING" -size "${RW_MB}m" -ov -format UDRW "$RW_DMG" >/dev/null
echo "==> Laying out installer window"
if ! layout_dmg "$RW_DMG"; then
  if [[ "$UNSIGNED" == 1 || -z "$SIGN_ID" ]]; then
    echo "package: warning: window layout failed; this unsigned DMG opens as a plain Finder window" >&2
  else
    rm -f "$RW_DMG"
    echo "package: window layout failed; refusing to ship a release DMG without it." >&2
    echo "    Allow your terminal to control Finder (System Settings → Privacy & Security → Automation) and retry." >&2
    exit 1
  fi
fi
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$OUT/$DMG_NAME" >/dev/null
rm -f "$RW_DMG"
echo "==> Verifying DMG integrity"
hdiutil verify "$OUT/$DMG_NAME"

if [[ "$UNSIGNED" == 1 || -z "$SIGN_ID" ]]; then
  node scripts/cross-platform/mac-provenance.mjs finish "$PROVENANCE_DIR" "$APP" "$OUT/$DMG_NAME"
  echo "==> Unsigned DMG (ad-hoc). Recipients must bypass Gatekeeper."
  echo "==> Done:"
  ls -lh "$OUT/$DMG_NAME"
  exit 0
fi

echo "==> Signing DMG"
codesign --force --timestamp --sign "$SIGN_ID" "$OUT/$DMG_NAME"
codesign --verify --strict --verbose=2 "$OUT/$DMG_NAME" 2>&1 | sed 's/^/    /'
echo "==> Notarizing with Apple (profile: $NOTARY_PROFILE)"
xcrun notarytool submit "$OUT/$DMG_NAME" --keychain-profile "$NOTARY_PROFILE" --wait
echo "==> Stapling notarization ticket"
xcrun stapler staple "$OUT/$DMG_NAME"
xcrun stapler validate "$OUT/$DMG_NAME" 2>&1 | sed 's/^/    /'

node scripts/cross-platform/mac-provenance.mjs finish "$PROVENANCE_DIR" "$APP" "$OUT/$DMG_NAME"
echo "==> Done:"
ls -lh "$OUT/$DMG_NAME"
