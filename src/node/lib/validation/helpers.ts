/**
 * Validation Helper Functions
 *
 * Core utilities for validating data with Zod schemas.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
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
 * Parse and validate request body
 * Handles JSON parsing errors and validation errors
 *
 * @param event - API Gateway event
 * @param schema - Zod schema to validate against
 * @returns Validated and typed data
 * @throws BadRequest if body is missing, invalid JSON, or fails validation
 *
 * @example
 * const input = parseBody(event, schemas.users.create);
 * // input is now typed and validated
 */
export function parseBody<T>(
	event: APIGatewayProxyEventV2,
	schema: z.ZodSchema<T>,
): T {
	if (!event.body) {
		throw Errors.BadRequest("Request body is required");
	}

	try {
		const body = JSON.parse(event.body);
		return validate(schema, body);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw Errors.BadRequest("Invalid JSON in request body");
		}
		throw error;
	}
}

/**
 * Parse and validate query parameters
 *
 * @param event - API Gateway event
 * @param schema - Zod schema to validate against
 * @returns Validated and typed query parameters
 *
 * @example
 * const query = parseQuery(event, schemas.common.pagination);
 */
export function parseQuery<T>(
	event: APIGatewayProxyEventV2,
	schema: z.ZodSchema<T>,
): T {
	const queryParams = event.queryStringParameters || {};
	return validate(schema, queryParams);
}

/**
 * Parse and validate path parameters
 *
 * @param event - API Gateway event
 * @param schema - Zod schema to validate against
 * @returns Validated and typed path parameters
 *
 * @example
 * const { id } = parseParams(event, schemas.common.idParam);
 */
export function parseParams<T>(
	event: APIGatewayProxyEventV2,
	schema: z.ZodSchema<T>,
): T {
	const pathParams = event.pathParameters || {};
	return validate(schema, pathParams);
}
