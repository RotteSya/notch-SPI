import { composeObjectiveResult } from "../generated/objective.mjs";
const markers = [
  "NSPI_RESULT_V1:",
  "NSPI_NO_RESULT_V1:",
  "NSPI_CONTEXT_V1:",
  "NSPI_ERROR_V1:",
];
export function visibleStream(raw) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  return lines
    .filter(
      (line, i) =>
        !markers.some(
          (m) =>
            line.includes(m) ||
            (i === lines.length - 1 &&
              line.trim() &&
              m.startsWith(line.trim())),
        ),
    )
    .join("\n");
}
export function parseAnswer(raw, streaming = false) {
  const text = visibleStream(raw);
  const regex =
    /^[ \t]{0,3}(?:#{1,6}[ \t]*)?(?:\*{1,2}|_{1,2})?[ \t]*FINAL[ \t]*[:：][ \t]*/gim;
  const matches = [...text.matchAll(regex)],
    last = matches.at(-1);
  if (!last) {
    const lines = text.split("\n"),
      core = lines
        .at(-1)
        .replace(/^[\s#*_]+/, "")
        .toUpperCase();
    if (
      streaming &&
      core &&
      ("FINAL:".startsWith(core) || "FINAL：".startsWith(core))
    )
      lines.pop();
    return { working: lines.join("\n").trimEnd(), final: null, overflow: "" };
  }
  const [first, ...rest] = text
    .slice(last.index + last[0].length)
    .trim()
    .split("\n");
  let final = first;
  for (const fence of ["**", "__"])
    if ((final.split(fence).length - 1) % 2) {
      if (final.startsWith(fence)) final = final.slice(2).trim();
      else if (final.endsWith(fence)) final = final.slice(0, -2).trim();
    }
  return {
    working: text.slice(0, last.index).replace(regex, "").trimEnd(),
    final,
    overflow: rest.join("\n").trim(),
  };
}
export function compose(raw, enabled = true) {
  if (raw.includes("NSPI_NO_RESULT_V1:")) {
    let reason = null;
    try {
      const json = raw.trim().slice("NSPI_NO_RESULT_V1:".length).trim();
      const v = JSON.parse(json);
      if (
        raw.trim().startsWith("NSPI_NO_RESULT_V1:") &&
        !/[\r\n]/.test(json) &&
        new TextEncoder().encode(json).length <= 4096 &&
        Object.keys(v).sort().join(",") === "reason,v" &&
        (json.match(/"([^"\\]*)"\s*:/g) ?? []).length === 2 &&
        v.v === 1 &&
        ["unsupported_scope", "multiple_targets"].includes(v.reason)
      )
        reason = v.reason;
    } catch {}
    return {
      finalAnswer: null,
      state: null,
      noResultReason: reason,
      visibleText: "",
      parserPath: "none",
    };
  }
  return composeObjectiveResult(raw, enabled);
}
export { composePersonality } from "../generated/personality.mjs";
import { composePersonality, isPersonalityTerminalError } from "../generated/personality.mjs";
export function personality(raw, streaming = false) {
  const result = composePersonality(raw, streaming);
  return {
    visible: result.visibleChoices,
    context: result.context,
    error: result.errorCode,
    usable: Boolean(result.visibleChoices) && !isPersonalityTerminalError(result.errorCode),
  };
}
