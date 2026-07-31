/**
 * Validation Helper Functions
 *
 * Core utilities for validating data with Zod schemas.
 */

import { z } from "zod";
import { Errors } from "../errors";

function objectDepth(val: unknown, current = 0): number {
	if (current > 10) return current;
	if (val && typeof val === "object" && !Array.isArray(val)) {
		let max = current;
		for (const v of Object.values(val as Record<string, unknown>)) {
			max = Math.max(max, objectDepth(v, current + 1));
			if (max > 10) return max;
		}
		return max;
	}
	if (Array.isArray(val)) {
		let max = current;
		for (const item of val) {
			max = Math.max(max, objectDepth(item, current + 1));
			if (max > 10) return max;
		}
		return max;
	}
	return current;
}

/**
 * Reusable Zod schema for JSON object fields with a 10 KB size cap.
 * Shared by user, profile, and organization validation schemas.
 */
export const jsonObject = z
	.record(z.unknown())
	.refine((obj) => objectDepth(obj) <= 10, "Object too deeply nested (max 10)")
	.refine(
		(obj) => JSON.stringify(obj).length <= 10_000,
		"Object too large (max 10KB serialized)",
	);

/**
 * Validate data against a Zod schema
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated and typed data
 * @throws ValidationError if validation fails
 *
 * @example
 * const user = validate(userSchema, rawData);
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
	const result = schema.safeParse(data);
	if (!result.success) {
		throw Errors.ValidationError(result.error.format());
	}
	return result.data;
}

/**
 * Parse a raw JSON request body without applying domain validation.
 *
 * Route handlers use this when the transport concern is "is this JSON?",
 * while a shared service owns the actual domain schema.
 */
export function parseJsonBody(body: string | null | undefined): unknown {
	if (!body) {
		throw Errors.BadRequest("Request body is required");
	}

	try {
		return JSON.parse(body) as unknown;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw Errors.BadRequest("Invalid JSON in request body");
		}
		throw error;
	}
}

/**
 * Parse a raw request body string AND validate it against a Zod schema in one
 * step — the convenience the route templates teach. Combines {@link parseJsonBody}
 * (JSON transport) with {@link validate} (domain schema).
 *
 * @throws BadRequest if the body is missing/invalid JSON; ValidationError on schema failure
 */
export function parseBody<T>(
	body: string | null | undefined,
	schema: z.ZodSchema<T>,
): T {
	return validate(schema, parseJsonBody(body));
}
