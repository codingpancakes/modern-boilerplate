import type { MiddlewareHandler } from "hono";
import { Errors } from "../errors";
import type { AppEnv } from "./types";

/**
 * Per-IP rate limiting via the Cloudflare Workers Rate Limiting binding
 * (`RATE_LIMITER`, configured in wrangler.toml — no dashboard resource). This
 * is an app-level limiter that complements Cloudflare's platform DDoS and any
 * zone-level rate-limiting rules; it bounds cost on the unauthenticated
 * surfaces (the webhook endpoint's HMAC compute, the auth/JWKS path).
 *
 * Keyed by CF-Connecting-IP. Per-colo (not globally aggregated), which is the
 * binding's documented behavior — fine as a first line; zone rules cover the
 * global view. Gracefully skips when the binding is absent (e.g. `wrangler dev`
 * without it), so local dev and tests are unaffected.
 */
export const rateLimit = (): MiddlewareHandler<AppEnv> => async (c, next) => {
	const limiter = c.env?.RATE_LIMITER;
	if (limiter) {
		const key = c.req.header("cf-connecting-ip") ?? "unknown";
		const { success } = await limiter.limit({ key });
		if (!success) throw Errors.RateLimited();
	}
	return next();
};
