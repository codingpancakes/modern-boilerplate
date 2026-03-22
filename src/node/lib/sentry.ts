/**
 * Sentry Error Tracking Integration
 *
 * Captures and reports errors to Sentry for monitoring and alerting.
 * Automatically enriches errors with user context, request details, and environment info.
 */

import * as Sentry from "@sentry/node";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENVIRONMENT =
	process.env.SENTRY_ENVIRONMENT || process.env.STAGE || "development";
const SENTRY_ENABLED = !!SENTRY_DSN && process.env.NODE_ENV !== "test";

interface ErrorWithStatusCode extends Error {
	statusCode?: number;
}

// Initialize Sentry
if (SENTRY_ENABLED) {
	Sentry.init({
		dsn: SENTRY_DSN,
		environment: SENTRY_ENVIRONMENT,
		tracesSampleRate: SENTRY_ENVIRONMENT === "production" ? 0.1 : 1.0, // 10% in prod, 100% in staging
		beforeSend(event, hint) {
			// Filter out expected errors (like 404s, validation errors)
			const error = hint.originalException as ErrorWithStatusCode;
			if (error?.statusCode) {
				// Don't send client errors (4xx) to Sentry
				if (error.statusCode >= 400 && error.statusCode < 500) {
					return null;
				}
			}
			return event;
		},
	});
}

const SENSITIVE_QUERY_KEYS = new Set([
	"token",
	"key",
	"secret",
	"password",
	"auth",
	"api_key",
	"apikey",
	"access_token",
	"refresh_token",
	"session",
	"code",
]);

/**
 * Set request context for error tracking
 */
export function setRequestContext(event: APIGatewayProxyEventV2) {
	if (!SENTRY_ENABLED) return;

	Sentry.setContext("request", {
		method: event.requestContext.http.method,
		path: event.requestContext.http.path,
		userAgent: event.requestContext.http.userAgent,
		requestId: event.requestContext.requestId,
	});

	// Add query parameters with sensitive values redacted
	if (event.queryStringParameters) {
		const filtered: Record<string, string> = {};
		for (const [k, v] of Object.entries(event.queryStringParameters)) {
			filtered[k] = SENSITIVE_QUERY_KEYS.has(k.toLowerCase())
				? "[REDACTED]"
				: (v ?? "");
		}
		Sentry.setContext("query", filtered);
	}
}

/**
 * Capture exception manually
 */
export function captureException(
	error: Error,
	context?: Record<string, unknown>,
) {
	if (!SENTRY_ENABLED) {
		console.error("Sentry not enabled, error:", error);
		return;
	}

	if (context) {
		Sentry.setContext("additional", context);
	}

	Sentry.captureException(error);
}

/**
 * Flush Sentry events (call before Lambda exits)
 */
export async function flush(): Promise<boolean> {
	if (!SENTRY_ENABLED) return true;
	return Sentry.flush(2000); // 2 second timeout
}

export { Sentry };
