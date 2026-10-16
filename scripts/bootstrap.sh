#!/usr/bin/env bash
# Toolchain check, lockfile install, debug build, local smoke, and optional isolated launch.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

MODE="prepare"
case "${1:-}" in
  "") MODE="prepare" ;;
  --check) MODE="check" ;;
  --run) MODE="run" ;;
  -h|--help)
    echo "Usage: $0 [--check|--run]"
    echo "  (default)  check the toolchain, install locked dependencies, build, smoke, then exit"
    echo "  --check    toolchain and lock consistency only"
    echo "  --run      prepare, then launch the isolated mock client"
    exit 0
    ;;
  *)
    echo "bootstrap: unknown argument: $1" >&2
    echo "Usage: $0 [--check|--run]" >&2
    exit 2
    ;;
esac

fail() {
  echo "bootstrap: $*" >&2
  exit 1
}

need_cmd() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "missing \`$cmd\`. $hint"
  fi
}

version_ge() {
  local a="$1" b="$2"
  local IFS=.
  local -a pa=($a) pb=($b)
  local i n x y
  n=$(( ${#pa[@]} > ${#pb[@]} ? ${#pa[@]} : ${#pb[@]} ))
  for ((i = 0; i < n; i++)); do
    x="${pa[i]:-0}"
    y="${pb[i]:-0}"
    x="${x%%[!0-9]*}"
    y="${y%%[!0-9]*}"
    x="${x:-0}"
    y="${y:-0}"
    if ((10#$x > 10#$y)); then return 0; fi
    if ((10#$x < 10#$y)); then return 1; fi
  done
  return 0
}

port_busy() {
  local port="$1"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $port is already in use; the existing listener was left running"
  fi
}

if [[ "$MODE" != "check" ]]; then
  need_cmd node "Install Node.js from https://nodejs.org (the minimum is server/package.json engines.node). This script will not install it."
  echo "==> Repository health"
  node "$REPO_ROOT/scripts/repo-health.mjs"
  node --test "$REPO_ROOT"/scripts/test/*.test.mjs
fi

echo "==> Checking prerequisites"

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "macOS 14+ on Apple Silicon is required (found $(uname -s))"
fi

os_ver="$(sw_vers -productVersion 2>/dev/null || true)"
[[ -n "$os_ver" ]] || fail "could not read macOS version (sw_vers)"
if ! version_ge "$os_ver" "14.0"; then
  fail "macOS 14+ is required (found $os_ver)"
fi

arch="$(uname -m)"
if [[ "$arch" != "arm64" ]]; then
  fail "Apple Silicon (arm64) is required (found $arch)"
fi

if ! xcode-select -p >/dev/null 2>&1; then
  fail "Xcode Command Line Tools are missing. Install via Xcode, or run: xcode-select --install"
fi
need_cmd xcrun "Install Xcode Command Line Tools: xcode-select --install"
if ! xcrun --find swift >/dev/null 2>&1; then
  fail "Swift is not available through xcrun. Install Xcode Command Line Tools: xcode-select --install"
fi
need_cmd swift "Install Xcode Command Line Tools: xcode-select --install"
need_cmd git "Install Xcode Command Line Tools: xcode-select --install"
need_cmd curl "curl ships with macOS and is required for the local health check"
need_cmd lsof "lsof ships with macOS and is required to detect a busy port"
need_cmd ditto "ditto ships with macOS and is required to assemble the development app"
need_cmd codesign "codesign ships with macOS and is required for the ad-hoc development signature"

swift_ver="$(swift --version 2>/dev/null | awk 'NR==1 {
  for (i = 1; i <= NF; i++) if ($i == "version") { print $(i+1); exit }
}')"
[[ -n "$swift_ver" ]] || fail "could not parse \`swift --version\`"
if ! version_ge "$swift_ver" "5.9"; then
  fail "Swift 5.9+ is required (found $swift_ver)"
fi

need_cmd node "Install Node.js from https://nodejs.org (the minimum is server/package.json engines.node). This script will not install it."
need_cmd npm "Install npm (it ships with Node.js) from https://nodejs.org"

[[ -f "$REPO_ROOT/server/package.json" ]] || fail "server/package.json is missing"
[[ -f "$REPO_ROOT/scheduler/package.json" ]] || fail "scheduler/package.json is missing"
node_floor="$(node -e 'const pkg = require("./server/package.json"); const match = String(pkg.engines && pkg.engines.node || "").match(/^>=(\d+\.\d+\.\d+)$/); if (!match) process.exit(2); process.stdout.write(match[1]);')" \
  || fail "server/package.json engines.node must be an exact minimum such as >=22.18.0"
scheduler_floor="$(node -e 'const pkg = require("./scheduler/package.json"); process.stdout.write(String(pkg.engines && pkg.engines.node || ""));')"
if [[ "$scheduler_floor" != ">=$node_floor" ]]; then
  fail "scheduler/package.json engines.node must match server/package.json (>=$node_floor)"
fi

node_ver="$(node -v 2>/dev/null | sed 's/^v//')"
[[ -n "$node_ver" ]] || fail "could not parse \`node -v\`"
if ! version_ge "$node_ver" "$node_floor"; then
  fail "Node.js >= $node_floor is required (found v$node_ver). Install from https://nodejs.org"
fi

echo "    macOS $os_ver ($arch), Swift $swift_ver, Node v$node_ver (minimum $node_floor)"

[[ -f "$REPO_ROOT/Package.resolved" ]] || fail "Package.resolved is missing; Swift dependencies stay pinned to that file"

if [[ "$MODE" == "check" ]]; then
  echo "==> Checking locked dependencies"
  check_ok=0
  node "$REPO_ROOT/scripts/lib/lock-check.mjs" "$REPO_ROOT/server" || check_ok=1
  node "$REPO_ROOT/scripts/lib/lock-check.mjs" "$REPO_ROOT/scheduler" || check_ok=1
  [[ "$check_ok" -eq 0 ]] || fail "locked dependencies are not installed; run ./scripts/bootstrap.sh"
  echo "bootstrap: check passed"
  exit 0
fi

SMOKE_PORT=18787
RUN_PORT="${PORT:-8787}"
port_busy "$SMOKE_PORT"
if [[ "$MODE" == "run" ]]; then
  port_busy "$RUN_PORT"
fi

echo "==> Installing server dependencies (npm ci)"
( cd "$REPO_ROOT/server" && npm ci --include=optional )
echo "==> Installing scheduler dependencies (npm ci)"
( cd "$REPO_ROOT/scheduler" && npm ci --include=optional )
node "$REPO_ROOT/scripts/lib/lock-check.mjs" "$REPO_ROOT/server"
node "$REPO_ROOT/scripts/lib/lock-check.mjs" "$REPO_ROOT/scheduler"

echo "==> Building client (debug)"
swift build
bin_dir="$(swift build --show-bin-path)"
[[ -d "$bin_dir/SwiftMath_SwiftMath.bundle" ]] || fail "SwiftMath resources missing from $bin_dir"

echo "==> Isolated local-server smoke"
PORT="$SMOKE_PORT" "$REPO_ROOT/scripts/dev.sh" --smoke

if [[ "$MODE" != "run" ]]; then
  echo
  echo "bootstrap: ready"
  echo "Next: ./scripts/bootstrap.sh --run"
  exit 0
fi

echo "==> Launching isolated development app"
DEV_OUTPUT="$REPO_ROOT/output/dev"
DEV_APP="$DEV_OUTPUT/NotchSPI Dev.app"
DEV_LOG="$DEV_OUTPUT/server.log"
mkdir -p "$DEV_OUTPUT"
# shellcheck source=scripts/lib/qa-app.sh
source "$REPO_ROOT/scripts/lib/qa-app.sh"
assemble_qa_app "$DEV_APP" "com.rottesya.notchspi.dev" "NotchSPI Dev" "NotchSPI Dev" "$bin_dir" \
  "Capture a question while using the isolated development app."

SERVER_PID=""
cleanup() {
  local code=$?
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

PORT="$RUN_PORT" "$REPO_ROOT/scripts/dev.sh" --server-only >"$DEV_LOG" 2>&1 &
SERVER_PID=$!
ready=0
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "bootstrap: development server exited before becoming ready" >&2
    cat "$DEV_LOG" >&2
    exit 1
  fi
  if curl -sf "http://127.0.0.1:$RUN_PORT/healthz" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [[ "$ready" != 1 ]]; then
  echo "bootstrap: development server did not become ready on port $RUN_PORT" >&2
  cat "$DEV_LOG" >&2
  exit 1
fi

NSPI_QA_EPHEMERAL=1 "$DEV_APP/Contents/MacOS/NotchSPI" \
  -official.baseURL "http://127.0.0.1:$RUN_PORT" \
  -serviceMode official
