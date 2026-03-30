import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyHandlerV2,
	Context,
} from "aws-lambda";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "./audit";
import { getCorsHeaders, handleOptionsRequest, securityHeaders } from "./cors";
// Auth claims are now provided by API Gateway authorizer
import { toError } from "./error-utils";
import { formatError } from "./errors";
import * as Sentry from "./sentry";
import { tracer } from "./tracer";

export interface AuthenticatedEvent extends APIGatewayProxyEventV2 {
	claims: {
		sub: string;
		sid?: string;
		iss?: string;
		org_id?: string;
		role?: string;
		permissions?: string;
		exp?: number | string;
		iat?: number | string;
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

			// HTTP API simple authorizer returns all context values as strings,
			// so exp/iat arrive as e.g. "1711385600" or "" — accept both types.
			const isNumericish = (v: unknown): boolean =>
				v === undefined ||
				v === "" ||
				typeof v === "number" ||
				(typeof v === "string" && /^\d+$/.test(v));

			const claimsValid =
				lambdaCtx &&
				typeof lambdaCtx.sub === "string" &&
				lambdaCtx.sub.length > 0 &&
				isNumericish(lambdaCtx.exp) &&
				isNumericish(lambdaCtx.iat);

			if (!claimsValid) {
				// Add trace annotation for failed auth
				const segment = tracer.getSegment();
				if (segment) {
					segment.addAnnotation("authFailed", true);
				}
				// Fire-and-forget — never block the 401 response
				void logAudit({
					action: AUDIT_ACTIONS.ACCESS_DENIED,
					resourceType: AUDIT_RESOURCE_TYPES.USER,
					status: AUDIT_STATUS.FAILURE,
					ipAddress: event.requestContext?.http?.sourceIp,
					userAgent: event.headers?.["user-agent"],
					requestId: event.requestContext?.requestId,
					metadata: {
						reason: "missing_claims",
						path: event.requestContext?.http?.path,
						method: event.requestContext?.http?.method,
					},
				});
				return {
					statusCode: 401,
					headers: securityHeaders(corsHeaders(origin)),
					body: JSON.stringify({
						success: false,
						error: "Unauthorized",
						details: {
							code: "UNAUTHORIZED",
							requestId: event.requestContext?.requestId,
							timestamp: new Date().toISOString(),
						},
					}),
				};
			}

			const claims = lambdaCtx as AuthenticatedEvent["claims"];

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

			return {
				statusCode: result.statusCode,
				headers: securityHeaders({
					...(result.headers || {}),
					...corsHeaders(origin),
				}),
				body: result.body,
			};
		} catch (err) {
			const error = toError(err);

			// Capture error in Sentry
			Sentry.captureException(error);
			await Sentry.flush();

			// Add error to trace
			const segment = tracer.getSegment();
			if (segment) {
				segment.addError(error);
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
	return getCorsHeaders(origin);
}
