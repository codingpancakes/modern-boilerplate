import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

/**
 * Request-level integration tests for the Hono HTTP routes.
 *
 * Drives the REAL exported `app` via `app.fetch(new Request(...), env, ctx)` —
 * the same entrypoint the Worker/Node server uses — so middleware order, the
 * onError/notFound wire shape, CORS + security headers, per-domain auth, Zod
 * validation, and the route handlers are all exercised together. The
 * lib/resolver layer is unit-tested elsewhere; this file covers the wire.
 *
 * Two seams are faked, both as narrow as possible:
 *
 *   1. `@/lib/db` — `getDb` is routed to the node-postgres harness (same
 *      pattern as webhook-processor.test.ts) because the production
 *      neon-serverless driver can't talk to a bare local Postgres. Everything
 *      else on the module (notably `runWithDbScope`, used by the app's
 *      `dbScope()` middleware and the webhook inline path) is kept REAL via
 *      `importActual`, so the request lifecycle is unchanged. With `getDb`
 *      overridden, the scoped pool branch inside the real `runWithDbScope`
 *      never creates a Neon pool, so it degrades to a transparent wrapper.
 *
 *   2. `@/authorizers/verify-token` — `verifyWorkosToken` is stubbed to return
 *      fixed claims, so authed routes can be driven without a real WorkOS JWT.
 *      This is the SMALLEST auth seam: `requireAuth()` (header parsing, the
 *      "Bearer " prefix check, the 401-on-missing-token path, the access-denied
 *      audit write, and `toAuthorizerContext` claim shaping) all stay real — we
 *      only replace the cryptographic verify step. Mocking `requireAuth`
 *      itself would skip all of that route-adjacent logic.
 */

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/db", async () => {
	const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
	return { ...actual, getDb: getDbMock };
});

// verifyWorkosToken is the single crypto step requireAuth() delegates to.
// Returning fixed claims here keeps every other line of requireAuth real.
const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/authorizers/verify-token", async () => {
	const actual = await vi.importActual<
		typeof import("@/authorizers/verify-token")
	>("@/authorizers/verify-token");
	return { ...actual, verifyWorkosToken: verifyTokenMock };
});

import { app } from "@/app";
import { authIdentities, profiles, users } from "@/db/schema/index";
import {
	createTestDb,
	type TestDb,
	truncateAuditLogs,
	truncateIdempotencyKeys,
	truncateOrganizations,
	truncateUserGraph,
} from "./helpers/test-db";

let db: TestDb;
let pool: Pool;

// The verified subject we inject for authed requests; matches the seeded
// auth_identities.provider_subject so getUserIdFromClaims resolves it without
// JIT-provisioning a second user.
const SEEDED_SUBJECT = "user_workos_http_routes";

// A built-in dev origin from cors.ts DEV_ORIGINS. Allowed whenever NODE_ENV is
// not production/staging (vitest runs as "test"), so the CORS assertions stay
// independent from project-specific CORS env vars.
const ALLOWED_ORIGIN = "http://localhost:3000";

// A no-op ExecutionContext — the app's middleware never touches waitUntil in
// these flows, but app.fetch's third arg is typed, so pass a minimal stub.
const ctx = {
	waitUntil: () => {},
	passThroughOnException: () => {},
	// biome-ignore lint/suspicious/noExplicitAny: minimal ExecutionContext stub for app.fetch
} as any;

// Minimal env: no R2 binding (so media falls through to the S3-API path) and
// no WEBHOOK_QUEUE binding (so webhooks process inline). Bindings the app reads
// off process.env are set in beforeAll, not here.
const env = {} as Parameters<typeof app.fetch>[1];

function fetchApp(
	path: string,
	init?: RequestInit,
	bindings: Parameters<typeof app.fetch>[1] = env,
): Promise<Response> {
	return Promise.resolve(
		app.fetch(new Request(`http://localhost${path}`, init), bindings, ctx),
	);
}

beforeAll(async () => {
	({ db, pool } = await createTestDb());
	getDbMock.mockResolvedValue(db);
	verifyTokenMock.mockResolvedValue({
		sub: SEEDED_SUBJECT,
		iss: "https://api.workos.com/",
		email: "ada@example.com",
	});

	// Routes/middleware read these off process.env (mirrored from Worker vars by
	// nodejs_compat in prod). Set explicit values so assertions are deterministic
	// and not dependent on the developer's shell env.
	process.env.STAGE = "dev";
	process.env.API_VERSION = "v1";
	// Ensure media is NOT configured for the 503 assertion. Must DELETE, not set
	// to undefined: `process.env.X = undefined` stores the truthy string
	// "undefined", which would make getMediaConfig() pass and the route 500.
	for (const key of [
		"IMAGES_BUCKET",
		"IMAGES_CDN_URL",
		"R2_ACCOUNT_ID",
		"R2_ACCESS_KEY_ID",
		"R2_SECRET_ACCESS_KEY",
		"R2_BUCKET",
	]) {
		delete process.env[key];
	}
}, 60_000);

afterAll(async () => {
	await pool?.end();
});

beforeEach(async () => {
	await truncateUserGraph(pool);
	await truncateOrganizations(pool);
	await truncateIdempotencyKeys(pool);
	await truncateAuditLogs(pool);
});

afterEach(() => {
	// Re-pin the mock return values (clearAllMocks wipes implementations).
	getDbMock.mockResolvedValue(db);
	verifyTokenMock.mockResolvedValue({
		sub: SEEDED_SUBJECT,
		iss: "https://api.workos.com/",
		email: "ada@example.com",
	});
	for (const key of ["IMAGES_BUCKET", "IMAGES_CDN_URL"]) {
		delete process.env[key];
	}
});

/** Seed a user + auth identity so authed routes resolve SEEDED_SUBJECT. */
async function seedUser(): Promise<string> {
	const [user] = await db
		.insert(users)
		.values({
			email: "ada@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			type: "MEMBER",
		})
		.returning();
	if (!user) throw new Error("failed to seed user");

	await db.insert(profiles).values({ userId: user.id });
	await db.insert(authIdentities).values({
		userId: user.id,
		providerType: "workos",
		providerSubject: SEEDED_SUBJECT,
	});
	return user.id;
}

describe("HTTP routes — public / unauthenticated", () => {
	it("GET /v1/health → 200 { success:true, data:{ status:'ok', ... } }", async () => {
		const res = await fetchApp("/v1/health");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.status).toBe("ok");
		expect(body.data.version).toBe("v1");
		expect(typeof body.data.timestamp).toBe("string");
	});

	it("GET /v1/health/detailed → 200 healthy and does NOT leak per-component checks", async () => {
		const res = await fetchApp("/v1/health/detailed");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.status).toBe("healthy");
		expect(body.data.version).toBe("v1");
		expect(typeof body.data.timestamp).toBe("string");
		// Security: the public response must expose ONLY {status,timestamp,version}.
		// Per-component diagnostics (db/workos/storage) stay in server logs.
		expect(body.data).not.toHaveProperty("checks");
		expect(Object.keys(body.data).sort()).toEqual([
			"status",
			"timestamp",
			"version",
		]);
	});

	it("GET /v1/health/detailed degrades when configured R2 is unreachable", async () => {
		process.env.IMAGES_BUCKET = "images-test";
		process.env.IMAGES_CDN_URL = "https://cdn.example.test";

		const res = await fetchApp(
			"/v1/health/detailed",
			undefined,
			{
				IMAGES: {
					list: vi.fn().mockRejectedValue(new Error("r2 unavailable")),
				},
			} as unknown as Parameters<typeof app.fetch>[1],
		);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.status).toBe("degraded");
		expect(body.data).not.toHaveProperty("checks");
	});

	it("unknown path → 404 with the formatError wire shape", async () => {
		const res = await fetchApp("/v1/does-not-exist");
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toContain("application/json");

		const body = await res.json();
		expect(body.success).toBe(false);
		expect(typeof body.error).toBe("string");
		expect(body.details.code).toBe("NOT_FOUND");
		expect(typeof body.details.requestId).toBe("string");
		expect(typeof body.details.timestamp).toBe("string");
	});

	it("OPTIONS preflight with allowed Origin → 204 + Access-Control-Allow-* headers", async () => {
		const res = await fetchApp("/v1/users/me", {
			method: "OPTIONS",
			headers: {
				// A built-in dev origin (cors.ts DEV_ORIGINS) — allowed whenever
				// NODE_ENV is not production/staging.
				Origin: ALLOWED_ORIGIN,
				"Access-Control-Request-Method": "GET",
			},
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
		expect(res.headers.get("Vary")).toBe("Origin");
	});

	it("normal response carries security headers and does NOT clobber Content-Type", async () => {
		const res = await fetchApp("/v1/health", {
			headers: { Origin: ALLOWED_ORIGIN },
		});
		expect(res.status).toBe(200);
		// Security headers from securityHeaders() are applied to every response.
		expect(res.headers.get("Strict-Transport-Security")).toContain(
			"max-age=31536000",
		);
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
		// CORS middleware must NOT force application/json onto the response — the
		// handler's own JSON content type wins.
		expect(res.headers.get("Content-Type")).toContain("application/json");
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
	});

	it("GET /v1/users/me with NO Authorization → 401 legacy body", async () => {
		const res = await fetchApp("/v1/users/me");
		expect(res.status).toBe(401);

		const body = await res.json();
		// Byte-compatible with the legacy withAuth 401 body (error: "Unauthorized",
		// NOT "Authentication required").
		expect(body.success).toBe(false);
		expect(body.error).toBe("Unauthorized");
		expect(body.details.code).toBe("UNAUTHORIZED");
		expect(typeof body.details.requestId).toBe("string");
		expect(typeof body.details.timestamp).toBe("string");
	});

	it("POST /v1/webhooks/workos with no signature → 401 (no bearer required)", async () => {
		const res = await fetchApp("/v1/webhooks/workos", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id: "evt_x", event: "user.created", data: {} }),
		});
		// Signature-verified, NOT bearer-verified: missing signature is 401 here
		// without ever consulting requireAuth.
		expect(res.status).toBe(401);

		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.details.code).toBe("UNAUTHORIZED");
	});
});

describe("HTTP routes — authenticated", () => {
	const authHeaders = { Authorization: "Bearer fake-but-mock-accepts-it" };

	it("GET /v1/users/me (authed) → 200 returning the seeded user", async () => {
		await seedUser();

		const res = await fetchApp("/v1/users/me", { headers: authHeaders });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.user.email).toBe("ada@example.com");
		expect(body.data.user.firstName).toBe("Ada");
		expect(body.data.profile).not.toBeNull();
	});

	it("PATCH /v1/users/me with a valid nested body → 200", async () => {
		const userId = await seedUser();

		const res = await fetchApp("/v1/users/me", {
			method: "PATCH",
			headers: { ...authHeaders, "Content-Type": "application/json" },
			body: JSON.stringify({ profile: { preferredName: "Ace" } }),
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.success).toBe(true);

		// Confirm the update actually landed in Postgres.
		const [row] = await db
			.select()
			.from(profiles)
			.where(eq(profiles.userId, userId));
		expect(row?.preferredName).toBe("Ace");
	});

	it("PATCH /v1/users/me with a malformed FLAT body → 400 VALIDATION_ERROR", async () => {
		await seedUser();

		// Flat shape: preferredName belongs under profile, not at the root. The
		// schema's refine (user || profile) rejects this, proving Zod runs at the
		// route boundary.
		const res = await fetchApp("/v1/users/me", {
			method: "PATCH",
			headers: { ...authHeaders, "Content-Type": "application/json" },
			body: JSON.stringify({ preferredName: "Ace" }),
		});
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.details.code).toBe("VALIDATION_ERROR");
	});

	it("media route with R2 unconfigured → 503 MEDIA_STORAGE_NOT_CONFIGURED", async () => {
		await seedUser();

		// upload-image-direct calls getMediaConfig() first, which throws the 503
		// config error when IMAGES_BUCKET / IMAGES_CDN_URL are unset.
		const res = await fetchApp("/v1/media/upload-image-direct", {
			method: "POST",
			headers: { ...authHeaders, "Content-Type": "application/json" },
			body: JSON.stringify({
				filename: "photo.jpg",
				contentType: "image/jpeg",
				imageData: "data:image/jpeg;base64,/9j/",
			}),
		});
		expect(res.status).toBe(503);

		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.details.code).toBe("MEDIA_STORAGE_NOT_CONFIGURED");
	});
});
