import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { flushAudits, runWithAuditScope } from "../audit";
import { getCorsHeaders, handleOptionsRequest, securityHeaders } from "../cors";
import { runWithDbScope } from "../db";
import { runWithSentryScope } from "../sentry";
import type { AppEnv } from "./types";

/**
 * Hono middleware for the single shared app (`src/node/app.ts`).
 *
 * These port the cross-cutting behavior of the old Lambda wrappers onto Hono
 * while reusing the existing logic in `lib/cors.ts` — nothing here duplicates
 * an origin list or a header policy.
 */

/**
 * Assign a request id for error bodies and audit logs. On Cloudflare the
 * `cf-ray` header is the platform's request id (searchable in Cloudflare
 * logs); locally an incoming `x-request-id` is honored, else one is generated.
 */
export const requestId = (): MiddlewareHandler<AppEnv> => async (c, next) => {
	c.set(
		"requestId",
		c.req.header("cf-ray") ?? c.req.header("x-request-id") ?? randomUUID(),
	);
	await next();
};

/**
 * Give every request its own database lifecycle (see `runWithDbScope` in
 * lib/db.ts): all `getDb()` calls during the request share one pool, drained
 * when the request finishes. Required on Workers, where I/O objects must not
 * be reused across requests. Must be mounted BEFORE `auditFlush()` so the
 * audit drain still runs inside the scope.
 */
export const dbScope = (): MiddlewareHandler<AppEnv> => (_c, next) =>
	runWithDbScope(() => next());

/**
 * Establish the per-request audit + Sentry buffers and drain the audit writes
 * before the request finishes (even when a downstream handler throws — an
 * un-awaited promise alone isn't guaranteed to complete once the response is
 * returned). The Sentry buffer is scoped here too so `app.onError`'s `flush()`
 * drains only THIS request's error sends, not the whole isolate's. Must run
 * inside `dbScope()` (mounted after it) so drained writes can use the pool.
 */
export const auditFlush = (): MiddlewareHandler<AppEnv> => (_c, next) =>
	runWithSentryScope(() =>
		runWithAuditScope(async () => {
			try {
				await next();
			} finally {
				await flushAudits();
			}
		}),
	);

/**
 * Dynamic CORS + standard security headers.
 *
 * - OPTIONS preflight is answered here (method/header validation via
 *   `handleOptionsRequest`, no security headers).
 * - All other responses get `securityHeaders(getCorsHeaders(origin))` applied
 *   last, overriding handler-set headers — the exact merge order the old
 *   wrappers used.
 */
export const corsAndSecurityHeaders =
	(): MiddlewareHandler<AppEnv> => async (c, next) => {
		const origin = c.req.header("origin");

		if (c.req.method === "OPTIONS") {
			const preflight = handleOptionsRequest(origin, c.req.header());
			return new Response(preflight.body || null, {
				status: preflight.statusCode,
				headers: preflight.headers,
			});
		}

		await next();

		const headers = securityHeaders(getCorsHeaders(origin));
		for (const [key, value] of Object.entries(headers)) {
			c.res.headers.set(key, value);
		}
	};
