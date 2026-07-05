// Token → money. Pure and unit-tested. Rates are cents (in the configured currency) per one
// million tokens; the charge is rounded UP so we never undercharge, and any non-zero usage
// costs at least 1 cent.

export function costCents(
  inputTokens: number,
  outputTokens: number,
  inputCentsPerMTok: number,
  outputCentsPerMTok: number,
): number {
  const raw =
    (Math.max(0, inputTokens) * inputCentsPerMTok +
      Math.max(0, outputTokens) * outputCentsPerMTok) /
    1_000_000;
  return Math.ceil(raw);
}
