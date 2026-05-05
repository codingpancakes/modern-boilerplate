import { timingSafeEqual } from "node:crypto";

const IS_LOCAL =
	process.env.NODE_ENV === "development" || process.env.STAGE === "development";

const ORIGIN_SECRET = process.env.ORIGIN_VERIFY_SECRET || "";

/**
 * Verify that the request arrived through CloudFront by checking
 * a shared secret header. CloudFront adds `X-Origin-Verify: <secret>`
 * to every origin request; direct hits to the execute-api URL won't
 * have it, so they get rejected.
 *
 * Skipped when:
 *  - Running locally (no CloudFront in the loop)
 *  - ORIGIN_VERIFY_SECRET is not configured (gradual rollout)
 */
export function verifyOriginHeader(
	headers: Record<string, string | undefined>,
): boolean {
	if (IS_LOCAL) return true;
	if (!ORIGIN_SECRET) return true;

	const value = headers["x-origin-verify"] || headers["X-Origin-Verify"] || "";
	if (!value) return false;

	const a = Buffer.from(value);
	const b = Buffer.from(ORIGIN_SECRET);
	if (a.length !== b.length) return false;

	return timingSafeEqual(a, b);
}
