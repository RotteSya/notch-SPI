#!/usr/bin/env bash
set -euo pipefail

# Publish the freshly built NotchSPI DMG to Quark cloud drive (夸克网盘),
# into the dedicated "NotchSPI Releases" folder, named by version.
#
# Called automatically at the end of make-dmg.sh for real (notarized) releases,
# and also runnable standalone to re-upload without rebuilding:
#     scripts/publish-quark.sh
#
# Requires the hardened quarkclouddrive skill to be installed and authorized
# (bash ~/.claude/skills/quarkclouddrive/bin/qk login). No global command,
# no install — this just invokes that launcher.

cd "$(dirname "$0")/.."  # -> native/

APP_NAME="NotchSPI"
DMG="dist/$APP_NAME.dmg"
# Fixed FID of 夸克网盘/NotchSPI Releases (created once, create-folder is idempotent).
QUARK_FID="eafd08b6a2de42089c7f0086625614dd"
QK="$HOME/.claude/skills/quarkclouddrive/bin/qk"

# Version is single-sourced from make-dmg.sh; allow env override.
VERSION="${VERSION:-$(grep -E '^VERSION=' scripts/make-dmg.sh | sed -E 's/VERSION="?([^"]*)"?/\1/')}"

if [ ! -x "$QK" ]; then
  echo "==> [quark] 跳过：未找到网盘工具 $QK（未安装 quarkclouddrive skill）" >&2
  exit 1
fi
if [ ! -f "$DMG" ]; then
  echo "==> [quark] 失败：找不到 $DMG，请先运行 make-dmg.sh" >&2
  exit 1
fi

VERSIONED="dist/$APP_NAME-$VERSION.dmg"
NAME="$APP_NAME-$VERSION.dmg"
cp -f "$DMG" "$VERSIONED"

# Best-effort idempotency: Quark doesn't overwrite same-name files (it makes
# "NotchSPI-2.1(1).dmg") and the CLI has no delete. So if this exact version was
# already uploaded, skip re-uploading. Non-fatal if the check itself fails.
already_uploaded() {
  local out art
  out="$(bash "$QK" search --keyword "$NAME" 2>/dev/null | grep -v 'cpufamily' || true)"
  art="$(printf '%s' "$out" | grep '"type":"artifact"' | sed -E 's/.*"file_path":"([^"]+)".*/\1/' | head -1)"
  [ -n "$art" ] && [ -f "$art" ] && grep -qF "\"filename\":\"$NAME\"" "$art"
}
if already_uploaded; then
  echo "==> [quark] ⏭  夸克网盘已有 $NAME，跳过上传（如需替换：先在夸克 App 删除旧文件再重跑）"
  exit 0
fi

echo "==> [quark] 上传 $VERSIONED → 夸克网盘/NotchSPI Releases …"
out="$(bash "$QK" upload "$VERSIONED" --parent-fid "$QUARK_FID" 2>&1 | grep -v 'cpufamily' || true)"

# The final NDJSON result line reports code:0 on full success.
result_line="$(printf '%s\n' "$out" | grep '"type":"result"' | tail -1 || true)"
if printf '%s' "$result_line" | grep -q '"code":0'; then
  echo "==> [quark] ✅ 已上传 $APP_NAME-$VERSION.dmg 到 夸克网盘/NotchSPI Releases"
else
  echo "==> [quark] ❌ 上传失败。CLI 返回：" >&2
  printf '%s\n' "${result_line:-$out}" >&2
  echo "    （若提示未授权：bash $QK login；修好后重跑：scripts/publish-quark.sh）" >&2
  exit 1
fi
