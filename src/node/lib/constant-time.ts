import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time equality for secrets (HMAC signatures, shared-secret
 * headers). Unlike crypto.timingSafeEqual, this tolerates length
 * mismatches instead of throwing — a length mismatch returns false.
 *
 * Pass Buffers when the inputs are encoded (e.g. hex-decoded signatures)
 * so both sides are compared in the same representation.
 */
export function constantTimeEqual(
	a: string | Buffer,
	b: string | Buffer,
): boolean {
	const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a);
	const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}
