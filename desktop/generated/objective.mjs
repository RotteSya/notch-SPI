// Generated from server/src/objective-result.ts.
export const OBJECTIVE_RESULT_MARKER = 'NSPI_RESULT_V1:';





























const KINDS = new Set                       ([
  'single_choice', 'multiple_choice', 'ordering', 'short_fill', 'other',
]);
const STATES = new Set                      (['ready', 'review', 'retake']);
const REASONS = new Set                       ([
  'none', 'ambiguous_question', 'ambiguous_options', 'cropped', 'unreadable',
  'missing_context', 'unsupported',
]);
const KEYS = ['answer', 'kind', 'reason', 'state', 'v'];
const OBJECTIVE_KINDS = new Set                       ([
  'single_choice', 'multiple_choice', 'ordering', 'short_fill',
]);

function pushUnique(out                              , value                            )       {
  if (!out.includes(value)) out.push(value);
}

function markerIsInsideMarkdownFence(lines          , markerIndex        )          {
  let fence                       = null;
  for (const line of lines.slice(0, markerIndex)) {
    const match = /^\s*(```|~~~)/u.exec(line);
    if (!match) continue;
    const token = match[1]                 ;
    if (fence === null) fence = token;
    else if (fence === token) fence = null;
  }
  return fence !== null;
}

/** Shared FINAL/answer canonicalization. JS normalize('NFKC') is Unicode NFKC. */
export function normalizeObjectiveAnswer(value        )         {
  let out = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  let changed = true;
  while (changed) {
    changed = false;
    for (const pair of [['**', '**'], ['__', '__'], ['`', '`']]         ) {
      if (out.startsWith(pair[0]) && out.endsWith(pair[1]) && out.length > pair[0].length + pair[1].length) {
        out = out.slice(pair[0].length, -pair[1].length).trim();
        changed = true;
      }
    }
  }
  return /^[a-z]$/i.test(out) ? out.toUpperCase() : out;
}

export function extractFinalAnswer(text        )                {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ;
    const match = /^[ \t]{0,3}(?:#{1,6}[ \t]*)?(?:\*{1,2}|_{1,2})?[ \t]*FINAL[ \t]*[:：][ \t]*(.+)$/iu.exec(line);
    if (!match) continue;
    let answer = match[1] .trim();
    for (const fence of ['**', '__']) {
      const count = answer.split(fence).length - 1;
      if (count % 2 === 1) {
        if (answer.startsWith(fence)) answer = answer.slice(fence.length).trim();
        else if (answer.endsWith(fence)) answer = answer.slice(0, -fence.length).trim();
      }
    }
    return answer.length > 0 && [...answer].length <= 512 ? answer : null;
  }
  return null;
}

function validateObject(raw         , violations                              )                           {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    pushUnique(violations, 'invalidJSON');
    return null;
  }
  const obj = raw                           ;
  const keys = Object.keys(obj).sort();
  if (keys.length !== KEYS.length || keys.some((key, i) => key !== KEYS[i])) {
    pushUnique(violations, 'unknownField');
    return null;
  }
  if (obj.v !== 1 || typeof obj.kind !== 'string' || !KINDS.has(obj.kind                         )
      || typeof obj.state !== 'string' || !STATES.has(obj.state                        )
      || typeof obj.reason !== 'string' || !REASONS.has(obj.reason                         )) {
    pushUnique(violations, 'invalidEnum');
    return null;
  }
  const result = obj                                ;
  const answerLength = typeof result.answer === 'string' ? [...result.answer].length : 0;
  let valid = true;
  if (result.state === 'ready') {
    valid = typeof result.answer === 'string' && answerLength >= 1 && answerLength <= 512
      && result.reason === 'none' && OBJECTIVE_KINDS.has(result.kind);
  } else if (result.state === 'review') {
    valid = typeof result.answer === 'string' && answerLength >= 1 && answerLength <= 512
      && ['ambiguous_question', 'ambiguous_options', 'missing_context', 'unsupported'].includes(result.reason)
      && (result.kind !== 'other' || result.reason === 'unsupported');
  } else {
    valid = result.answer === null && ['cropped', 'unreadable', 'missing_context'].includes(result.reason);
  }
  if (!valid) {
    pushUnique(violations, 'invalidStateCombination');
    return null;
  }
  return result;
}

/** Strict completion-time parser. `protocolEnabled=false` preserves legacy FINAL behavior. */
export function composeObjectiveResult(text        , protocolEnabled = true)                             {
  const normalizedText = text.replace(/\r\n?/g, '\n');
  const lines = normalizedText.split('\n');
  const markerIndexes = lines.flatMap((line, index) => line.startsWith(OBJECTIVE_RESULT_MARKER) ? [index] : []);
  const violations                               = [];
  if (markerIndexes.length > 1) pushUnique(violations, 'duplicateMarker');
  const nonEmptyLast = lines.findLastIndex((line) => line.trim() !== '');
  if (markerIndexes.length > 0 && markerIndexes.at(-1) !== nonEmptyLast) pushUnique(violations, 'markerNotLast');

  const visibleText = lines
    .filter((line) => !line.startsWith(OBJECTIVE_RESULT_MARKER))
    .join('\n')
    .replace(/\s+$/u, '');
  const finalAnswer = extractFinalAnswer(visibleText);
  let result                           = null;

  const markerInFence = markerIndexes.length === 1
    && markerIsInsideMarkdownFence(lines, markerIndexes[0] );
  if (markerInFence) pushUnique(violations, 'invalidStateCombination');

  if (protocolEnabled && markerIndexes.length === 1 && markerIndexes[0] === nonEmptyLast && !markerInFence) {
    const payload = lines[markerIndexes[0] ] .slice(OBJECTIVE_RESULT_MARKER.length).trimStart();
    if (new TextEncoder().encode(payload).length > 4096) {
      pushUnique(violations, 'oversizedJSON');
    } else {
      try {
        result = validateObject(JSON.parse(payload)           , violations);
      } catch {
        pushUnique(violations, 'invalidJSON');
      }
    }
    if (result && result.state !== 'retake') {
      if (!finalAnswer || normalizeObjectiveAnswer(finalAnswer) !== normalizeObjectiveAnswer(result.answer ?? '')) {
        pushUnique(violations, 'finalMismatch');
        result = null;
      }
    } else if (result?.state === 'retake' && finalAnswer !== null) {
      pushUnique(violations, 'invalidStateCombination');
      // An explicitly unusable result must not become a chargeable FINAL fallback.
      // The contradictory envelope is still invalid; do not turn it into a valid V1 score.
      pushUnique(violations, 'missingUsableResult');
      return { visibleText: '', finalAnswer: null, result: null, state: null, parserPath: 'none', violations };
    }
  }

  if (result) {
    return { visibleText, finalAnswer: result.answer, result, state: result.state, parserPath: 'v1', violations };
  }
  if (finalAnswer) {
    return {
      visibleText, finalAnswer, result: null,
      state: protocolEnabled ? 'review' : null,
      parserPath: protocolEnabled ? 'legacy_fallback' : 'legacy', violations,
    };
  }
  pushUnique(violations, 'missingUsableResult');
  return { visibleText, finalAnswer: null, result: null, state: null, parserPath: 'none', violations };
}

export function objectiveResultIsBillable(composition                            )          {
  return composition.parserPath === 'legacy_fallback'
    || (composition.parserPath === 'v1' && composition.state !== 'retake');
}
