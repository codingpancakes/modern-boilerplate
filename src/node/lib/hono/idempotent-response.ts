import {
	type IdempotencyOptions,
	type IdempotentRequest,
	type StoredResponse,
	withIdempotency,
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

export async function withIdempotentJson<T>(
	request: IdempotentRequest,
	handler: () => Promise<T>,
	options?: IdempotencyOptions,
): Promise<Response> {
	const result = await withIdempotency(
		request,
		async () => storedJsonResponse(await handler()),
		options,
	);
	return toResponse(result);
}
