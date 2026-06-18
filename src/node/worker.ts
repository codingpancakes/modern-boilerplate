import type {
	ExecutionContext,
	MessageBatch,
	Queue,
	R2Bucket,
	ScheduledController,
} from "@cloudflare/workers-types";
import { app } from "./app";
import { cronRegistry } from "./cron";
import { createLogger } from "./lib/logger";
import type { WorkOSWebhookEvent } from "./lib/validation/webhooks";
import { handleQueueBatch } from "./queue";

/**
 * Cloudflare Workers entry point (`main` in wrangler.toml) — the replacement
 * for every Lambda entry file. One Worker serves the whole backend:
 *
 *   - `fetch`     → delegates to the single Hono app (`src/node/app.ts`),
 *                   exactly like `handle(app)` did on Lambda.
 *   - `scheduled` → dispatches Cron Triggers by cron expression to the
 *                   registry in `src/node/cron.ts` (replaces the EventBridge
 *                   rules + scheduled Lambdas).
 *
 * `nodejs_compat` + the 2025+ compatibility_date populate `process.env` from
 * wrangler `[vars]` and secrets, so existing `process.env.X` reads work as-is.
 * Workers-specific bindings (R2 etc.) are NOT on `process.env`; they arrive on
 * `env` and are exposed to routes as `c.env.IMAGES` via Hono.
 */

/**
 * Bindings declared in wrangler.toml. Add a property here whenever a binding
 * is added there — this is the single source of truth for what `c.env`
 * carries beyond plain string vars. `AppEnv["Bindings"]`
 * (src/node/lib/hono/types.ts, owned by the libs agent) must extend this
 * shape for routes to see typed bindings.
 */
export type WorkerBindings = {
	/** R2 images bucket — `[[r2_buckets]] binding = "IMAGES"` in wrangler.toml. */
	IMAGES: R2Bucket;
	/**
	 * WorkOS webhook queue — `[[queues.producers]] binding = "WEBHOOK_QUEUE"` in
	 * wrangler.toml. The HTTP ingest route (routes/webhooks.ts) sends verified
	 * events here; `worker.queue` consumes them via `handleQueueBatch`.
	 *
	 * OPTIONAL because local dev (`wrangler dev --local`) and the Node test
	 * server run without a real queue binding — the route falls back to inline
	 * processing when it is absent (see routes/webhooks.ts).
	 */
	WEBHOOK_QUEUE?: Queue<WorkOSWebhookEvent>;
};

/**
 * The full `env` a Worker invocation receives: declared bindings plus the
 * string vars/secrets (also mirrored onto `process.env` by nodejs_compat).
 */
export type WorkerEnv = WorkerBindings & {
	[key: string]: R2Bucket | Queue<WorkOSWebhookEvent> | string | undefined;
};

/**
 * One scheduled job. Registered in `src/node/cron.ts` keyed by the EXACT cron
 * expression from wrangler.toml `[triggers]`. Handlers must finish their own
 * DB work (or hand background tails to `ctx.waitUntil`) and THROW on failure
 * so the platform records a failed invocation (the DLQ-alarm equivalent).
 */
export type CronHandler = (
	env: WorkerEnv,
	ctx: ExecutionContext,
) => Promise<void>;

const logger = createLogger({ serviceName: "worker" });

const worker = {
	fetch(
		request: Request,
		env: WorkerEnv,
		ctx: ExecutionContext,
	): Response | Promise<Response> {
		return app.fetch(request, env, ctx);
	},

	async scheduled(
		controller: ScheduledController,
		env: WorkerEnv,
		ctx: ExecutionContext,
	): Promise<void> {
		const job = cronRegistry[controller.cron];
		if (!job) {
			// A trigger fired with no registered handler — a wrangler.toml /
			// cron.ts mismatch. Throw so the invocation is recorded as failed
			// instead of silently succeeding (AGENTS.md: silent async failure
			// is a bug).
			logger.error("No cron handler registered for trigger", {
				cron: controller.cron,
				scheduledTime: controller.scheduledTime,
			});
			throw new Error(`No cron handler registered for "${controller.cron}"`);
		}
		await job(env, ctx);
	},

	/**
	 * Cloudflare Queues consumer entry point. Both the main webhook queue and
	 * its dead-letter queue route here; `handleQueueBatch` (src/node/queue.ts)
	 * branches on `batch.queue`. Replaces the old webhook DLQ + alarm.
	 */
	async queue(
		batch: MessageBatch<WorkOSWebhookEvent>,
		env: WorkerEnv,
		ctx: ExecutionContext,
	): Promise<void> {
		return handleQueueBatch(batch, env, ctx);
	},
};

export default worker;
