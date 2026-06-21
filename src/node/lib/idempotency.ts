import { createHash } from "node:crypto";
import { and, eq, inArray, lt, or, type SQL } from "drizzle-orm";
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

const STORAGE_KEY_VERSION = "v2";
const PROCESSING = "processing";
const FAILED = "failed";
const COMPLETED = "completed";

type IdempotencyDb = Awaited<ReturnType<typeof getDb>>;

type CompletedMode = "return" | "returnStoredResponse" | "reclaim";

export type IdempotencyClaimResult =
	| { status: "claimed"; key: string; source: "inserted" | "reclaimed" }
	| { status: "completed"; key: string; response?: StoredResponse }
	| { status: "in_progress"; key: string }
	| { status: "mismatched"; key: string }
	| { status: "ignored"; key: string };

export interface ClaimIdempotencyKeyOptions {
	key: string;
	requestHash: string;
	expiresAt: Date;
	completedMode: CompletedMode;
	ignoreHashMismatch?: boolean;
	ignoreExpired?: boolean;
	reclaimFailed?: boolean;
	reclaimCompleted?: boolean;
	reclaimExpiredProcessing?: boolean;
	staleProcessingMs?: number;
	resetCreatedAtOnReclaim?: boolean;
	insertIfMissing?: boolean;
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
	const storageKey = storageKeyForRequest(request, idempotencyKey);
	const ttl = options.ttlSeconds || 86400; // 24 hours default
	const expiresAt = new Date(Date.now() + ttl * 1000);
	let claimedKey = storageKey;

	// Compatibility for rows written before keys were subject-scoped. Only a
	// same-subject/same-request legacy row is honored; a different request hash
	// is ignored so another caller cannot preclaim a user's key globally.
	const legacyResolution = await claimIdempotencyKey(db, {
		key: idempotencyKey,
		requestHash,
		expiresAt,
		completedMode: "returnStoredResponse",
		ignoreHashMismatch: true,
		ignoreExpired: true,
		reclaimFailed: true,
		reclaimCompleted: true,
		reclaimExpiredProcessing: true,
		insertIfMissing: false,
	});
	if (legacyResolution.status === "completed" && legacyResolution.response) {
		return legacyResolution.response;
	}
	if (legacyResolution.status === "claimed") {
		claimedKey = idempotencyKey;
	}
	if (legacyResolution.status === "in_progress") {
		throw new ApiError(
			409,
			"REQUEST_IN_PROGRESS",
			"Request is still being processed",
		);
	}

	if (claimedKey === storageKey) {
		const resolution = await claimIdempotencyKey(db, {
			key: storageKey,
			requestHash,
			expiresAt,
			completedMode: "returnStoredResponse",
			reclaimFailed: true,
			reclaimCompleted: true,
			reclaimExpiredProcessing: true,
		});
		if (resolution.status === "completed" && resolution.response) {
			return resolution.response;
		}
		if (resolution.status === "mismatched") {
			throw new ApiError(
				422,
				"IDEMPOTENCY_KEY_REUSED",
				"Idempotency key already used for different request",
			);
		}
		if (resolution.status === "in_progress") {
			throw new ApiError(
				409,
				"REQUEST_IN_PROGRESS",
				"Request is still being processed",
			);
		}
		claimedKey = storageKey;
	}

	try {
		// Execute the handler
		const response = await handler();

		// Store successful response
		await completeIdempotencyKey(db, claimedKey, response);

		return response;
	} catch (error) {
		// Mark as failed
		await failIdempotencyKey(db, claimedKey);

		throw error;
	}
}

export async function claimIdempotencyKey(
	db: IdempotencyDb,
	options: ClaimIdempotencyKeyOptions,
): Promise<IdempotencyClaimResult> {
	const {
		key,
		requestHash,
		expiresAt,
		completedMode,
		ignoreHashMismatch = false,
		ignoreExpired = false,
		reclaimFailed = false,
		reclaimCompleted = false,
		reclaimExpiredProcessing = false,
		staleProcessingMs,
		resetCreatedAtOnReclaim = false,
		insertIfMissing = true,
	} = options;
	const now = new Date();
	const nowIso = now.toISOString();

	if (insertIfMissing) {
		const inserted = await db
			.insert(idempotencyKeys)
			.values({
				key,
				requestHash,
				status: PROCESSING,
				createdAt: nowIso,
				expiresAt: expiresAt.toISOString(),
			})
			.onConflictDoNothing({ target: idempotencyKeys.key })
			.returning({ key: idempotencyKeys.key });

		if (inserted.length > 0) {
			return { status: "claimed", key, source: "inserted" };
		}
	}

	const [existing] = await db
		.select()
		.from(idempotencyKeys)
		.where(eq(idempotencyKeys.key, key))
		.limit(1);

	if (!existing) {
		return insertIfMissing
			? { status: "in_progress", key }
			: { status: "ignored", key };
	}

	const expired = !!(
		existing.expiresAt && new Date(existing.expiresAt) < new Date()
	);
	if (expired && ignoreExpired) return { status: "ignored", key };

	if (!expired) {
		if (existing.requestHash !== requestHash) {
			if (ignoreHashMismatch) return { status: "ignored", key };
			return { status: "mismatched", key };
		}

		if (existing.status === COMPLETED) {
			if (completedMode === "return") {
				return { status: "completed", key };
			}
			if (completedMode === "returnStoredResponse") {
				const response = parseStoredResponse(existing.response);
				if (response) return { status: "completed", key, response };
			}
		}
	}

	const reclaimStatuses: string[] = [];
	if (reclaimFailed) reclaimStatuses.push(FAILED);
	if (reclaimCompleted) reclaimStatuses.push(COMPLETED);

	const predicates: SQL[] = [];
	if (reclaimStatuses.length > 0) {
		predicates.push(inArray(idempotencyKeys.status, reclaimStatuses));
	}
	if (expired && reclaimExpiredProcessing) {
		predicates.push(eq(idempotencyKeys.status, PROCESSING));
	}
	if (staleProcessingMs !== undefined) {
		const staleThreshold = new Date(
			now.getTime() - staleProcessingMs,
		).toISOString();
		const stalePredicate = and(
			eq(idempotencyKeys.status, PROCESSING),
			lt(idempotencyKeys.createdAt, staleThreshold),
		);
		if (stalePredicate) predicates.push(stalePredicate);
	}

	const [firstPredicate, ...remainingPredicates] = predicates;
	if (!firstPredicate) return { status: "in_progress", key };
	const reclaimPredicate =
		remainingPredicates.length === 0
			? firstPredicate
			: or(firstPredicate, ...remainingPredicates);
	if (!reclaimPredicate) return { status: "in_progress", key };

	const updateValues = {
		status: PROCESSING,
		requestHash,
		updatedAt: nowIso,
		expiresAt: expiresAt.toISOString(),
		...(resetCreatedAtOnReclaim ? { createdAt: nowIso } : {}),
	};

	const reclaimed = await db
		.update(idempotencyKeys)
		.set(updateValues)
		.where(and(eq(idempotencyKeys.key, key), reclaimPredicate))
		.returning({ key: idempotencyKeys.key });

	return reclaimed.length > 0
		? { status: "claimed", key, source: "reclaimed" }
		: { status: "in_progress", key };
}

export async function completeIdempotencyKey(
	db: IdempotencyDb,
	key: string,
	response?: StoredResponse,
): Promise<void> {
	await db
		.update(idempotencyKeys)
		.set({
			status: COMPLETED,
			...(response ? { response: JSON.stringify(response) } : {}),
			completedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		})
		.where(eq(idempotencyKeys.key, key));
}

export async function failIdempotencyKey(
	db: IdempotencyDb,
	key: string,
): Promise<void> {
	await db
		.update(idempotencyKeys)
		.set({
			status: FAILED,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(idempotencyKeys.key, key));
}

function parseStoredResponse(
	response: string | null,
): StoredResponse | undefined {
	if (!response) return undefined;
	try {
		const parsed: unknown = JSON.parse(response);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"statusCode" in parsed
		) {
			return parsed as StoredResponse;
		}
	} catch {
		// Corrupt JSON — callers configured for reclaim can re-run the handler.
	}
	return undefined;
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

function storageKeyForRequest(
	request: IdempotentRequest,
	idempotencyKey: string,
): string {
	const subject = request.sub || "anonymous";
	const subjectHash = sha256Hex(subject);
	const keyHash = sha256Hex(idempotencyKey);
	return `${STORAGE_KEY_VERSION}:${subjectHash}:${keyHash}`;
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
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
