import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { flushAudits } from "../audit";
import { getCorsHeaders, handleOptionsRequest, securityHeaders } from "../cors";
import { Errors } from "../errors";
import { verifyOriginHeader } from "../origin-verify";
import type { AppEnv } from "./types";

/**
 * Hono middleware for the single shared app (`src/node/app.ts`).
 *
 * These port the cross-cutting behavior of the Lambda wrappers
 * (`lib/middleware.ts` withAuth / `lib/withPublicCors.ts`) onto Hono while
 * reusing the existing logic in `lib/cors.ts` and `lib/origin-verify.ts` —
 * nothing here duplicates an origin list or a header policy.
 */

/**
 * Assign a request id for error bodies and audit logs. On Lambda this is the
 * invocation's `awsRequestId` (what `formatError` received before); locally it
 * honors an incoming `x-request-id` or generates one.
 */
export const requestId = (): MiddlewareHandler<AppEnv> => async (c, next) => {
	c.set(
		"requestId",
		c.env?.lambdaContext?.awsRequestId ??
			c.req.header("x-request-id") ??
			randomUUID(),
	);
	await next();
};

/**
 * Drain fire-and-forget `logAudit()` writes before the Lambda runtime can
 * freeze, even when a downstream handler throws — mirrors the `finally`
 * blocks in withAuth / withPublicCors. Must be mounted outermost (before
 * routing) so no handler can return without a flush.
 */
export const auditFlush = (): MiddlewareHandler<AppEnv> => async (_c, next) => {
	try {
		await next();
	} finally {
		await flushAudits();
	}
};

/**
 * Dynamic CORS + standard security headers.
 *
 * - OPTIONS preflight is answered here (parity with the old OPTIONS Lambda:
 *   method/header validation via `handleOptionsRequest`, no security headers).
 * - All other responses get `securityHeaders(getCorsHeaders(origin))` applied
 *   last, overriding handler-set headers — the exact merge order the Lambda
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

/**
 * Reject requests that did not arrive through CloudFront, reusing
 * `verifyOriginHeader` (including its skip conditions: local dev, or
 * ORIGIN_VERIFY_SECRET unset). Runs after CORS so preflight stays open,
 * matching withPublicCors ordering.
 */
export const originVerify =
	(): MiddlewareHandler<AppEnv> => async (c, next) => {
		if (!verifyOriginHeader(c.req.header())) {
			throw Errors.Forbidden();
		}
		await next();
	};
