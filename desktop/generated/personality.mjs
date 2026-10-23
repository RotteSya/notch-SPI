// Generated from shared/protocol/personality.mjs.
// Pure personality V1 parsing. Platform adapters only decode this result or select UI fields.
const personalityPairs = ["**", "__", "~~", "`", "*", "_"];
const personalityTerminalErrors = ["unreadable", "depends_on_missing_previous"];
const personalityPartialErrors = ["partial_unreadable", "partial_missing_previous"];
const personalitySegments = new Intl.Segmenter("en", { granularity: "grapheme" });
const personalityLength = (s) => [...personalitySegments.segment(s)].length;
const personalityBytes = (s) => unescape(encodeURIComponent(s)).length;
const personalityKeys = (x, keys) => x && typeof x === "object" && !Array.isArray(x) &&
  Object.keys(x).sort().join(",") === [...keys].sort().join(",");
function personalityPaired(source) {
  let text = source.trim(), changed = true;
  while (changed) {
    changed = false;
    for (const pair of personalityPairs) {
      if (text.startsWith(pair) && text.endsWith(pair) && text.length >= 2 * pair.length) {
        text = text.slice(pair.length, -pair.length).trim(); changed = true; break;
      }
    }
  }
  return text;
}
function personalityLeading(source) {
  let text = source.trim(), changed = true;
  while (changed) {
    changed = false;
    for (const prefix of [...personalityPairs, "> ", "# ", "- ", "+ "]) {
      if (text.startsWith(prefix)) { text = text.slice(prefix.length).trim(); changed = true; break; }
    }
  }
  return text;
}
const personalityDecorations = (s) => personalityPaired(personalityLeading(personalityPaired(s)));
export function normalizePersonalityOrdinal(source) {
  if (typeof source !== "string") return null;
  const n = source.normalize("NFKC").trim().replaceAll(" ", "")
    .replace(/^[Qq]/, "").replace(/^\((.*)\)$/, "$1").replace(/[.、):：]+$/, "");
  return /^[0-9]+$/.test(n) ? n.replace(/^0+(?=\d)/, "") : null;
}
export function normalizePersonalityChoice(source) { return personalityPaired(source).replace(/\s+/g, " "); }
export function isPersonalityTerminalError(code) { return personalityTerminalErrors.includes(code); }
export function composePersonality(raw, streaming = false) {
  const normalized = raw.replace(/\r\n?/g, "\n"), lines = normalized.split("\n");
  const finalizedChoices = [], contexts = [], errors = [], violations = [];
  let provisionalChoice = null;
  for (const [index, source] of lines.entries()) {
    const line = personalityDecorations(source);
    const open = streaming && index === lines.length - 1 && !normalized.endsWith("\n");
    const machine = line.match(/^(NSPI_CONTEXT_V1|NSPI_ERROR_V1)\s*[:：]\s*(.*)$/i);
    if (machine) {
      (machine[1].toUpperCase() === "NSPI_CONTEXT_V1" ? contexts : errors).push(machine[2]); continue;
    }
    const candidate = personalityLeading(source).replaceAll("：", ":").toUpperCase();
    if (open && candidate && ["NSPI_CONTEXT_V1:", "NSPI_ERROR_V1:"].some((m) => m.startsWith(candidate))) continue;
    const match = line.match(/^([Qq]\s*[0-9０-９]+|[（(]\s*[0-9０-９]+\s*[）)]|[0-9０-９]+\s*[.．、)）:：])\s*(.+?)\s*$/);
    if (match) {
      const ordinal = normalizePersonalityOrdinal(match[1]), choice = normalizePersonalityChoice(match[2]);
      if (ordinal && choice) {
        const item = { ordinal, choice, visibleText: line };
        if (open) provisionalChoice = item; else finalizedChoices.push(item);
        continue;
      }
    }
    if (line && !(open && /^(?:[Qq]?\d{0,24}|[（(]\d{0,24}[）)]?)\s*[.、)）:]?$/.test(line.normalize("NFKC")))) violations.push("prose");
  }
  if (contexts.length > 1) violations.push("duplicateContextMarker");
  if (errors.length > 1) violations.push("duplicateErrorMarker");
  let context = null, errorCode = null, errorOrdinals = [];
  const validItem = (x) => personalityKeys(x, ["ordinal", "summary", "choice"]) &&
    ["ordinal", "summary", "choice"].every((k) => typeof x[k] === "string" && x[k].trim()) &&
    personalityLength(x.ordinal) <= 24 && personalityLength(x.summary) <= 240 && personalityLength(x.choice) <= 80 &&
    normalizePersonalityOrdinal(x.ordinal) !== null && finalizedChoices.some((c) =>
      c.ordinal === normalizePersonalityOrdinal(x.ordinal) && c.choice === normalizePersonalityChoice(x.choice));
  for (const json of contexts) {
    try {
      const x = JSON.parse(json);
      if (personalityBytes(json) > 4096 || !personalityKeys(x, ["last", "referenceable"]) ||
          !validItem(x.last) || !Array.isArray(x.referenceable) || x.referenceable.length > 8 || !x.referenceable.every(validItem)) throw new Error();
      context = x;
    } catch { violations.push("invalidContext"); }
  }
  for (const json of errors) {
    try {
      const x = JSON.parse(json);
      if (personalityBytes(json) > 4096 || !x || typeof x !== "object" || Array.isArray(x) ||
          !Object.keys(x).every((k) => ["code", "ordinals"].includes(k)) ||
          ![...personalityTerminalErrors, ...personalityPartialErrors].includes(x.code) ||
          (x.ordinals !== undefined && (!Array.isArray(x.ordinals) || x.ordinals.length > 8 ||
            !x.ordinals.every((o) => typeof o === "string" && personalityLength(o) <= 24 && normalizePersonalityOrdinal(o) !== null)))) throw new Error();
      errorCode = x.code; errorOrdinals = (x.ordinals ?? []).map(normalizePersonalityOrdinal);
    } catch { violations.push("invalidError"); }
  }
  if (!streaming && finalizedChoices.length && !contexts.length) violations.push("missingContext");
  if (!streaming && !finalizedChoices.length && errorCode === null) violations.push("noValidChoices");
  if ((isPersonalityTerminalError(errorCode) && finalizedChoices.length) ||
      (personalityPartialErrors.includes(errorCode) && !finalizedChoices.length)) violations.push("invalidErrorCombination");
  return {
    visibleChoices: [...finalizedChoices, ...(provisionalChoice ? [provisionalChoice] : [])].map((x) => x.visibleText).join("\n"),
    finalizedChoices, provisionalChoice, context, errorCode, errorOrdinals, violations,
  };
}

export function validPersonalitySessionPayload(payload) {
  if (!personalityKeys(payload, ["last", "referenceable"]) || !Array.isArray(payload.referenceable) || payload.referenceable.length > 8) return false;
  const valid = (item) => personalityKeys(item, ["ordinal", "summary", "choice"]) &&
    ["ordinal", "summary", "choice"].every((key) => typeof item[key] === "string" && item[key].trim()) &&
    personalityLength(item.ordinal) <= 24 && personalityLength(item.summary) <= 240 && personalityLength(item.choice) <= 80 &&
    normalizePersonalityOrdinal(item.ordinal) !== null;
  return [payload.last, ...payload.referenceable].every(valid) && personalityBytes(JSON.stringify(payload)) <= 4096;
}
