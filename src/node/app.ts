import { type ErrorHandler, Hono, type NotFoundHandler } from "hono";
import { getCorsHeaders, securityHeaders } from "./lib/cors";
import { toError } from "./lib/error-utils";
import { Errors, formatError } from "./lib/errors";
import {
	auditFlush,
	corsAndSecurityHeaders,
	dbScope,
	requestId,
} from "./lib/hono/middleware";
import { rateLimit } from "./lib/hono/rate-limit";
import type { AppEnv } from "./lib/hono/types";
import * as Sentry from "./lib/sentry";
import { routes } from "./routes";

/**
 * The single Hono app serving every REST route.
 *
 * On Cloudflare it is the Worker's `fetch` handler (`src/node/worker.ts`);
 * locally the SAME app runs under `wrangler dev --local` (or
 * `@hono/node-server`) — one routing layer, no dev/prod drift.
 *
 * Middleware order:
 *   1. request-id        — cf-ray on Cloudflare, generated locally
 *   2. db scope          — per-request DB lifecycle (Workers forbids
 *                          cross-request reuse of connections)
 *   3. audit flush       — drain fire-and-forget logAudit() writes, always
 *   4. CORS + security   — answers OPTIONS preflight, decorates responses
 * Auth is per-domain, applied in `routes/index.ts`. (The old CloudFront
 * origin-verify check is gone by construction: the Worker IS the edge.)
 */
export const app = new Hono<AppEnv>();

app.use(requestId());
// Per-IP rate limit early — reject before opening a DB pool or verifying a
// token. No-op when the RATE_LIMITER binding is absent (local dev / tests).
app.use(rateLimit());
app.use(dbScope());
app.use(auditFlush());
app.use(corsAndSecurityHeaders());

app.route("/", routes);

/**
 * Funnel unmatched paths through the standard error formatter.
 *
 * Exported (with {@link appOnError}) so any wrapper app that adds extra
 * routes can mirror both — Hono's `route()` does NOT carry a sub-app's
 * notFound/onError to a parent app.
 */
export const appNotFound: NotFoundHandler<AppEnv> = () => {
	throw Errors.NotFound("Route");
};

export const appOnError: ErrorHandler<AppEnv> = async (err, c) => {
	const error = toError(err);
	// Capture everything; lib/sentry drops routine 4xx client errors
	// (keeps 403 + 429).
	Sentry.captureException(error);
	await Sentry.flush();

	// formatError is the single source of the wire shape:
	// { success: false, error, details: { code, extra?, requestId, timestamp } }
	const formatted = formatError(err, c.get("requestId"));

	// Error responses bypass the post-handler CORS middleware, so apply the
	// same headers here — same merge order as always.
	const headers = securityHeaders({
		...formatted.headers,
		...getCorsHeaders(c.req.header("origin")),
	});
	return new Response(formatted.body, {
		status: formatted.statusCode,
		headers,
	});
};

app.notFound(appNotFound);
app.onError(appOnError);
