import { type ErrorHandler, Hono, type NotFoundHandler } from "hono";
import { getCorsHeaders, securityHeaders } from "./lib/cors";
import { toError } from "./lib/error-utils";
import { Errors, formatError } from "./lib/errors";
import {
	auditFlush,
	corsAndSecurityHeaders,
	originVerify,
	requestId,
} from "./lib/hono/middleware";
import type { AppEnv } from "./lib/hono/types";
import * as Sentry from "./lib/sentry";
import { routes } from "./routes";

/**
 * The single Hono app serving every REST route.
 *
 * On Lambda it is adapted via `handle(app)` (`src/node/lambda.ts`); locally
 * the SAME app is served with `@hono/node-server` — one routing layer, no
 * dev/prod drift. GraphQL is intentionally NOT mounted here; it stays a
 * separate Apollo Lambda (`src/node/handlers/graphql/`).
 *
 * Middleware order (mirrors the Lambda wrappers in `lib/middleware.ts` /
 * `lib/withPublicCors.ts`):
 *   1. request-id        — awsRequestId on Lambda, generated locally
 *   2. audit flush       — drain fire-and-forget logAudit() writes, always
 *   3. CORS + security   — answers OPTIONS preflight, decorates responses
 *   4. origin verify     — CloudFront shared-secret check (skips local/unset)
 * Auth is per-domain, applied in `routes/index.ts`.
 */
export const app = new Hono<AppEnv>();

app.use(requestId());
app.use(auditFlush());
app.use(corsAndSecurityHeaders());
app.use(originVerify());

app.route("/", routes);

/**
 * Funnel unmatched paths through the standard error formatter.
 *
 * Exported (with {@link appOnError}) because Hono's `route()` does NOT carry
 * a sub-app's notFound/onError to a parent app — the local dev server
 * (`local-dev/server.ts`) wraps this app to add local-only routes and must
 * mirror both so unmatched paths and errors format identically everywhere.
 */
export const appNotFound: NotFoundHandler<AppEnv> = () => {
	throw Errors.NotFound("Route");
};

export const appOnError: ErrorHandler<AppEnv> = async (err, c) => {
	const error = toError(err);
	// Same reporting as withAuth: capture everything; lib/sentry's beforeSend
	// drops routine 4xx client errors (keeps 403 + 429).
	Sentry.captureException(error);
	await Sentry.flush();

	// formatError is the single source of the wire shape:
	// { success: false, error, details: { code, extra?, requestId, timestamp } }
	const formatted = formatError(err, c.get("requestId"));

	// Error responses bypass the post-handler CORS middleware, so apply the
	// same headers here — same merge order as the Lambda wrappers.
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
