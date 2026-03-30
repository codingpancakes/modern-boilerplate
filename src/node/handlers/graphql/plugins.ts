import type { ApolloServerPlugin } from "@apollo/server";
import { Logger } from "@aws-lambda-powertools/logger";
import type {
	DocumentNode,
	FieldNode,
	FragmentDefinitionNode,
	SelectionSetNode,
} from "graphql";
import { GraphQLError, Kind } from "graphql";
import { captureException, flush as flushSentry } from "../../lib/sentry";
import type { GraphQLContext } from "./context";

const logger = new Logger({ serviceName: "graphql" });

export const MAX_MUTATIONS_PER_REQUEST = 5;
export const MAX_QUERY_COMPLEXITY = 150;

// --- Query complexity (inline — no extra dep) ---
const DEFAULT_LIST_MULTIPLIER = 10;
const MAX_LIST_MULTIPLIER = 100;

function getListMultiplier(
	field: FieldNode,
	variables: Record<string, unknown>,
): number {
	if (!field.arguments) return 1;
	for (const arg of field.arguments) {
		if (arg.name.value === "limit" || arg.name.value === "first") {
			if (arg.value.kind === Kind.INT) {
				return Math.min(
					Number.parseInt(arg.value.value, 10) || DEFAULT_LIST_MULTIPLIER,
					MAX_LIST_MULTIPLIER,
				);
			}
			if (arg.value.kind === Kind.VARIABLE) {
				const varValue = variables[arg.value.name.value];
				if (typeof varValue === "number" && Number.isFinite(varValue)) {
					return Math.min(
						Math.max(1, Math.floor(varValue)),
						MAX_LIST_MULTIPLIER,
					);
				}
				return DEFAULT_LIST_MULTIPLIER;
			}
			return DEFAULT_LIST_MULTIPLIER;
		}
	}
	return 1;
}

function countSelections(
	selectionSet: SelectionSetNode | undefined,
	fragments: Map<string, FragmentDefinitionNode>,
	seen: Set<string>,
	variables: Record<string, unknown>,
): number {
	if (!selectionSet) return 0;
	let total = 0;
	for (const sel of selectionSet.selections) {
		if (sel.kind === Kind.FIELD) {
			const multiplier = getListMultiplier(sel, variables);
			const subtree = countSelections(
				sel.selectionSet,
				fragments,
				seen,
				variables,
			);
			total += 1 + subtree * multiplier;
		} else if (sel.kind === Kind.INLINE_FRAGMENT) {
			total += countSelections(sel.selectionSet, fragments, seen, variables);
		} else if (sel.kind === Kind.FRAGMENT_SPREAD) {
			const name = sel.name.value;
			if (!seen.has(name)) {
				seen.add(name);
				const frag = fragments.get(name);
				if (frag)
					total += countSelections(
						frag.selectionSet,
						fragments,
						seen,
						variables,
					);
			}
		}
	}
	return total;
}

export function calculateComplexity(
	document: DocumentNode,
	operationName: string | null,
	variables: Record<string, unknown> = {},
): number {
	const fragments = new Map<string, FragmentDefinitionNode>();
	let opSelectionSet: SelectionSetNode | undefined;
	for (const def of document.definitions) {
		if (def.kind === Kind.FRAGMENT_DEFINITION) {
			fragments.set(def.name.value, def);
		} else if (def.kind === Kind.OPERATION_DEFINITION) {
			if (!operationName || def.name?.value === operationName) {
				opSelectionSet = def.selectionSet;
			}
		}
	}
	return countSelections(opSelectionSet, fragments, new Set(), variables);
}

const CLIENT_ERROR_CODES = new Set([
	"GRAPHQL_VALIDATION_FAILED",
	"BAD_USER_INPUT",
	"GRAPHQL_PARSE_FAILED",
	"PERSISTED_QUERY_NOT_FOUND",
	"FORBIDDEN",
	"UNAUTHENTICATED",
]);

export const sentryPlugin: ApolloServerPlugin<GraphQLContext> = {
	async requestDidStart() {
		let hasErrors = false;
		return {
			async didEncounterErrors(requestContext) {
				const { requestId } = requestContext.contextValue;
				for (const error of requestContext.errors) {
					const code =
						typeof error.extensions?.code === "string"
							? error.extensions.code
							: "";
					if (CLIENT_ERROR_CODES.has(code)) {
						continue;
					}
					hasErrors = true;
					const originalError =
						error.originalError instanceof Error ? error.originalError : error;
					captureException(originalError, {
						requestId,
						graphqlPath: error.path,
						graphqlOperationName: requestContext.request.operationName,
					});
				}
			},
			async willSendResponse() {
				if (hasErrors) {
					await flushSentry();
				}
			},
		};
	},
};

export const requestLoggingPlugin: ApolloServerPlugin<GraphQLContext> = {
	async requestDidStart() {
		return {
			async didResolveOperation(requestContext) {
				logger.info("GraphQL operation", {
					requestId: requestContext.contextValue.requestId,
					operationName: requestContext.operationName,
					operationType: requestContext.operation?.operation,
				});
			},
		};
	},
};

export const complexityPlugin: ApolloServerPlugin<GraphQLContext> = {
	async requestDidStart() {
		return {
			async didResolveOperation(requestContext) {
				const complexity = calculateComplexity(
					requestContext.document,
					requestContext.operationName,
					(requestContext.request.variables ?? {}) as Record<string, unknown>,
				);
				if (complexity > MAX_QUERY_COMPLEXITY) {
					throw new GraphQLError(
						`Query complexity ${complexity} exceeds maximum ${MAX_QUERY_COMPLEXITY}`,
						{ extensions: { code: "BAD_USER_INPUT" } },
					);
				}
			},
		};
	},
};

export const mutationLimitPlugin: ApolloServerPlugin<GraphQLContext> = {
	async requestDidStart() {
		return {
			async didResolveOperation(requestContext) {
				const op = requestContext.operation;
				if (op && op.operation === "mutation") {
					const count = op.selectionSet.selections.length;
					if (count > MAX_MUTATIONS_PER_REQUEST) {
						throw new GraphQLError(
							`Too many mutations in one request (max ${MAX_MUTATIONS_PER_REQUEST})`,
							{ extensions: { code: "BAD_USER_INPUT" } },
						);
					}
				}
			},
		};
	},
};
