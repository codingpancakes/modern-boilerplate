import type {
	DocumentNode,
	ExecutionResult,
	FieldNode,
	FragmentDefinitionNode,
	SelectionSetNode,
} from "graphql";
import {
	GraphQLError,
	getOperationAST,
	Kind,
	NoSchemaIntrospectionCustomRule,
} from "graphql";
import depthLimit from "graphql-depth-limit";
import { isAsyncIterable, type Plugin } from "graphql-yoga";
import { createLogger } from "../../lib/logger";
import { captureException, flush as flushSentry } from "../../lib/sentry";
import type { GraphQLContext } from "./context";

/**
 * GraphQL Yoga / envelop plugins — the port of the former Apollo Server
 * plugins (same file, same exported limits). Behavior is wire-compatible
 * with the Apollo harness (`handler.ts`, now removed):
 *
 *   - depth limit 10            → validation error, HTTP 400, GRAPHQL_VALIDATION_FAILED
 *   - complexity limit 150      → BAD_USER_INPUT, HTTP 500 (Apollo's
 *     `didResolveOperation` throw path returned 500 — kept byte-compatible)
 *   - max 5 mutations/request   → BAD_USER_INPUT, HTTP 500 (same reason)
 *   - parse failures            → GRAPHQL_PARSE_FAILED, HTTP 400
 *   - error masking             → identical to Apollo `formatError`: errors
 *     serialize as `{ message, extensions: { code } }` (no locations/path);
 *     outside dev, messages for non-safe codes collapse to
 *     "Internal server error"
 *   - Sentry capture            → non-client-code execution errors, flushed
 *     before the response leaves
 */

const logger = createLogger({ serviceName: "graphql" });

export const MAX_MUTATIONS_PER_REQUEST = 5;
export const MAX_QUERY_COMPLEXITY = 150;
export const MAX_QUERY_DEPTH = 10;

/**
 * Dev-like stages get introspection, GraphiQL, and unmasked error messages;
 * deployed stages (production/staging) get none of them. The Apollo handler
 * keyed this on `STAGE === "development"`; the Workers local stage is
 * `"local"` (wrangler.toml `[vars]`), so this checks "not deployed" instead —
 * identical behavior in staging/production, sane behavior under
 * `wrangler dev --local`. Read per call: on Workers `process.env` is
 * populated per invocation, so module-init reads could race the first
 * request.
 */
export function isDevelopmentStage(): boolean {
	const stage = process.env.STAGE ?? "";
	return stage !== "production" && stage !== "staging";
}

// In production, only pass through messages for known client-facing error
// codes (same set the Apollo handler's formatError used).
const SAFE_CODES = new Set([
	"BAD_USER_INPUT",
	"GRAPHQL_VALIDATION_FAILED",
	"GRAPHQL_PARSE_FAILED",
	"FORBIDDEN",
	"UNAUTHENTICATED",
	"NOT_FOUND",
	"CONFLICT",
]);

// --- Query complexity (inline — no extra dep) ---
const DEFAULT_LIST_MULTIPLIER = 10;
const MAX_LIST_MULTIPLIER = 100;

function getListMultiplier(
	field: FieldNode,
	variables: Readonly<Record<string, unknown>>,
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
	variables: Readonly<Record<string, unknown>>,
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
	variables: Readonly<Record<string, unknown>> = {},
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

/** Extract a numeric HTTP status from an error's `extensions.http`, if set. */
function httpStatus(error: GraphQLError): number | undefined {
	const http = error.extensions?.http;
	if (typeof http === "object" && http !== null && "status" in http) {
		const status = (http as { status: unknown }).status;
		if (typeof status === "number") return status;
	}
	return undefined;
}

/**
 * Depth limit + production introspection lockout, applied as validation
 * rules. The after-hook re-tags every validation error exactly like Apollo's
 * `ValidationError` wrapper did: code GRAPHQL_VALIDATION_FAILED (unless the
 * rule set one) and HTTP 400.
 */
export const validationLimitsPlugin: Plugin = {
	onValidate({ addValidationRule }) {
		addValidationRule(depthLimit(MAX_QUERY_DEPTH));
		if (!isDevelopmentStage()) {
			addValidationRule(NoSchemaIntrospectionCustomRule);
		}
		return ({ valid, result, setResult }) => {
			if (valid) return;
			setResult(
				result.map((error: unknown) => {
					const message =
						error instanceof Error ? error.message : String(error);
					const code =
						error instanceof GraphQLError &&
						typeof error.extensions?.code === "string"
							? error.extensions.code
							: "GRAPHQL_VALIDATION_FAILED";
					return new GraphQLError(message, {
						extensions: { code, http: { status: 400 } },
					});
				}),
			);
		};
	},
};

/**
 * Tag syntax errors like Apollo's `SyntaxError` wrapper:
 * GRAPHQL_PARSE_FAILED with HTTP 400.
 */
export const parseErrorPlugin: Plugin = {
	onParse() {
		return ({ result, replaceParseResult }) => {
			if (result instanceof Error) {
				replaceParseResult(
					new GraphQLError(result.message, {
						extensions: { code: "GRAPHQL_PARSE_FAILED", http: { status: 400 } },
					}),
				);
			}
		};
	},
};

export const requestLoggingPlugin: Plugin<GraphQLContext> = {
	onExecute({ args }) {
		const operation = getOperationAST(args.document, args.operationName);
		logger.info("GraphQL operation", {
			requestId: args.contextValue.requestId,
			operationName: args.operationName ?? null,
			operationType: operation?.operation,
		});
	},
};

export const complexityPlugin: Plugin<GraphQLContext> = {
	onExecute({ args, setResultAndStopExecution }) {
		const complexity = calculateComplexity(
			args.document,
			args.operationName ?? null,
			args.variableValues ?? {},
		);
		if (complexity > MAX_QUERY_COMPLEXITY) {
			// Apollo surfaced this as a thrown didResolveOperation error: body
			// { errors: [{ message, extensions: { code } }] } with HTTP 500.
			setResultAndStopExecution({
				errors: [
					new GraphQLError(
						`Query complexity ${complexity} exceeds maximum ${MAX_QUERY_COMPLEXITY}`,
						{ extensions: { code: "BAD_USER_INPUT", http: { status: 500 } } },
					),
				],
			});
		}
	},
};

export const mutationLimitPlugin: Plugin<GraphQLContext> = {
	onExecute({ args, setResultAndStopExecution }) {
		const operation = getOperationAST(args.document, args.operationName);
		if (operation?.operation === "mutation") {
			const count = operation.selectionSet.selections.length;
			if (count > MAX_MUTATIONS_PER_REQUEST) {
				setResultAndStopExecution({
					errors: [
						new GraphQLError(
							`Too many mutations in one request (max ${MAX_MUTATIONS_PER_REQUEST})`,
							{ extensions: { code: "BAD_USER_INPUT", http: { status: 500 } } },
						),
					],
				});
			}
		}
	},
};

export const sentryPlugin: Plugin<GraphQLContext> = {
	onExecute({ args }) {
		const { requestId } = args.contextValue;
		const operationName = args.operationName ?? undefined;
		return {
			async onExecuteDone({ result }) {
				if (isAsyncIterable(result)) return;
				if (!result.errors?.length) return;
				let hasErrors = false;
				for (const error of result.errors) {
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
						graphqlOperationName: operationName,
					});
				}
				if (hasErrors) {
					await flushSentry();
				}
			},
		};
	},
};

function formatResultError(
	error: GraphQLError,
	isPreExecution: boolean,
): GraphQLError {
	logger.error("GraphQL Error", {
		message: error.message,
		code: error.extensions?.code,
	});

	const code =
		typeof error.extensions?.code === "string"
			? error.extensions.code
			: "INTERNAL_SERVER_ERROR";

	const message =
		isDevelopmentStage() || SAFE_CODES.has(code)
			? error.message
			: "Internal server error";

	// Preserve the HTTP status the earlier plugins attached (Yoga strips the
	// `http` extension before serializing). Untagged pre-execution failures
	// (e.g. context build errors) default to 500 — Apollo's
	// `sendErrorResponse` fallback; execution errors ride on the default 200.
	const status = httpStatus(error) ?? (isPreExecution ? 500 : undefined);

	return new GraphQLError(message, {
		extensions: status !== undefined ? { code, http: { status } } : { code },
	});
}

function formatExecutionResult(
	result: ExecutionResult<unknown, unknown>,
): ExecutionResult<unknown, unknown> {
	if (!result.errors?.length) return result;
	const isPreExecution = !("data" in result);
	return {
		...result,
		errors: result.errors.map((error) =>
			formatResultError(error, isPreExecution),
		),
	};
}

/**
 * Apollo `formatError` parity: every error serializes as
 * `{ message, extensions: { code } }` — no locations, no path — and non-safe
 * codes are masked outside dev-like stages. Runs last, on the final result,
 * so it sees resolver errors, validation/parse errors, and context-build
 * errors alike.
 */
export const errorFormattingPlugin: Plugin = {
	onResultProcess({ result, setResult }) {
		if (isAsyncIterable(result)) return;
		setResult(
			Array.isArray(result)
				? result.map(formatExecutionResult)
				: formatExecutionResult(result),
		);
	},
};
