import { Logger } from "@aws-lambda-powertools/logger";
import type {
	APIGatewayProxyEventV2WithLambdaAuthorizer,
	APIGatewayProxyResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { profiles, users as usersTable } from "../db/schema/index";
import {
	AUDIT_ACTIONS,
	AUDIT_RESOURCE_TYPES,
	AUDIT_STATUS,
	logAudit,
} from "../lib/audit";
import { getUserIdFromClaims } from "../lib/auth";
import { getDb } from "../lib/db";
import { Errors } from "../lib/errors";
import { sendSuccess } from "../lib/hono/respond";
import type { AppEnv, AuthClaims } from "../lib/hono/types";
import { withIdempotency } from "../lib/idempotency";
import { createSuccessResponse } from "../lib/response";
import { sanitizeObject } from "../lib/sanitize";
import { buildNestedUpdates } from "../lib/update-helper";
import { parseBody } from "../lib/validation/helpers";
import * as schemas from "../lib/validation/users";

/**
 * /v1/users/* — user profile routes (protected; `requireAuth()` is applied
 * by the barrel in `routes/index.ts`, so `c.get("claims")` is always set).
 *
 * Ported from the Lambda handlers (which are now thin re-exports of the
 * shared app handler). The @swagger blocks stay in the entry files because
 * `scripts/generate-openapi.js` only globs `src/node/handlers/**`:
 *   GET   /me ← src/node/handlers/users/me.ts      (API GW: GET   /v1/users/me)
 *   PATCH /me ← src/node/handlers/users/update.ts  (API GW: PATCH /v1/users/me)
 */
export const users = new Hono<AppEnv>();

const meLogger = new Logger({ serviceName: "users-me" });
const updateLogger = new Logger({ serviceName: "users-update" });

type UsersLambdaEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthClaims>;

/**
 * Rebuild an API Gateway V2 event (with the authorizer context) from the Hono
 * context, so the event-shaped libraries keep a single source of truth:
 * `getUserIdFromClaims` (claims → internal user id + JIT provisioning),
 * `withIdempotency` (key claim + request hashing), and `parseBody`.
 *
 * On Lambda the original event is available at `c.env.event`, and its values
 * (path, query string, request id, source IP) are preferred verbatim so
 * idempotency request hashes stay identical to the pre-Hono handlers. In
 * local dev there is no event, so equivalent values come from the request.
 */
function toLambdaEvent(
	c: Context<AppEnv>,
	claims: AuthClaims,
	rawBody = "",
): UsersLambdaEvent {
	const lambdaEvent = c.env?.event;
	const real =
		lambdaEvent && "routeKey" in lambdaEvent ? lambdaEvent : undefined;
	const query = c.req.query();
	const routeKey = real?.routeKey ?? `${c.req.method} ${c.req.path}`;

	return {
		version: "2.0",
		routeKey,
		rawPath: real?.rawPath ?? c.req.path,
		rawQueryString: real?.rawQueryString ?? "",
		headers: c.req.header(),
		queryStringParameters: real
			? real.queryStringParameters
			: Object.keys(query).length > 0
				? query
				: undefined,
		// Hash parity: the legacy events carried `undefined` (not "") for
		// bodyless requests, and withIdempotency hashes `event.body`.
		body: rawBody === "" ? undefined : rawBody,
		isBase64Encoded: false,
		requestContext: {
			accountId: real?.requestContext.accountId ?? "",
			apiId: real?.requestContext.apiId ?? "",
			authorizer: { lambda: claims },
			domainName: real?.requestContext.domainName ?? "",
			domainPrefix: real?.requestContext.domainPrefix ?? "",
			http: {
				method: c.req.method,
				path: real?.requestContext.http.path ?? c.req.path,
				protocol: real?.requestContext.http.protocol ?? "HTTP/1.1",
				sourceIp: real?.requestContext.http.sourceIp ?? "",
				userAgent: c.req.header("user-agent") ?? "",
			},
			requestId: real?.requestContext.requestId ?? c.get("requestId"),
			routeKey,
			stage: real?.requestContext.stage ?? "$default",
			time: real?.requestContext.time ?? new Date().toISOString(),
			timeEpoch: real?.requestContext.timeEpoch ?? Date.now(),
		},
	};
}

/**
 * Convert an API Gateway-shaped result into the Response Hono expects.
 * `withIdempotency` both produces (via `createSuccessResponse`) and replays
 * (from the idempotency_keys table) `{ statusCode, headers, body }` objects —
 * the stored shape is part of its replay contract, so it is preserved and
 * adapted here instead of changing what gets persisted. This properly types
 * what the old handler forced with `as unknown as HandlerResponse`.
 * CORS + security headers are applied by the app-level middleware.
 */
function toResponse(result: APIGatewayProxyResultV2): Response {
	if (typeof result === "string") {
		// Lambda treats a bare string as a 200 JSON body; never produced here.
		return new Response(result, {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
	const headers = new Headers();
	for (const [key, value] of Object.entries(result.headers ?? {})) {
		headers.set(key, String(value));
	}
	return new Response(result.body ?? null, {
		status: result.statusCode ?? 200,
		headers,
	});
}

users.get("/me", async (c) => {
	// Get internal user ID from JWT claims
	const userId = await getUserIdFromClaims(toLambdaEvent(c, c.get("claims")));

	// Add persistent context to all logs
	meLogger.appendKeys({ userId });

	meLogger.info("Getting user profile");

	const db = await getDb();

	// Fetch user and profile in parallel (independent queries)
	const [userResult, profileResult] = await Promise.all([
		db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1),
		db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1),
	]);

	if (userResult.length === 0) {
		meLogger.error("User record not found after auth lookup");
		throw Errors.Unauthorized();
	}

	const user = userResult[0];
	const profile = profileResult[0] || null;

	meLogger.info("User profile retrieved successfully", { userId: user.id });

	return sendSuccess(c, {
		user,
		profile,
	});
});

users.patch("/me", async (c) => {
	const event = toLambdaEvent(c, c.get("claims"), await c.req.text());

	const result = await withIdempotency(event, async () => {
		// Get internal user ID from JWT claims
		const userId = await getUserIdFromClaims(event);

		// Add persistent context to all logs
		updateLogger.appendKeys({ userId });

		// Validate request body with Zod
		const updateRequest = parseBody(event, schemas.updateUserProfile);

		updateLogger.info("Updating user profile", {
			fieldsProvided: {
				user: updateRequest.user ? Object.keys(updateRequest.user) : [],
				profile: updateRequest.profile
					? Object.keys(updateRequest.profile)
					: [],
			},
		});

		const db = await getDb();

		// Sanitize all string fields (XSS prevention) then build update objects
		const updates = buildNestedUpdates({
			user: updateRequest.user
				? sanitizeObject(updateRequest.user as Record<string, unknown>)
				: undefined,
			profile: updateRequest.profile
				? sanitizeObject(updateRequest.profile as Record<string, unknown>)
				: undefined,
		});

		const { currentUser, currentProfile, updatedUser, updatedProfile } =
			await db.transaction(async (tx) => {
				const [curUserRows, curProfileRows] = await Promise.all([
					tx
						.select()
						.from(usersTable)
						.where(eq(usersTable.id, userId))
						.limit(1),
					tx
						.select()
						.from(profiles)
						.where(eq(profiles.userId, userId))
						.limit(1),
				]);
				const curUser = curUserRows[0];
				const curProfile = curProfileRows[0];

				const newUser = updates.user
					? await tx
							.update(usersTable)
							.set(updates.user)
							.where(eq(usersTable.id, userId))
							.returning()
							.then((rows) => rows[0])
					: curUser;

				const newProfile = updates.profile
					? await tx
							.update(profiles)
							.set(updates.profile)
							.where(eq(profiles.userId, userId))
							.returning()
							.then((rows) => rows[0])
					: curProfile;

				return {
					currentUser: curUser,
					currentProfile: curProfile,
					updatedUser: newUser,
					updatedProfile: newProfile,
				};
			});

		if (!updatedUser) {
			throw Errors.NotFound("User");
		}

		const updatedUserFields = updates.user ? Object.keys(updates.user) : [];
		const updatedProfileFields = updates.profile
			? Object.keys(updates.profile)
			: [];

		void logAudit({
			userId,
			action: AUDIT_ACTIONS.UPDATE,
			resourceType:
				updatedUserFields.length > 0
					? AUDIT_RESOURCE_TYPES.USER
					: AUDIT_RESOURCE_TYPES.PROFILE,
			resourceId: userId,
			changes: {
				before: { user: currentUser, profile: currentProfile },
				after: { user: updatedUser, profile: updatedProfile },
			},
			ipAddress: event.requestContext.http.sourceIp || undefined,
			userAgent: event.headers["user-agent"],
			requestId: event.requestContext.requestId,
			status: AUDIT_STATUS.SUCCESS,
			metadata: {
				updatedFields: {
					user: updatedUserFields,
					profile: updatedProfileFields,
				},
			},
		});

		return createSuccessResponse({
			user: updatedUser,
			profile: updatedProfile,
		});
	});

	return toResponse(result);
});
