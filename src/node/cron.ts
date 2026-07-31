import { runAuditRetention } from "./handlers/utils/audit-retention";
import { runJanitor } from "./handlers/utils/janitor";
import { runWithDbScope } from "./lib/db";
import type { CronHandler } from "./worker";

/**
 * Cron registry — maps the EXACT cron expressions from wrangler.toml
 * `[triggers].crons` to their jobs. `worker.scheduled` (src/node/worker.ts)
 * dispatches with `cronRegistry[controller.cron]` and throws when a trigger
 * has no entry, so keys must stay byte-identical to wrangler.toml. The
 * key↔toml correspondence is guarded by tests/unit/cron.test.ts.
 *
 * Jobs await their own DB work and THROW on failure so the platform records
 * a failed invocation.
 *
 * Each job runs inside {@link runWithDbScope} so its `getDb()` calls share one
 * pool that is drained when the job finishes — cron runs outside the HTTP
 * `dbScope()` middleware, so without this a job would leak its pool.
 *
 * Local test: wrangler dev --local --test-scheduled, then
 *   curl "http://localhost:8787/__scheduled?cron=0+4+*+*+*"
 */
export const cronRegistry: Record<string, CronHandler> = {
	// Daily maintenance in a SINGLE trigger: idempotency-key cleanup +
	// 7-year audit-log retention pruning. Cloudflare caps cron triggers per
	// account, so one trigger per environment (instead of two) keeps
	// multi-project accounts well under the limit. Both jobs run even if one
	// fails; failures are aggregated and rethrown so the invocation is recorded
	// as failed.
	"0 4 * * *": (_env, _ctx) =>
		runWithDbScope(async () => {
			const results = await Promise.allSettled([
				runJanitor(),
				runAuditRetention(),
			]);
			const failures = results
				.filter((r): r is PromiseRejectedResult => r.status === "rejected")
				.map((r) => r.reason);
			if (failures.length > 0) {
				throw new AggregateError(failures, "daily maintenance job(s) failed");
			}
		}),
};
