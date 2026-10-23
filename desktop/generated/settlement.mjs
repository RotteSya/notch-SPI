// Generated from shared/protocol/settlement.mjs.
// Shared account and terminal receipt validation. Network and cancellation remain platform adapters.
import { validFreeTrial } from "./free-trial.mjs";
const uint = (n) => Number.isSafeInteger(n) && n >= 0;
export function validSettlement(v, id) {
  if (
    !validAccount(v) ||
    v.capture_id !== id ||
    !uint(v.balance_questions) ||
    !uint(v.held_questions) ||
    typeof v.balance_version !== "string" ||
    !/^\d{1,40}$/.test(v.balance_version) ||
    typeof v.usable_result !== "boolean" ||
    typeof v.can_retry !== "boolean" ||
    typeof v.can_recover !== "boolean"
  )
    return false;
  if (v.settlement_status === "settled")
    return (
      v.questions_charged === 1 &&
      v.terminal_state === "usable" &&
      v.usable_result
    );
  if (v.settlement_status === "released")
    return (
      v.questions_charged === 0 &&
      !v.usable_result &&
      ["retake", "no_result", "failed", "canceled"].includes(v.terminal_state)
    );
  return (
    v.settlement_status === "not_required" &&
    v.questions_charged === 0 &&
    ["usable", "failed", "canceled"].includes(v.terminal_state) &&
    v.usable_result === (v.terminal_state === "usable")
  );
}
export function validAccount(v) {
  if (
    !v ||
    !uint(v.balance_questions) ||
    (v.balance_version !== undefined &&
      (typeof v.balance_version !== "string" || !/^\d{1,40}$/.test(v.balance_version)))
  )
    return false;
  for (const k of [
    "total_questions",
    "total_input_tokens",
    "total_output_tokens",
    "held_questions",
  ])
    if (v[k] !== undefined && !uint(v[k])) return false;
  if (
    v.account_totals != null &&
    (!v.balance_version ||
      !["questions", "input_tokens", "output_tokens"].every((k) =>
        uint(v.account_totals[k]),
      ))
  )
    return false;
  if (v.free_trial != null && !validFreeTrial(v.free_trial)) return false;
  return true;
}
