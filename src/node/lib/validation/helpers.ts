/**
 * Validation Helper Functions
 *
 * Core utilities for validating data with Zod schemas.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { z } from "zod";
import { Errors } from "../errors";

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
