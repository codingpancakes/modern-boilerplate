export interface PaginationParams {
	cursor?: string;
	limit: number;
}

export interface PaginatedResponse<T> {
	items: T[];
	nextCursor?: string;
	hasMore: boolean;
}

export function encodeCursor(timestamp: number, id: string): string {
	const cursor = `${timestamp}_${id}`;
	return Buffer.from(cursor).toString("base64url");
}

export function decodeCursor(
	cursor: string,
): { timestamp: number; id: string } | null {
	try {
		const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
		const [timestamp, id] = decoded.split("_");
		const ts = Number.parseInt(timestamp, 10);
		if (Number.isNaN(ts) || !id) {
			return null;
		}
		return { timestamp: ts, id };
	} catch {
		return null;
	}
}

export function createPaginatedResponse<
	T extends { id: string; createdAt: string },
>(items: T[], limit: number): PaginatedResponse<T> {
	const hasMore = items.length > limit;
	const paginatedItems = hasMore ? items.slice(0, limit) : items;

	const nextCursor = hasMore
		? encodeCursor(
				new Date(paginatedItems[paginatedItems.length - 1].createdAt).getTime(),
				paginatedItems[paginatedItems.length - 1].id,
			)
		: undefined;

	return {
		items: paginatedItems,
		nextCursor,
		hasMore,
	};
}
