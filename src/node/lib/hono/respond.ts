import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Success-response helpers.
 *
 * Same wire shape everywhere: `{ success: true, data }`. Errors are NOT built
 * here; throw via the `Errors` factory (`lib/errors.ts`) and let the app-level
 * `onError` in `src/node/app.ts` format them.
 */

export function sendSuccess<T>(
	c: Context,
	data: T,
	status: ContentfulStatusCode = 200,
): Response {
	return c.json({ success: true, data }, status);
}

export function sendNoContent(c: Context): Response {
	return c.body(null, 204);
}
