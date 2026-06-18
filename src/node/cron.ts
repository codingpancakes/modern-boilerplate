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
 * Jobs replace the EventBridge-scheduled Lambdas: they await their own DB
 * work and THROW on failure so the platform records a failed invocation
 * (failed-invocation visibility replaces the old DLQ alarms).
 *
 * Each job runs inside {@link runWithDbScope} so its `getDb()` calls share one
 * pool that is drained when the job finishes — cron runs outside the HTTP
 * `dbScope()` middleware, so without this a job would leak its pool.
 *
 * Local test: wrangler dev --local --test-scheduled, then
 *   curl "http://localhost:8787/__scheduled?cron=0+4+*+*+*"
 */
export const cronRegistry: Record<string, CronHandler> = {
	// Daily idempotency-key cleanup (was JanitorSchedule, rate(1 day)).
	"0 4 * * *": (_env, _ctx) => runWithDbScope(() => runJanitor()),
	// Daily 7-year audit-log retention pruning (was AuditRetentionSchedule).
	"0 5 * * *": (_env, _ctx) => runWithDbScope(() => runAuditRetention()),
};
