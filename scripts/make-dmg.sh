#!/usr/bin/env bash
set -euo pipefail

# Build a shareable NotchSPI.dmg: universal (arm64 + x86_64 when possible),
# wrapped in a .app bundle, ad-hoc code-signed. Not Apple-notarized.

cd "$(dirname "$0")/.."  # -> native/

APP_NAME="NotchSPI"
BUNDLE_ID="com.rottesya.notchspi"
VERSION="1.3"
ICON_FILE="NotchSPI.icns"
OUT="dist"
STAGING="$OUT/staging"

echo "==> Building release binary (trying universal)…"
if swift build -c release --arch arm64 --arch x86_64 >/dev/null 2>&1; then
  BINDIR="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)"
else
  echo "    universal build unavailable; building for the native arch only"
  swift build -c release >/dev/null
  BINDIR="$(swift build -c release --show-bin-path)"
fi
BIN="$BINDIR/$APP_NAME"
echo "    $(file "$BIN")"

echo "==> Assembling $APP_NAME.app…"
rm -rf "$OUT"
APP="$STAGING/$APP_NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$APP_NAME"
chmod +x "$APP/Contents/MacOS/$APP_NAME"
cp "Resources/$ICON_FILE" "$APP/Contents/Resources/$ICON_FILE"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIconFile</key><string>$ICON_FILE</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>4</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>NotchSPI</string>
</dict>
</plist>
PLIST

# A "Developer ID Application" cert enables real signing + notarization.
SIGN_ID="${SIGN_ID:-$(security find-identity -v -p codesigning | grep 'Developer ID Application' | head -1 | sed -E 's/.*"(.*)".*/\1/')}"
NOTARY_PROFILE="${NOTARY_PROFILE:-notchtutor}"

if [ -n "$SIGN_ID" ]; then
  echo "==> Code signing (Developer ID + hardened runtime): $SIGN_ID"
  codesign --force --deep --options runtime --timestamp --sign "$SIGN_ID" "$APP"
else
  echo "==> Ad-hoc code signing (no Developer ID cert found — NOT notarizable)"
  codesign --force --deep --sign - "$APP"
fi
codesign --verify --verbose "$APP" 2>&1 | sed 's/^/    /' || true

echo "==> Staging DMG contents…"
ln -s /Applications "$STAGING/Applications"

echo "==> Creating DMG…"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGING" -ov -format UDZO "$OUT/$APP_NAME.dmg" >/dev/null

if [ -n "$SIGN_ID" ]; then
  echo "==> Signing DMG…"
  codesign --force --timestamp --sign "$SIGN_ID" "$OUT/$APP_NAME.dmg"
  echo "==> Notarizing with Apple (profile: $NOTARY_PROFILE — can take a few minutes)…"
  xcrun notarytool submit "$OUT/$APP_NAME.dmg" --keychain-profile "$NOTARY_PROFILE" --wait
  echo "==> Stapling notarization ticket…"
  xcrun stapler staple "$OUT/$APP_NAME.dmg"
  xcrun stapler validate "$OUT/$APP_NAME.dmg" 2>&1 | sed 's/^/    /' || true
else
  echo "==> (Ad-hoc DMG — recipients must bypass Gatekeeper manually.)"
fi

echo "==> Done:"
ls -lh "$OUT/$APP_NAME.dmg"
