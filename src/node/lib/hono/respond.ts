import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Success-response helpers — the Hono equivalent of `lib/response.ts`.
 * Same wire shape: `{ success: true, data }`. Errors are NOT built here;
 * throw via the `Errors` factory (`lib/errors.ts`) and let the app-level
 * `onError` in `src/node/app.ts` format them.
 */

/** Hono port of `createSuccessResponse`. */
export function sendSuccess<T>(
	c: Context,
	data: T,
	status: ContentfulStatusCode = 200,
): Response {
	return c.json({ success: true, data }, status);
}

/** Hono port of `createNoContentResponse`. */
export function sendNoContent(c: Context): Response {
	return c.body(null, 204);
}
