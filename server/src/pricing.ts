// Question-pack catalog (题数额度制). The account balance is measured in questions, not money:
// one successful capture costs exactly one question, so the user knows the price of a hotkey
// press before pressing it. Money only appears here — the packs sold on the top-up page.

export interface QuestionPack {
  id: string;
  questions: number;
  amountCents: number; // price in cents of the configured currency
}

// Default catalog (CNY): a small taster, the value sweet spot, and a bulk pack. Operators
// override via PACKS_JSON without redeploying code.
export const DEFAULT_PACKS_JSON = JSON.stringify([
  { id: 'pack100', questions: 100, amount_cents: 900 },
  { id: 'pack300', questions: 300, amount_cents: 2400 },
  { id: 'pack1000', questions: 1000, amount_cents: 6800 },
]);

/**
 * Parse and validate a PACKS_JSON value. Any malformed input (bad JSON, missing fields,
 * non-positive numbers, duplicate ids) falls back to the default catalog — a misconfigured
 * env var must never take the store offline or sell a 0-question pack.
 */
export function parsePacks(raw: string): QuestionPack[] {
  const fallback = (): QuestionPack[] => parseTrusted(DEFAULT_PACKS_JSON);
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return fallback();
  }
  if (!Array.isArray(arr) || arr.length === 0) return fallback();
  const out: QuestionPack[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const o = item as { id?: unknown; questions?: unknown; amount_cents?: unknown };
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const questions = typeof o.questions === 'number' ? Math.trunc(o.questions) : 0;
    const amountCents = typeof o.amount_cents === 'number' ? Math.trunc(o.amount_cents) : 0;
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || seen.has(id)) return fallback();
    if (!(questions > 0 && questions <= 1_000_000)) return fallback();
    if (!(amountCents > 0 && amountCents <= 100_000_000)) return fallback();
    seen.add(id);
    out.push({ id, questions, amountCents });
  }
  return out;
}

function parseTrusted(json: string): QuestionPack[] {
  return (JSON.parse(json) as { id: string; questions: number; amount_cents: number }[]).map(
    (p) => ({ id: p.id, questions: p.questions, amountCents: p.amount_cents }),
  );
}

/** Find a pack by id (the stub top-up endpoint and future webhooks resolve packs this way). */
export function findPack(packs: readonly QuestionPack[], id: string): QuestionPack | null {
  return packs.find((p) => p.id === id) ?? null;
}
