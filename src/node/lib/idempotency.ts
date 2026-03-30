import { createHash } from "node:crypto";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyResultV2,
} from "aws-lambda";
import { and, eq, inArray, lt } from "drizzle-orm";
import { idempotencyKeys } from "../db/schema/index";
import { getDb } from "./db";
import { ApiError } from "./errors";

export interface IdempotencyOptions {
	ttlSeconds?: number;
}

export async function withIdempotency(
	event: APIGatewayProxyEventV2,
	handler: () => Promise<APIGatewayProxyResultV2>,
	options: IdempotencyOptions = {},
): Promise<APIGatewayProxyResultV2> {
	const idempotencyKey =
		event.headers["idempotency-key"] || event.headers["Idempotency-Key"];

	// If no idempotency key, just execute the handler
	if (!idempotencyKey) {
		return handler();
	}

	const db = await getDb();
	const requestHash = hashRequest(event);
	const ttl = options.ttlSeconds || 86400; // 24 hours default
	const expiresAt = new Date(Date.now() + ttl * 1000);

	// Atomic upsert: INSERT the key as "processing" or DO NOTHING if it already exists.
	// This eliminates the race condition where two concurrent requests both pass a
	// SELECT-then-INSERT check before either inserts.
	const insertResult = await db
		.insert(idempotencyKeys)
		.values({
			key: idempotencyKey,
			requestHash,
			status: "processing",
			createdAt: new Date().toISOString(),
			expiresAt: expiresAt.toISOString(),
		})
		.onConflictDoNothing({ target: idempotencyKeys.key });

	// If insert succeeded (rowCount > 0), we own the key — proceed to execute.
	// If insert was a no-op (rowCount === 0), the key already existed — check its state.
	if ((insertResult.rowCount ?? 0) === 0) {
		const [existing] = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.key, idempotencyKey))
			.limit(1);

		let expired = false;
		if (existing) {
			expired = !!(
				existing.expiresAt && new Date(existing.expiresAt) < new Date()
			);

			if (!expired) {
				if (existing.requestHash !== requestHash) {
					throw new ApiError(
						422,
						"IDEMPOTENCY_KEY_REUSED",
						"Idempotency key already used for different request",
					);
				}

				if (existing.status === "processing") {
					throw new ApiError(
						409,
						"REQUEST_IN_PROGRESS",
						"Request is still being processed",
					);
				}

				if (existing.status === "completed" && existing.response) {
					try {
						const parsed: unknown = JSON.parse(existing.response);
						if (
							typeof parsed === "object" &&
							parsed !== null &&
							"statusCode" in parsed
						) {
							return parsed as APIGatewayProxyResultV2;
						}
					} catch {
						// Corrupt JSON — fall through to reclaim
					}
				}
			}
		}

		// Expired rows can be reclaimed regardless of status (including stuck "processing")
		const reclaimStatuses = expired
			? ["failed", "completed", "processing"]
			: ["failed", "completed"];

		const reclaimed = await db
			.update(idempotencyKeys)
			.set({
				status: "processing",
				requestHash,
				updatedAt: new Date().toISOString(),
				expiresAt: expiresAt.toISOString(),
			})
			.where(
				and(
					eq(idempotencyKeys.key, idempotencyKey),
					inArray(idempotencyKeys.status, reclaimStatuses),
				),
			);

		if ((reclaimed.rowCount ?? 0) === 0) {
			throw new ApiError(
				409,
				"REQUEST_IN_PROGRESS",
				"Request is still being processed",
			);
		}
	}

	try {
		// Execute the handler
		const response = await handler();

		// Store successful response
		await db
			.update(idempotencyKeys)
			.set({
				status: "completed",
				response: JSON.stringify(response),
				completedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(idempotencyKeys.key, idempotencyKey));

		return response;
	} catch (error) {
		// Mark as failed
		await db
			.update(idempotencyKeys)
			.set({
				status: "failed",
				updatedAt: new Date().toISOString(),
			})
			.where(eq(idempotencyKeys.key, idempotencyKey));

		throw error;
	}
}

function hashRequest(event: APIGatewayProxyEventV2): string {
	const authorizer = event.requestContext as {
		authorizer?: { lambda?: { sub?: string } };
	} & typeof event.requestContext;

	const data = {
		sub: authorizer.authorizer?.lambda?.sub || "anonymous",
		method: event.requestContext.http.method,
		path: event.requestContext.http.path,
		body: event.body,
		queryParams: event.queryStringParameters,
	};

	return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

// Janitor function to clean up expired keys
export async function cleanupExpiredKeys(): Promise<number> {
	const db = await getDb();
	const now = new Date().toISOString();

	const result = await db
		.delete(idempotencyKeys)
		.where(lt(idempotencyKeys.expiresAt, now));

	return result.rowCount || 0;
}
