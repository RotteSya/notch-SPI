#!/usr/bin/env bash
set -euo pipefail

# Build a shareable NotchSPI.dmg: universal (arm64 + x86_64 when possible),
# wrapped in a .app bundle, ad-hoc code-signed. Not Apple-notarized.

cd "$(dirname "$0")/.."  # -> native/

APP_NAME="NotchSPI"
BUNDLE_ID="com.rottesya.notchspi"
VERSION="1.2"
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
  <key>CFBundleVersion</key><string>3</string>
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
# README wording must match how this build is signed (see SIGN_ID above).
if [ -n "$SIGN_ID" ]; then
  OPEN_NOTE='2. 首次打开：双击打开即可；系统若弹出确认对话框，点「打开」。'
  NOTARY_NOTE='- 本 App 已使用 Developer ID 签名并经 Apple 公证，可放心分享安装。'
else
  OPEN_NOTE='2. 首次打开：在「应用程序」里右键点 NotchSPI → 打开 →「打开」。
   若提示“已损坏/无法打开”，打开「终端」执行下面这行后再打开：
       xattr -dr com.apple.quarantine /Applications/NotchSPI.app'
  NOTARY_NOTE='- 本 App 未经 Apple 公证，仅适合自己/朋友之间分享使用。'
fi
cat > "$STAGING/使用说明.txt" <<README
NotchSPI — 刘海 AI 学习辅导

【安装】
1. 把 NotchSPI.app 拖到左边的「应用程序 / Applications」。
$OPEN_NOTE
3. 第一次按快捷键截屏时，系统会要求「屏幕录制」权限：
   到「系统设置 → 隐私与安全性 → 屏幕录制」勾选 NotchSPI，然后重新打开 App。

【使用】
- 屏幕上放一道题，按 ⌘⇧1 → 刘海下方展开并开始讲解。
- ⌘⇧Space 显示 / 隐藏。
- 鼠标悬停刘海可展开；点 ⚙ 可切换后端(Codex/Claude)、讲解深度、修改快捷键、退出。

【前提 · 重要】
- 需要本机已安装并登录 Codex 或 Claude Code 命令行工具，App 才能工作；
  没有的话，刘海里会提示“未找到 CLI”。
$NOTARY_NOTE
- App 不做任何屏幕共享隐身 / 反监考——它对录屏完全可见，请用于自己的练习题。
README

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
