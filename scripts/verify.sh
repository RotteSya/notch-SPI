#!/usr/bin/env bash
# Local verification. A required failure stays visible, and independent checks still run.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

QUICK=0
case "${1:-}" in
  "") QUICK=0 ;;
  --quick) QUICK=1 ;;
  -h|--help)
    echo "Usage: $0 [--quick]"
    exit 0
    ;;
  *)
    echo "verify: unknown argument: $1" >&2
    exit 2
    ;;
esac

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
OUT="$REPO_ROOT/output/verification/$RUN_ID"
mkdir -p "$OUT"
fail_required=0

env_base() {
  ENV_ARGS=()
  local key
  for key in PATH HOME USER LOGNAME TMPDIR LANG LC_ALL LC_CTYPE SHELL TERM DEVELOPER_DIR SDKROOT; do
    if [[ -n "${!key:-}" ]]; then
      ENV_ARGS+=("$key=${!key}")
    fi
  done
}

write_result() {
  local name="$1" status="$2" dur="$3" code="$4" count="$5" reason="$6" log="$7"
  local rel="${log#$REPO_ROOT/}"
  {
    echo "name: $name"
    echo "status: $status"
    echo "duration_ms: $dur"
    echo "exit_code: $code"
    echo "test_count: $count"
    echo "skip_reason: $reason"
    echo "log_path: $rel"
  } | tee "$OUT/$name.result"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$status" "$dur" "$code" "$count" "$reason" "$rel" >> "$OUT/summary.tsv"
  echo
  if [[ "$status" == "failed" ]]; then
    fail_required=1
  fi
}

run_step() {
  local name="$1"
  shift
  local -a extra=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do
    extra+=("$1")
    shift
  done
  if [[ "${1:-}" == "--" ]]; then
    shift
  fi
  local log="$OUT/$name.log"
  local start end dur code count="" status
  start="$(node -e 'process.stdout.write(String(Date.now()))')"
  env_base
  set +e
  # Bash 3.2 treats an empty "${array[@]}" as unbound when set -u is on.
  if [[ ${#extra[@]} -gt 0 ]]; then
    env -i "${ENV_ARGS[@]}" "${extra[@]}" "$@" >"$log" 2>&1
  else
    env -i "${ENV_ARGS[@]}" "$@" >"$log" 2>&1
  fi
  code=$?
  set +e
  end="$(node -e 'process.stdout.write(String(Date.now()))')"
  dur="$((end - start))"
  count="$(grep -E 'ℹ tests |# tests |Executed [0-9]+ tests' "$log" | tail -1 | grep -Eo '[0-9]+' | head -1 || true)"
  if [[ "$code" -eq 0 ]]; then
    status="passed"
  else
    status="failed"
  fi
  write_result "$name" "$status" "$dur" "$code" "$count" "" "$log"
}

note_step() {
  local name="$1" status="$2" reason="$3"
  local log="$OUT/$name.log"
  printf '%s\n' "$reason" > "$log"
  write_result "$name" "$status" "0" "" "" "$reason" "$log"
}

echo "==> verify $RUN_ID"
run_step repo-health -- node "$REPO_ROOT/scripts/repo-health.mjs"
run_step repo-health-tests -- node --test "$REPO_ROOT"/scripts/test/*.test.mjs
run_step shared-generated -- node "$REPO_ROOT/scripts/cross-platform/generate.mjs" --check
run_step server-typecheck -- npm --prefix "$REPO_ROOT/server" run typecheck
run_step scheduler-typecheck WRANGLER_SEND_METRICS=false -- npm --prefix "$REPO_ROOT/scheduler" run typecheck
run_step isolated-smoke \
  HOST=0.0.0.0 \
  OFFICIAL_PROVIDER=anthropic \
  ANTHROPIC_API_KEY=poison-model-key \
  POSTGRES_URL=postgres://poison:poison@127.0.0.1:1/production \
  PAYMENT_PROVIDER=stripe \
  STRIPE_SECRET_KEY=poison-stripe-key \
  STRIPE_WEBHOOK_SECRET=poison-webhook-key \
  VERCEL=1 \
  NSPI_QA_EPHEMERAL=0 \
  PORT=18787 \
  -- "$REPO_ROOT/scripts/dev.sh" --smoke

if [[ "$QUICK" -eq 0 ]]; then
  run_step dependency-lock -- bash -c 'for project in server scheduler desktop; do node scripts/lib/lock-check.mjs "$project" || exit 1; done'
  run_step desktop-check -- npm --prefix "$REPO_ROOT/desktop" run check
  run_step server-tests -- npm --prefix "$REPO_ROOT/server" test
  run_step scheduler-tests -- npm --prefix "$REPO_ROOT/scheduler" test
  run_step scheduler-build WRANGLER_SEND_METRICS=false -- npm --prefix "$REPO_ROOT/scheduler" run build
  run_step swift-checkouts -- node "$REPO_ROOT/scripts/lib/swift-check.mjs" "$REPO_ROOT"
  if grep -q 'status: passed' "$OUT/swift-checkouts.result"; then
    run_step swift-tests NSPI_QA_EPHEMERAL=1 -- swift test --disable-automatic-resolution --skip-update -Xswiftc -warnings-as-errors
    run_step release-arm64 -- swift build --disable-automatic-resolution --skip-update -c release --arch arm64
  else
    note_step swift-tests blocked "Existing pinned Swift checkouts are required; no dependencies were downloaded"
    note_step release-arm64 blocked "Existing pinned Swift checkouts are required; no dependencies were downloaded"
  fi
  if [[ -f "$OUT/release-arm64.result" ]] && grep -q 'status: passed' "$OUT/release-arm64.result"; then
    run_step client-resources -- bash -c 'bin="$(swift build -c release --arch arm64 --show-bin-path)" && test -d "$bin/SwiftMath_SwiftMath.bundle" && test -d Resources/ThirdParty'
  else
    note_step client-resources blocked "arm64 Release build did not pass"
  fi
  run_step immutable-evidence -- node "$REPO_ROOT/scripts/lib/immutable-evidence.mjs" "$REPO_ROOT"
  run_step route-inventory -- node --test "$REPO_ROOT/server/test/route-inventory.test.ts"
  run_step whitespace -- git diff HEAD --check

  pg_url="${TEST_POSTGRES_URL:-}"
  if [[ -z "$pg_url" ]]; then
    note_step postgres skipped "TEST_POSTGRES_URL is unset; Postgres 16/17 run in CI"
  elif node -e 'const u = new URL(process.argv[1]); if (!/test/i.test(u.pathname)) process.exit(1);' "$pg_url" 2>/dev/null; then
    run_step postgres TEST_POSTGRES_URL="$pg_url" -- npm --prefix "$REPO_ROOT/server" test
  else
    note_step postgres blocked "TEST_POSTGRES_URL must name a database containing test"
  fi
  note_step hardware blocked "Physical hotkey, screen recording permission, notch hardware, and hover are outside this command"
  note_step signing skipped "This command builds the arm64 Release binary and does not sign or notarize"
fi

echo "verify: results in output/verification/$RUN_ID"
if [[ "$fail_required" -ne 0 ]]; then
  echo "verify: failed"
  exit 1
fi
echo "verify: passed"
