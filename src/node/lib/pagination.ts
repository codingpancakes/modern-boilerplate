export interface PaginationParams {
	cursor?: string;
	limit: number;
}

export interface PaginatedResponse<T> {
	items: T[];
	nextCursor?: string;
	hasMore: boolean;
}

/**
 * Decoded keyset-pagination cursor.
 *
 * `createdAt` is the raw stored timestamp string (Drizzle `mode: "string"`,
 * i.e. Postgres microsecond-precision text) carried losslessly through the
 * cursor. Consumers must compare against it directly — never round-trip it
 * through `Date`, which truncates to milliseconds and can skip or duplicate
 * rows that share a millisecond at page boundaries.
 */
export interface DecodedCursor {
	createdAt: string;
	id: string;
}

/**
 * Cursor format v2: base64url(JSON `{ v: 2, createdAt, id }`).
 *
 * v1 cursors (base64url of `${epochMillis}_${id}`) are still accepted by
 * {@link decodeCursor} for backward compatibility, at their original
 * millisecond precision.
 */
const CURSOR_VERSION = 2;

export function encodeCursor(createdAt: string, id: string): string {
	const cursor = JSON.stringify({ v: CURSOR_VERSION, createdAt, id });
	return Buffer.from(cursor).toString("base64url");
}

function decodeV2Cursor(decoded: string): DecodedCursor | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(decoded);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) {
		return null;
	}
	const { v, createdAt, id } = parsed as Record<string, unknown>;
	if (
		v !== CURSOR_VERSION ||
		typeof createdAt !== "string" ||
		typeof id !== "string" ||
		id.length === 0 ||
		Number.isNaN(Date.parse(createdAt))
	) {
		return null;
	}
	return { createdAt, id };
}

/** Legacy v1 format: `${epochMillis}_${id}`. */
function decodeV1Cursor(decoded: string): DecodedCursor | null {
	const [timestamp, id] = decoded.split("_");
	if (!/^\d+$/.test(timestamp ?? "") || !id) {
		return null;
	}
	const ts = Number.parseInt(timestamp, 10);
	if (Number.isNaN(ts)) {
		return null;
	}
	return { createdAt: new Date(ts).toISOString(), id };
}

export function decodeCursor(cursor: string): DecodedCursor | null {
	try {
		const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
		if (decoded.startsWith("{")) {
			return decodeV2Cursor(decoded);
		}
		return decodeV1Cursor(decoded);
	} catch {
		return null;
	}
}

export function createPaginatedResponse<
	T extends { id: string; createdAt: string },
>(items: T[], limit: number): PaginatedResponse<T> {
	const hasMore = items.length > limit;
	const paginatedItems = hasMore ? items.slice(0, limit) : items;

	const last = paginatedItems[paginatedItems.length - 1];
	// Encode the stored createdAt string verbatim so the next page's keyset
	// comparison happens at full database precision.
	const nextCursor = hasMore
		? encodeCursor(last.createdAt, last.id)
		: undefined;

	return {
		items: paginatedItems,
		nextCursor,
		hasMore,
	};
}
