/**
 * Sentry Error Tracking Integration
 *
 * Captures and reports errors to Sentry for monitoring and alerting.
 * Automatically enriches errors with user context, request details, and environment info.
 */

import { Logger } from "@aws-lambda-powertools/logger";
import * as Sentry from "@sentry/node";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const logger = new Logger({ serviceName: "sentry" });

const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENVIRONMENT =
	process.env.SENTRY_ENVIRONMENT || process.env.STAGE || "development";
const SENTRY_ENABLED = !!SENTRY_DSN && process.env.NODE_ENV !== "test";

interface ErrorWithStatusCode extends Error {
	statusCode?: number;
}

// Initialize Sentry
if (SENTRY_ENABLED) {
	const GRAPHQL_CLIENT_CODES = new Set([
		"BAD_USER_INPUT",
		"GRAPHQL_VALIDATION_FAILED",
		"GRAPHQL_PARSE_FAILED",
		"NOT_FOUND",
		"CONFLICT",
	]);

	Sentry.init({
		dsn: SENTRY_DSN,
		environment: SENTRY_ENVIRONMENT,
		tracesSampleRate: SENTRY_ENVIRONMENT === "production" ? 0.1 : 1.0,
		beforeSend(event, hint) {
			const error = hint.originalException;
			if (error && typeof error === "object") {
				// Drop routine REST client errors (keep 403 + 429)
				if (
					"statusCode" in error &&
					typeof (error as ErrorWithStatusCode).statusCode === "number"
				) {
					const statusCode = (error as ErrorWithStatusCode).statusCode ?? 0;
					if (
						statusCode >= 400 &&
						statusCode < 500 &&
						statusCode !== 403 &&
						statusCode !== 429
					) {
						return null;
					}
				}
				// Drop routine GraphQL client errors (keep FORBIDDEN + UNAUTHENTICATED)
				if ("extensions" in error) {
					const code = (error as { extensions?: { code?: string } }).extensions
						?.code;
					if (code && GRAPHQL_CLIENT_CODES.has(code)) {
						return null;
					}
				}
			}
			return event;
		},
	});
}

const SENSITIVE_QUERY_EXACT = new Set([
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
	"credential",
	"jwt",
	"bearer",
	"ssn",
	"pin",
]);

const SENSITIVE_SUBSTRINGS = [
	"token",
	"secret",
	"password",
	"passwd",
	"credential",
	"api_key",
	"apikey",
	"auth",
];

function isSensitiveKey(key: string): boolean {
	const lower = key.toLowerCase();
	if (SENSITIVE_QUERY_EXACT.has(lower)) return true;
	return SENSITIVE_SUBSTRINGS.some((sub) => lower.includes(sub));
}

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

	// Enrich with user/org from authorizer claims when available
	const authCtx = (
		event.requestContext as {
			authorizer?: { lambda?: Record<string, string> };
		}
	).authorizer?.lambda;
	if (authCtx?.sub) {
		Sentry.setUser({
			id: authCtx.sub,
			email: authCtx.email || undefined,
		});
		if (authCtx.org_id) {
			Sentry.setTag("org_id", authCtx.org_id);
		}
	}

	// Add query parameters with sensitive values redacted
	if (event.queryStringParameters) {
		const filtered: Record<string, string> = {};
		for (const [k, v] of Object.entries(event.queryStringParameters)) {
			filtered[k] = isSensitiveKey(k) ? "[REDACTED]" : (v ?? "");
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
		logger.error("Sentry not enabled, logging error locally", {
			error: error.message,
		});
		return;
	}

	Sentry.withScope((scope) => {
		if (context) {
			scope.setContext("additional", context);
		}
		Sentry.captureException(error);
	});
}

/**
 * Flush Sentry events (call before Lambda exits)
 */
export async function flush(): Promise<boolean> {
	if (!SENTRY_ENABLED) return true;
	return Sentry.flush(2000); // 2 second timeout
}

export { Sentry };
