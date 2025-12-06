import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	Context,
} from "aws-lambda";
import { getCorsHeaders, handleOptionsRequest } from "./cors";
// Auth claims are now provided by API Gateway authorizer
import { formatError } from "./errors";
import { tracer } from "./tracer";
import * as Sentry from "./sentry";

export interface AuthenticatedEvent extends APIGatewayProxyEventV2 {
	claims: {
		sub: string;
		sid?: string;
		iss?: string;
		org_id?: string;
		role?: string;
		permissions?: string;
		exp?: number;
		iat?: number;
		// WorkOS custom claims with URN format
		"urn:postway:email"?: string;
		"urn:postway:first_name"?: string;
		"urn:postway:last_name"?: string;
		"urn:postway:metadata"?: string;
		"urn:postway:external_id"?: string;
		"urn:postway:org_unit"?: string;
		// Allow any additional claims
		[key: string]: string | number | boolean | undefined;
	};
}

export interface HandlerResponse {
	statusCode: number;
	headers?: Record<string, string>;
	body: string;
}

export type AuthenticatedHandler = (
	event: AuthenticatedEvent,
	context: Context,
) => Promise<HandlerResponse>;

export const withAuth = (
	handlerFn: AuthenticatedHandler,
): APIGatewayProxyHandlerV2 => {
	return async (event, context) => {
		const origin = event.headers.origin || event.headers.Origin;

		// Preflight
		if (event.requestContext.http.method === "OPTIONS") {
			return handleOptionsRequest(
				origin,
				event.headers as Record<string, string>,
			);
		}

		try {
			// Set request context for Sentry
			Sentry.setRequestContext(event);

			// Require claims from API Gateway's authorizer (no local fallback)
			const requestContext = event.requestContext as {
				authorizer?: { lambda?: Record<string, unknown> };
			} & typeof event.requestContext;
			const lambdaCtx = requestContext?.authorizer?.lambda;
			const claims = lambdaCtx as AuthenticatedEvent["claims"] | undefined;

			if (!claims?.sub) {
				// Add trace annotation for failed auth
				const segment = tracer.getSegment();
				if (segment) {
					segment.addAnnotation("authFailed", true);
				}
				return {
					statusCode: 401,
					headers: securityHeaders(corsHeaders(origin)),
					body: JSON.stringify({ error: "unauthorized" }),
				};
			}

			// Set user context for Sentry
			Sentry.setUser(
				claims.sub,
				claims["urn:postway:email"],
				claims["urn:postway:first_name"] || undefined,
			);

			// Add user ID to trace
			const segment = tracer.getSegment();
			if (segment) {
				segment.addAnnotation("userId", claims.sub);
				if (claims.org_id) {
					segment.addAnnotation("orgId", claims.org_id);
				}
			}

			const result = await handlerFn(
				{ ...event, claims } as AuthenticatedEvent,
				context,
			);

			// Flush Sentry before returning
			await Sentry.flush();

			return {
				statusCode: result.statusCode,
				headers: securityHeaders({
					...(result.headers || {}),
					...corsHeaders(origin),
				}),
				body: result.body,
			};
		} catch (err) {
			// Capture error in Sentry
			Sentry.captureException(err as Error);
			await Sentry.flush();

			// Add error to trace
			const segment = tracer.getSegment();
			if (segment) {
				segment.addError(err as Error);
			}
			const errorResponse = formatError(err, context.awsRequestId);
			return {
				...errorResponse,
				headers: securityHeaders({
					...(errorResponse.headers ?? {}),
					...corsHeaders(origin),
				}),
			};
		}
	};
};

function corsHeaders(origin?: string) {
	const base = getCorsHeaders(origin); // implement strict allow-list internally
	return {
		...base,
		Vary: "Origin",
		"Access-Control-Allow-Headers":
			"authorization,content-type,x-request-id,x-csrf-token",
		"Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
	};
}

/**
 * Add security headers to response
 */
function securityHeaders(headers: Record<string, string>): Record<string, string> {
	return {
		...headers,
		// HSTS - Force HTTPS for 1 year
		"Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
		// Prevent MIME type sniffing
		"X-Content-Type-Options": "nosniff",
		// Prevent clickjacking
		"X-Frame-Options": "DENY",
		// CSP - API only returns JSON, no scripts
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
		// Referrer policy
		"Referrer-Policy": "strict-origin-when-cross-origin",
		// Permissions policy
		"Permissions-Policy": "geolocation=(), microphone=(), camera=()",
	};
}
