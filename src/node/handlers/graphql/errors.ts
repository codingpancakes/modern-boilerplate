import { GraphQLError } from "graphql";
import { ApiError } from "../../lib/errors";

function apiErrorCode(error: ApiError): string {
	switch (error.code) {
		case "BAD_REQUEST":
		case "VALIDATION_ERROR":
			return "BAD_USER_INPUT";
		case "UNAUTHORIZED":
			return "UNAUTHENTICATED";
		default:
			return error.code;
	}
}

export function toGraphQLError(error: unknown): GraphQLError {
	if (error instanceof GraphQLError) return error;

	if (error instanceof ApiError) {
		return new GraphQLError(error.message, {
			extensions: {
				code: apiErrorCode(error),
				http: { status: error.statusCode },
			},
		});
	}

	if (error instanceof Error) {
		return new GraphQLError(error.message, {
			extensions: { code: "INTERNAL_SERVER_ERROR" },
		});
	}

	return new GraphQLError("Internal server error", {
		extensions: { code: "INTERNAL_SERVER_ERROR" },
	});
}
