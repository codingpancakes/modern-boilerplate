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
import {
	GRAPHQL_CLIENT_ERROR_CODES,
	GRAPHQL_SAFE_ERROR_CODES,
} from "../../lib/graphql-error-codes";
import { createLogger } from "../../lib/logger";
import { captureException, flush as flushSentry } from "../../lib/sentry";
import { isDevLikeStage } from "../../lib/stage";
import type { GraphQLContext } from "./context";

/**
 * GraphQL Yoga / envelop plugins. These limits and response semantics are
 * part of the public GraphQL contract:
 *
 *   - depth limit 10            → validation error, HTTP 400, GRAPHQL_VALIDATION_FAILED
 *   - complexity limit 150      → BAD_USER_INPUT, HTTP 500
 *   - max 5 mutations/request   → BAD_USER_INPUT, HTTP 500
 *   - parse failures            → GRAPHQL_PARSE_FAILED, HTTP 400
 *   - error masking             → errors serialize as
 *     `{ message, extensions: { code } }` (no locations/path);
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
 * deployed stages (production/staging) get none of them. The Workers local
 * stage is `"local"` (wrangler.toml `[vars]`), so this accepts only explicit
 * local/development values. Unknown or typoed stages fail closed like deployed
 * stages. Read per call: on Workers `process.env` is
 * populated per invocation, so module-init reads could race the first
 * request.
 */
export function isDevelopmentStage(): boolean {
	return isDevLikeStage();
}

// --- Query complexity (inline — no extra dep) ---
const DEFAULT_LIST_MULTIPLIER = 10;
const MAX_LIST_MULTIPLIER = 100;

/**
 * List-returning fields that DON'T take a `limit`/`first` bound, so the
 * argument-based multiplier below can't see their fan-out. Without this they'd
 * score as cost 1, letting a query nest the member graph
 * (org.members → user.organizations → org.members → …) under the complexity
 * ceiling while fanning out multiplicatively at execution. Treating them as
 * implicit lists makes nested fan-out compound in the score the way it does in
 * the DB. (Scalar lists like `languages` are leaves and don't fan out.)
 */
const IMPLICIT_LIST_FIELDS = new Set(["members", "organizations"]);

function getListMultiplier(
	field: FieldNode,
	variables: Readonly<Record<string, unknown>>,
): number {
	// No explicit limit/first found → known unbounded lists still fan out, so
	// give them the default multiplier; everything else is cost 1.
	const fallback = IMPLICIT_LIST_FIELDS.has(field.name.value)
		? DEFAULT_LIST_MULTIPLIER
		: 1;
	if (!field.arguments || field.arguments.length === 0) {
		return fallback;
	}
	for (const arg of field.arguments) {
		if (arg.name.value === "limit" || arg.name.value === "first") {
			if (arg.value.kind === Kind.INT) {
				return Math.min(
					Math.max(
						1,
						Number.parseInt(arg.value.value, 10) || DEFAULT_LIST_MULTIPLIER,
					),
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
	return fallback;
}

function countSelections(
	selectionSet: SelectionSetNode | undefined,
	fragments: Map<string, FragmentDefinitionNode>,
	activePath: Set<string>,
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
				activePath,
				variables,
			);
			total += 1 + subtree * multiplier;
		} else if (sel.kind === Kind.INLINE_FRAGMENT) {
			total += countSelections(
				sel.selectionSet,
				fragments,
				activePath,
				variables,
			);
		} else if (sel.kind === Kind.FRAGMENT_SPREAD) {
			// Guard only against CYCLES (a fragment spreading itself, directly or
			// transitively) via the active recursion path. A fragment spread N
			// times legitimately must count N times — deduping it globally lets a
			// query alias hundreds of expensive spreads while scoring the cost of
			// one, bypassing the complexity ceiling entirely.
			const name = sel.name.value;
			if (!activePath.has(name)) {
				const frag = fragments.get(name);
				if (frag) {
					activePath.add(name);
					total += countSelections(
						frag.selectionSet,
						fragments,
						activePath,
						variables,
					);
					activePath.delete(name);
				}
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
 * rules. The after-hook gives every validation error the stable
 * GRAPHQL_VALIDATION_FAILED code (unless the rule set one) and HTTP 400.
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
 * Tag syntax errors as GRAPHQL_PARSE_FAILED with HTTP 400.
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
			// Limit failures use the established GraphQL error shape and HTTP 500.
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

/**
 * Count the top-level FIELDS of an operation, resolving fragment spreads and
 * inline fragments (cycle-guarded via the active recursion path). Counting raw
 * selections would let `mutation { ...m }` smuggle any number of mutation
 * fields past the limit as a single spread node.
 */
function countTopLevelFields(
	selectionSet: SelectionSetNode,
	fragments: Map<string, FragmentDefinitionNode>,
	activePath: Set<string>,
): number {
	let count = 0;
	for (const sel of selectionSet.selections) {
		if (sel.kind === Kind.FIELD) {
			count += 1;
		} else if (sel.kind === Kind.INLINE_FRAGMENT) {
			count += countTopLevelFields(sel.selectionSet, fragments, activePath);
		} else if (sel.kind === Kind.FRAGMENT_SPREAD) {
			const name = sel.name.value;
			if (!activePath.has(name)) {
				const frag = fragments.get(name);
				if (frag) {
					activePath.add(name);
					count += countTopLevelFields(
						frag.selectionSet,
						fragments,
						activePath,
					);
					activePath.delete(name);
				}
			}
		}
	}
	return count;
}

export const mutationLimitPlugin: Plugin<GraphQLContext> = {
	onExecute({ args, setResultAndStopExecution }) {
		const operation = getOperationAST(args.document, args.operationName);
		if (operation?.operation === "mutation") {
			const fragments = new Map<string, FragmentDefinitionNode>();
			for (const def of args.document.definitions) {
				if (def.kind === Kind.FRAGMENT_DEFINITION) {
					fragments.set(def.name.value, def);
				}
			}
			const count = countTopLevelFields(
				operation.selectionSet,
				fragments,
				new Set(),
			);
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
					if (GRAPHQL_CLIENT_ERROR_CODES.has(code)) {
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
		isDevelopmentStage() || GRAPHQL_SAFE_ERROR_CODES.has(code)
			? error.message
			: "Internal server error";

	// Preserve the HTTP status the earlier plugins attached (Yoga strips the
	// `http` extension before serializing). Untagged pre-execution failures
	// (e.g. context build errors) default to 500; execution errors ride on the
	// GraphQL-standard HTTP 200 response.
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
 * Stable wire format: every error serializes as
 * `{ message, extensions: { code } }` — no locations or path — and non-safe
 * codes are masked outside dev-like stages. This runs last so it sees resolver,
 * validation, parse, and context-build errors alike.
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
