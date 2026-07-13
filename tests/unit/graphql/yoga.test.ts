import { parse } from "graphql";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLContext } from "@/handlers/graphql/context";
import {
	calculateComplexity,
	MAX_QUERY_COMPLEXITY,
} from "@/handlers/graphql/plugins";
import type { AppEnv } from "@/lib/hono/types";

// The route builds its per-request context via createContext, which needs a
// real DB. Mock it: validation-phase tests never reach it, and the
// execution-phase tests inject a context whose db throws on demand.
vi.mock("@/handlers/graphql/context", () => ({
	createContext: vi.fn(),
}));

import { createContext } from "@/handlers/graphql/context";
import { graphql } from "@/routes/graphql";

const createContextMock = vi.mocked(createContext);

let dbError: Error | undefined;

const mockContext = (): GraphQLContext => {
	const db = {
		query: {
			users: {
				findFirst: vi.fn(async () => {
					if (dbError) throw dbError;
					return {
						id: "user-1",
						email: "test@example.com",
						firstName: "Test",
						lastName: "User",
						type: "MEMBER",
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
					};
				}),
			},
		},
	};
	return {
		userId: "user-1",
		organizationId: "org-1",
		role: "MEMBER",
		email: "test@example.com",
		providerSubject: "workos-123",
		claims: {},
		requestId: "test-request-id",
		db: db as unknown as GraphQLContext["db"],
		loaders: {
			userById: { load: vi.fn() },
			profileByUserId: { load: vi.fn() },
			orgById: { load: vi.fn() },
			membershipsByUserId: { load: vi.fn() },
			membershipsByOrgId: { load: vi.fn() },
		} as unknown as GraphQLContext["loaders"],
	};
};

// Mount the sub-app the way the barrel does (auth is the barrel's concern and
// is not under test here).
const app = new Hono<AppEnv>();
app.route("/v1/graphql", graphql);

const post = (query: string) =>
	app.request("/v1/graphql", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ query }),
	});

// 12 nested field levels — over the depth-10 validation limit.
const DEEP_QUERY = `query {
	me { profile { user { profile { user { profile { user { profile { user { profile { user { id } } } } } } } } } } }
}`;

describe("GraphQL Yoga route", () => {
	beforeEach(() => {
		dbError = undefined;
		createContextMock.mockImplementation(async () => mockContext());
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it("rejects queries deeper than 10 with a 400 validation error", async () => {
		vi.stubEnv("STAGE", "production");

		const res = await post(DEEP_QUERY);
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.errors).toHaveLength(1);
		expect(body.errors[0].message).toContain(
			"exceeds maximum operation depth of 10",
		);
		expect(body.errors[0].extensions).toEqual({
			code: "GRAPHQL_VALIDATION_FAILED",
		});
		// Apollo's formatError dropped locations/path — the shape must not grow.
		expect(body.errors[0]).not.toHaveProperty("locations");
		expect(body.errors[0]).not.toHaveProperty("path");
		// Validation fails before context creation — no DB touched.
		expect(createContextMock).not.toHaveBeenCalled();
	});

	it("masks internal errors in production", async () => {
		vi.stubEnv("STAGE", "production");
		dbError = new Error("connect ECONNREFUSED neon-internal-host:5432");

		const res = await post("query { me { id } }");
		// Execution errors ride on HTTP 200, exactly like Apollo.
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.errors).toHaveLength(1);
		expect(body.errors[0].message).toBe("Internal server error");
		expect(body.errors[0].extensions).toEqual({
			code: "INTERNAL_SERVER_ERROR",
		});
		expect(JSON.stringify(body)).not.toContain("neon-internal-host");
		expect(body.data).toBeNull();
	});

	it("passes internal error messages through outside deployed stages", async () => {
		vi.stubEnv("STAGE", "local");
		dbError = new Error("boom from the resolver");

		const res = await post("query { me { id } }");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.errors[0].message).toBe("boom from the resolver");
		expect(body.errors[0].extensions).toEqual({
			code: "INTERNAL_SERVER_ERROR",
		});
	});

	it("keeps safe error codes unmasked in production", async () => {
		vi.stubEnv("STAGE", "production");
		// users.findFirst resolves nothing → resolver throws NOT_FOUND.
		createContextMock.mockImplementation(async () => {
			const context = mockContext();
			(
				context.db.query.users.findFirst as unknown as ReturnType<typeof vi.fn>
			).mockResolvedValue(undefined);
			return context;
		});

		const res = await post("query { me { id } }");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.errors[0].message).toBe("User not found");
		expect(body.errors[0].extensions).toEqual({ code: "NOT_FOUND" });
	});

	it("rejects queries over the complexity limit (Apollo-parity 500 + BAD_USER_INPUT)", async () => {
		vi.stubEnv("STAGE", "production");

		const res = await post(
			"query { images(limit: 100) { images { key url size lastModified category } } }",
		);
		expect(res.status).toBe(500);

		const body = await res.json();
		expect(body.errors[0].message).toMatch(/exceeds maximum 150/);
		expect(body.errors[0].extensions).toEqual({ code: "BAD_USER_INPUT" });
	});

	it("counts a fragment's cost once per SPREAD, not once per query (complexity bypass guard)", () => {
		// A fragment spread N times must cost N× — global dedup would let a query
		// alias many expensive spreads while scoring only one.
		const once = parse(`
			query { a: me { ...UserFields } }
			fragment UserFields on User { id email firstName lastName }
		`);
		const thrice = parse(`
			query {
				a: me { ...UserFields }
				b: me { ...UserFields }
				c: me { ...UserFields }
			}
			fragment UserFields on User { id email firstName lastName }
		`);

		expect(calculateComplexity(thrice, null)).toBe(
			3 * calculateComplexity(once, null),
		);
	});

	it("counts unbounded list fields (members/organizations) as fan-out, not cost 1", () => {
		// A shallow, legitimate query stays well under the ceiling...
		const shallow = parse(
			"query { organization(id: \"x\") { members { role } } }",
		);
		expect(calculateComplexity(shallow, null)).toBeLessThan(
			MAX_QUERY_COMPLEXITY,
		);

		// ...but nesting the member graph (members → user → organizations →
		// organization → members) compounds ×10 per unbounded list and must
		// exceed the ceiling, so it can't fan out under a cost-1 score.
		const nested = parse(`
			query {
				organization(id: "x") {
					members {
						user {
							organizations {
								organization {
									members { role }
								}
							}
						}
					}
				}
			}
		`);
		expect(calculateComplexity(nested, null)).toBeGreaterThan(
			MAX_QUERY_COMPLEXITY,
		);
	});

	it("terminates on cyclic fragment spreads instead of recursing forever", () => {
		// Invalid per the GraphQL spec (NoFragmentCycles), but the counter runs
		// pre-validation in onExecute paths and must not stack-overflow.
		const cyclic = parse(`
			query { me { ...A } }
			fragment A on User { id ...B }
			fragment B on User { email ...A }
		`);

		expect(() => calculateComplexity(cyclic, null)).not.toThrow();
		expect(calculateComplexity(cyclic, null)).toBeGreaterThan(0);
	});

	it("clamps non-positive INT literal list multipliers to one", () => {
		const negative = parse(
			"query { images(limit: -1) { images { key url size } } }",
		);
		const one = parse("query { images(limit: 1) { images { key url size } } }");

		expect(calculateComplexity(negative, null)).toBe(
			calculateComplexity(one, null),
		);
	});

	it("rejects more than 5 mutations per request", async () => {
		vi.stubEnv("STAGE", "production");

		const fields = Array.from(
			{ length: 6 },
			(_, i) => `m${i}: updateMe(input: { firstName: "x" }) { id }`,
		).join("\n");
		const res = await post(`mutation { ${fields} }`);
		expect(res.status).toBe(500);

		const body = await res.json();
		expect(body.errors[0].message).toBe(
			"Too many mutations in one request (max 5)",
		);
		expect(body.errors[0].extensions).toEqual({ code: "BAD_USER_INPUT" });
	});

	it("counts mutations smuggled through a fragment spread (limit bypass guard)", async () => {
		vi.stubEnv("STAGE", "production");

		// One spread node hiding 6 mutation fields must still trip the limit.
		const fields = Array.from(
			{ length: 6 },
			(_, i) => `m${i}: updateMe(input: { firstName: "x" }) { id }`,
		).join("\n");
		const res = await post(
			`mutation { ...m }\nfragment m on Mutation { ${fields} }`,
		);
		expect(res.status).toBe(500);

		const body = await res.json();
		expect(body.errors[0].message).toBe(
			"Too many mutations in one request (max 5)",
		);
	});

	it("disables introspection in production but serves it in dev-like stages", async () => {
		vi.stubEnv("STAGE", "production");
		const blocked = await post("query { __schema { queryType { name } } }");
		expect(blocked.status).toBe(400);
		const blockedBody = await blocked.json();
		expect(blockedBody.errors[0].extensions).toEqual({
			code: "GRAPHQL_VALIDATION_FAILED",
		});

		vi.stubEnv("STAGE", "local");
		const allowed = await post("query { __schema { queryType { name } } }");
		expect(allowed.status).toBe(200);
		const allowedBody = await allowed.json();
		expect(allowedBody.data.__schema.queryType.name).toBe("Query");
	});

	it("treats typoed stages as deployed for introspection", async () => {
		vi.stubEnv("STAGE", "prodution");

		const res = await post("query { __schema { queryType { name } } }");
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.errors[0].extensions).toEqual({
			code: "GRAPHQL_VALIDATION_FAILED",
		});
	});

	it("serves GraphiQL on GET only outside production/staging", async () => {
		const getHtml = () =>
			app.request("/v1/graphql", {
				method: "GET",
				headers: { accept: "text/html" },
			});

		vi.stubEnv("STAGE", "local");
		const dev = await getHtml();
		expect(dev.status).toBe(200);
		expect(dev.headers.get("content-type")).toContain("text/html");

		for (const stage of ["production", "staging"]) {
			vi.stubEnv("STAGE", stage);
			const deployed = await getHtml();
			expect(deployed.headers.get("content-type") ?? "").not.toContain(
				"text/html",
			);
		}
	});
});
