/**
 * Sentry Error Tracking Integration — platform-neutral, fetch-based.
 *
 * The Node SDK (`@sentry/node`) does not run on Cloudflare Workers, so this
 * module reports errors with a minimal Sentry envelope sent over plain
 * `fetch` (available on Workers and Node 24 alike). Fully env-gated: with no
 * SENTRY_DSN it degrades to a structured local log line; under NODE_ENV=test
 * it is silent.
 *
 * Kept from the old SDK setup:
 *  - the beforeSend filtering (drop routine 4xx REST client errors except
 *    403/429; drop routine GraphQL client error codes)
 *  - the exported surface used by callers: `captureException`, `flush`
 *
 * Deliberately NOT ported: ambient per-request scopes (`Sentry.setUser`,
 * `setContext`). They relied on module-level mutable state, which on Workers
 * is shared across CONCURRENT requests in one isolate — request context could
 * leak between unrelated errors. Pass request-specific data through
 * `captureException(error, context)` instead.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createLogger } from "./logger";

const logger = createLogger({ serviceName: "sentry" });

const SENTRY_CLIENT = "sidedoor-fetch-shim/1.0.0";

interface ErrorWithStatusCode extends Error {
	statusCode?: number;
}

const GRAPHQL_CLIENT_CODES = new Set([
	"BAD_USER_INPUT",
	"GRAPHQL_VALIDATION_FAILED",
	"GRAPHQL_PARSE_FAILED",
	"NOT_FOUND",
	"CONFLICT",
]);

interface SentryEndpoint {
	envelopeUrl: string;
	authHeader: string;
}

/**
 * Parse the DSN per call (env vars are populated per invocation on Workers).
 * DSN shape: https://PUBLIC_KEY@HOST/PROJECT_ID
 */
function getEndpoint(): SentryEndpoint | null {
	const dsn = process.env.SENTRY_DSN;
	if (!dsn || process.env.NODE_ENV === "test") return null;

	let url: URL;
	try {
		url = new URL(dsn);
	} catch {
		logger.error("Invalid SENTRY_DSN; error reporting disabled");
		return null;
	}
	const projectId = url.pathname.replace(/\//g, "");
	if (!url.username || !projectId) {
		logger.error("Invalid SENTRY_DSN; error reporting disabled");
		return null;
	}
	return {
		envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
		authHeader: `Sentry sentry_version=7, sentry_client=${SENTRY_CLIENT}, sentry_key=${url.username}`,
	};
}

function environment(): string {
	return process.env.SENTRY_ENVIRONMENT || process.env.STAGE || "development";
}

/**
 * Port of the SDK `beforeSend` filter: drop routine client errors so Sentry
 * only alerts on real failures (keep 403 + 429 and auth-shaped GraphQL codes).
 */
function isRoutineClientError(error: Error): boolean {
	const statusCode = (error as ErrorWithStatusCode).statusCode;
	if (typeof statusCode === "number") {
		if (
			statusCode >= 400 &&
			statusCode < 500 &&
			statusCode !== 403 &&
			statusCode !== 429
		) {
			return true;
		}
	}
	if ("extensions" in error) {
		const code = (error as { extensions?: { code?: string } }).extensions?.code;
		if (code && GRAPHQL_CLIENT_CODES.has(code)) {
			return true;
		}
	}
	return false;
}

/**
 * In-flight envelope sends, drained by {@link flush}. Held PER-REQUEST in
 * AsyncLocalStorage (mirroring the DB pool and audit buffer): a module-level
 * set would be shared by every concurrent request in the isolate, so one
 * request's `flush()` would await — and head-of-line-block on — another
 * request's Sentry POST during an error storm. Outside a scope (cron/queue)
 * sends are detached and `flush()` is a no-op.
 */
const sentryScopeStorage = new AsyncLocalStorage<Set<Promise<void>>>();

/**
 * Run `fn` with a per-request Sentry send buffer. The request middleware wraps
 * every HTTP request in this; `captureException` sends started inside are
 * drained by {@link flush} (called from `app.onError`).
 */
export function runWithSentryScope<T>(fn: () => Promise<T>): Promise<T> {
	return sentryScopeStorage.run(new Set<Promise<void>>(), fn);
}

function sendEnvelope(endpoint: SentryEndpoint, event: object): void {
	const eventId = crypto.randomUUID().replace(/-/g, "");
	const sentAt = new Date().toISOString();
	const envelope = [
		JSON.stringify({ event_id: eventId, sent_at: sentAt }),
		JSON.stringify({ type: "event" }),
		JSON.stringify({ event_id: eventId, ...event }),
	].join("\n");

	const send = fetch(endpoint.envelopeUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-sentry-envelope",
			"X-Sentry-Auth": endpoint.authHeader,
		},
		body: envelope,
	}).then(
		(response) => {
			if (!response.ok) {
				logger.warn("Sentry rejected error envelope", {
					status: response.status,
				});
			}
		},
		(error: unknown) => {
			logger.warn("Failed to send error to Sentry", {
				error: error instanceof Error ? error.message : String(error),
			});
		},
	);
	const pending = sentryScopeStorage.getStore();
	if (pending) {
		pending.add(send);
		void send.finally(() => pending.delete(send));
	}
	// Outside a request scope the send is detached (fire-and-forget) — there is
	// no flush() boundary to await it, which is fine for cron/queue paths.
}

/**
 * Capture exception manually. `context` lands under `extra.additional` in
 * the Sentry event (the replacement for the old per-request scope).
 */
export function captureException(
	error: Error,
	context?: Record<string, unknown>,
): void {
	if (process.env.NODE_ENV === "test") return;

	const endpoint = getEndpoint();
	if (!endpoint) {
		if (!process.env.SENTRY_DSN) {
			logger.error("Sentry not enabled, logging error locally", {
				error: error.message,
			});
		}
		return;
	}

	if (isRoutineClientError(error)) return;

	sendEnvelope(endpoint, {
		timestamp: Date.now() / 1000,
		platform: "javascript",
		level: "error",
		environment: environment(),
		exception: {
			values: [
				{
					type: error.name || "Error",
					value: error.message,
				},
			],
		},
		extra: {
			// Raw stack string — frame parsing is a TODO; the stack is fully
			// visible in the Sentry UI under "Additional Data".
			stack: error.stack,
			...(context ? { additional: context } : {}),
		},
	});
}

/**
 * Await in-flight error reports (call before the invocation ends so sends
 * are not cancelled with the request context). Never rejects.
 */
export async function flush(): Promise<boolean> {
	const pending = sentryScopeStorage.getStore();
	if (!pending || pending.size === 0) return true;
	await Promise.allSettled([...pending]);
	return true;
}
