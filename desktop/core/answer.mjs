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
const pairs = ["**", "__", "~~", "`", "*", "_"];
const bytes = (text) => new TextEncoder().encode(text).length;
function stripPaired(source) {
  let text = source.trim(),
    changed = true;
  while (changed) {
    changed = false;
    for (const pair of pairs)
      if (
        text.startsWith(pair) &&
        text.endsWith(pair) &&
        text.length >= 2 * pair.length
      ) {
        text = text.slice(pair.length, -pair.length).trim();
        changed = true;
        break;
      }
  }
  return text;
}
function decorations(source) {
  let text = stripPaired(source),
    changed = true;
  while (changed) {
    changed = false;
    for (const prefix of [...pairs, "> ", "# ", "- ", "+ "])
      if (text.startsWith(prefix)) {
        text = text.slice(prefix.length).trim();
        changed = true;
        break;
      }
  }
  return stripPaired(text);
}
const ordinal = (source) => {
  if (typeof source !== "string") return null;
  const n = source
    .normalize("NFKC")
    .trim()
    .replaceAll(" ", "")
    .replace(/^[Qq]/, "")
    .replace(/^\((.*)\)$/, "$1")
    .replace(/[.、):：]+$/, "");
  return /^\d+$/.test(n) ? n.replace(/^0+(?=\d)/, "") : null;
};
const choiceText = (source) => stripPaired(source).replace(/\s+/g, " ");
export function personality(raw, streaming = false) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n"),
    choices = [],
    visible = [],
    contexts = [],
    errors = [];
  for (const [i, source] of lines.entries()) {
    const line = decorations(source),
      open = streaming && i === lines.length - 1 && !raw.endsWith("\n");
    const machine = line.match(
      /^(NSPI_CONTEXT_V1|NSPI_ERROR_V1)\s*[:：]\s*(.*)$/i,
    );
    if (machine) {
      (machine[1].toUpperCase() === "NSPI_CONTEXT_V1" ? contexts : errors).push(
        machine[2],
      );
      continue;
    }
    if (
      open &&
      ["NSPI_CONTEXT_V1:", "NSPI_ERROR_V1:"].some((m) =>
        m.startsWith(line.toUpperCase().replace("：", ":")),
      )
    )
      continue;
    const match = line.match(
      /^([Qq]\s*[0-9０-９]+|[（(]\s*[0-9０-９]+\s*[）)]|[0-9０-９]+\s*[.．、)）:：])\s*(.+?)\s*$/,
    );
    if (match) {
      const item = { ordinal: ordinal(match[1]), choice: choiceText(match[2]) };
      if (item.ordinal && item.choice) {
        visible.push(line);
        if (!open) choices.push(item);
      }
    }
  }
  let context = null,
    error = null;
  const validItem = (x) =>
    x &&
    Object.keys(x).sort().join(",") === "choice,ordinal,summary" &&
    typeof x.ordinal === "string" &&
    x.ordinal.length <= 24 &&
    typeof x.summary === "string" &&
    x.summary.trim() &&
    [...x.summary].length <= 240 &&
    typeof x.choice === "string" &&
    [...x.choice].length <= 80 &&
    choices.some(
      (c) =>
        c.ordinal === ordinal(x.ordinal) && c.choice === choiceText(x.choice),
    );
  for (const json of contexts)
    try {
      const x = JSON.parse(json);
      if (
        bytes(json) <= 4096 &&
        Object.keys(x).sort().join(",") === "last,referenceable" &&
        validItem(x.last) &&
        Array.isArray(x.referenceable) &&
        x.referenceable.length <= 8 &&
        x.referenceable.every(validItem)
      )
        context = x;
    } catch {}
  for (const json of errors)
    try {
      const x = JSON.parse(json);
      if (
        bytes(json) <= 4096 &&
        Object.keys(x).every((k) => ["code", "ordinals"].includes(k)) &&
        [
          "unreadable",
          "depends_on_missing_previous",
          "partial_unreadable",
          "partial_missing_previous",
        ].includes(x.code) &&
        (x.ordinals === undefined ||
          (Array.isArray(x.ordinals) &&
            x.ordinals.length <= 8 &&
            x.ordinals.every(
              (o) => typeof o === "string" && o.length <= 24 && ordinal(o),
            )))
      )
        error = x.code;
    } catch {}
  return {
    visible: visible.join("\n"),
    context,
    error,
    usable:
      Boolean(visible.length) &&
      !["unreadable", "depends_on_missing_previous"].includes(error),
  };
}
