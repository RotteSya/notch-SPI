# Cloudflare recovery scheduler

`scheduler/src/index.ts` is the production Worker. `scheduler/src/candidate.ts` is a separate candidate entry. Each performs one authenticated `GET /api/internal/reap`, with a 45-second deadline, no followed redirects, at most 4 KiB of body, and a failed invocation when reconciliation is partial. Logs carry counts, timestamps, and status. The request carries `CRON_SECRET` and no database, payment, or model credential.

The source cron list is empty. That is the repository default. Whether a deployed Worker has a schedule is a deployment fact, recorded with the schedule and the invocation evidence. Public and preview URLs are disabled in the source config. The production entry and the candidate entry keep separate targets; environment variables do not point one entry at the other.

Tool versions and overrides are owned by `scheduler/package.json` and `scheduler/package-lock.json`. From `scheduler/`:

```sh
npm ci --include=optional
npm run typecheck
npm test
npm run build
```

`npm run typecheck` runs `wrangler types --check` and `tsc --noEmit`. `npm run build` dry-runs the production config and `wrangler.candidate.jsonc`. `scheduler/worker-configuration.d.ts` is the declaration those checks read. Regenerate it only with the locked Wrangler, and review the diff.

## Activation

1. Confirm the stored production credential and the Worker binding match, without printing either.
2. Probe the target with and without authorization. Require a 200 recovery body and a 401 denial.
3. Set the trigger in the Wrangler config that belongs to that Worker and apply it through Cloudflare. Leave public URLs disabled.
4. Collect a real scheduled event, including one controlled expired reservation, and confirm a single release in the persistent ledger.
5. Record the activation time and the deployment id. Rollback removes the schedule first.

## Dated record, 2026-09-10

The first observed scheduled release occurred about 4 hours 50 minutes after activation. On a second activation, an expired reservation was still held 17 minutes 26.9 seconds after the schedule was created and 6 minutes 34.2 seconds after expiry. It was then cleaned through the authenticated candidate endpoint. Both schedules were left empty, and both public and preview URLs stayed disabled. The narrative remains in Git; the index is [docs/history/index.json](history/index.json). Passing unit tests do not replace that timing evidence.

## Model budget

[`deploy/production-model-budget.json`](../deploy/production-model-budget.json) is the production model budget: CNY 20 per Shanghai calendar day, shared by official solves, explanations, and recovery attempts. The evaluation campaign budget is the separate file [`docs/evaluation-budget.json`](evaluation-budget.json).
