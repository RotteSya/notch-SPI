# Personality mode stability verification

Date: 2026-07-20  
Fixture set: `1.0.0`  
Evaluated tree: `2670332-dirty`  
App version: `2.5`

## Release status

COMPLETE. The deterministic client work, UI interaction check, official behavior gates, and second-person release review all pass.

- Directionality reviewer: `SHE LINGZHAO`
- Directionality decision: approved
- Manual menu check: approved
- Signed-record revalidation: passed with 55/55 rows, complete manifest coverage, zero transport failures, and all five official thresholds passing

## A. Deterministic client acceptance

| ID | Status | Evidence |
|---|---|---|
| A1 | PASS | Personality prompt identifies practice/self-assessment use and JSON-encodes persona/session blocks as untrusted data. Injection and contract tests pass. |
| A2 | PASS | Strict V1 schema, byte/field/reference limits, canonical ordinals, and exact normalized choice matching are implemented and tested. |
| A3 | PASS | Session records separate `immediate_previous` from older references; an unavailable barrier cannot fall back to an older scene. |
| A4 | PASS | Every character split of both machine markers is withheld; provisional numbered choices remain streamable. |
| A5 | PASS | Personality rendering and height measurement consume the same sanitized composition; prose, errors, JSON, and protocol markers are hidden. |
| A6 | PASS | Official, custom-key, and CLI request builders consume the same mandatory frozen `CapturePrompt`; the second-capture coordinator test contains the first payload. |
| A7 | PASS | Persona identity/name/text, capture target, channel, TTL, tutor transition, and manual reset all start a new generation or scope. |
| A8 | PASS | Generation, scope, and active sequence are revalidated before recording; in-flight persona/channel/target changes discard old results. |
| A9 | PASS | Session state is in-memory only, context is bounded to 8 KiB, raw evaluation output is Git-ignored, and stored JSONL has no prompt/completion text. |
| A10 | PASS | Full `swift test`: 129 tests, 2 explicitly gated evaluation tests skipped, 0 failures. `swift build -c release` succeeds. Tutor prompt goldens cover 3 languages × 4 depths. |

Additional checks:

- `git diff --check`: clean.
- The existing DEBUG visual-QA framework now includes repeatable `personality` and `personality-menu` states; Release builds keep the screen-sharing guard unconditionally enabled.
- The custom persona capsule and gear controls explicitly expose accessibility button roles, labels, and Press actions.
- `.eval-results/personality/sample.jsonl` is ignored by `/.eval-results/`.
- Synthetic set: 35 fixtures and 45 JPEGs; aggregate deterministic image hash `93c7c41e7328a2c8a58be1bf5cd85eaff85354fa4ba0b53326cece30fa59e0e9`.

## B. Model behavior acceptance

### Official release model

See `2026-07-20-2670332-dirty.md`.

| Metric | Result | Gate | Status |
|---|---:|---:|---|
| Legal choice output | 100.0% | >= 95.0% | PASS |
| Valid `NSPI_CONTEXT_V1` | 98.1% | >= 95.0% | PASS |
| Refusal / lecture | 0 | <= 0 | PASS |
| Immediate-previous continuity | 100.0% | >= 90.0% | PASS |
| Opposite-persona direction | 90.0% | >= 85.0% | PASS |

There were 55/55 result rows and no transport failures. The only non-terminal invalid context and expected-protocol mismatch was `edge-numbering-multi`; terminal `unreadable` and `depends_on_missing_previous` fixtures behaved as designed. Expected error/protocol behavior was 98.2% (informational, not a release gate).

### Available non-blocking channels

- Claude CLI full baseline: 55/55 rows, no transport failures; 99.3% legal choices, 98.1% valid context, 0 refusals, 100% continuity, and 90.0% directionality. See `2026-07-20-2670332-dirty-cli-claude.md`.
- CLI two-capture compatibility check passed before the full baseline.
- Custom-key request shape and frozen-prompt compatibility are covered by automated tests. No custom-key account is configured on this machine, so a live custom-key baseline is not available and does not block the release gate under the plan.

## Human review gate — PASS

`SHE LINGZHAO` reviewed the official directionality results against the synthetic fixtures and approved them. The cautious variants of `direction-07`, `direction-08`, and `direction-09` were the lowest per-variant scores at 50%; the reviewed aggregate remains 90.0%, above the 85% release gate.

`PersonalityEvaluationTests.testExistingOfficialRecordWhenExplicitlyReviewed` then signed all 55 JSONL rows and passed. The generated safe summary records the reviewer identity without adding raw completions, persona text, or question text.

## Protected-UI interaction check — PASS

The check used an isolated app bundle and the existing DEBUG-only `NSPI_VISUAL_QA=1` escape hatch. That flag changes only `NSWindow.sharingType`; the menu builder, action dispatch, session reset, presentation, and settings navigation are the production paths. Release builds ignore the flag and remain excluded from software capture.

Observed through real accessibility and mouse actions:

1. The Personality gear menu contained **开始新问卷 / 清空连续题上下文** with action `startNewQuestionnaire`.
2. Activating it changed the visible status to **连续题上下文已清空**.
3. Both previously displayed numbered choices remained visible after reset.
4. Activating the **QA Persona** capsule opened the **人物像** settings page with that persona selected.

The session/coordinator tests prove the remaining nonvisual part: the next `begin` after reset has no prior context, stale tokens cannot record, and the currently displayed raw answer is independent of session storage.

The reviewer also confirmed the same menu flow manually on the application UI.
