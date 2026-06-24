import type { DbTransaction } from "../db";
import {
	type IdempotencyOptions,
	type IdempotentRequest,
	type StoredResponse,
	withTransactionalIdempotency,
} from "../idempotency";

function storedJsonResponse<T>(data: T, statusCode = 200): StoredResponse {
	return {
		statusCode,
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			success: true,
			data,
		}),
	};
}

function toResponse(result: StoredResponse): Response {
	const headers = new Headers();
	for (const [key, value] of Object.entries(result.headers ?? {})) {
		headers.set(key, value);
	}
	return new Response(result.body ?? null, {
		status: result.statusCode,
		headers,
	});
}

export async function withTransactionalIdempotentJson<T>(
	request: IdempotentRequest,
	handler: (tx: DbTransaction) => Promise<T>,
	options?: IdempotencyOptions,
): Promise<Response> {
	const result = await withTransactionalIdempotency(
		request,
		async (tx) => storedJsonResponse(await handler(tx)),
		options,
	);
	return toResponse(result);
}
