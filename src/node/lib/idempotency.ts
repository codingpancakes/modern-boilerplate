import { createHash } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { idempotencyKeys } from "../db/schema/index";
import { getDb } from "./db";
import { ApiError } from "./errors";

export interface IdempotencyOptions {
	ttlSeconds?: number;
}

/**
 * Runtime-agnostic request descriptor for idempotency.
 *
 * The fields feed {@link hashRequest} with EXACTLY the same inputs (and JSON
 * key order) the old API Gateway event produced — `sub`, `method`, `path`,
 * `body`, `queryParams` — so request hashes stored before the platform move
 * stay valid. Parity rules for callers:
 *  - `body`: the RAW body string, or `undefined` (never `""`) when bodyless
 *  - `query`: the query-param map, or `undefined` when there are none
 */
export interface IdempotentRequest {
	/** The `Idempotency-Key` header value; absent = run the handler directly. */
	key?: string;
	/** Authenticated subject (claims.sub); hashed as "anonymous" when unset. */
	sub?: string;
	method: string;
	path: string;
	body?: string;
	query?: Record<string, string | undefined>;
}

/**
 * The persisted (and replayed) response shape. Stored rows from the Lambda
 * era hold `{ statusCode, headers, body }` JSON — this type IS that contract,
 * so it must not change shape.
 */
export interface StoredResponse {
	statusCode: number;
	headers?: Record<string, string>;
	body?: string;
}

export async function withIdempotency(
	request: IdempotentRequest,
	handler: () => Promise<StoredResponse>,
	options: IdempotencyOptions = {},
): Promise<StoredResponse> {
	const idempotencyKey = request.key;

	// If no idempotency key, just execute the handler
	if (!idempotencyKey) {
		return handler();
	}

	const db = await getDb();
	const requestHash = hashRequest(request);
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
							return parsed as StoredResponse;
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

function hashRequest(request: IdempotentRequest): string {
	// Key order and field values are part of the stored-hash contract — see
	// the IdempotentRequest docblock before changing ANYTHING here.
	const data = {
		sub: request.sub || "anonymous",
		method: request.method,
		path: request.path,
		body: request.body,
		queryParams: request.query,
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
