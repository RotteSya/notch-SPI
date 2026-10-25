// Review pauses automatic capture without ending the session or its current solve.
export function canPollAutomatic({ active, busy, polling, reviewPending }) {
  return Boolean(active && !busy && !polling && !reviewPending);
}
