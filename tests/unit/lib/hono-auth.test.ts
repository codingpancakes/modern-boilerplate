import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthVerificationUnavailableError } from "@/authorizers/verify-token";
import { ApiError } from "@/lib/errors";
import { requireAuth } from "@/lib/hono/auth";
import type { AppEnv } from "@/lib/hono/types";

const { createWorkosJwksMock, verifyWorkosTokenMock, logAuditMock } =
	vi.hoisted(() => ({
		createWorkosJwksMock: vi.fn(() => "jwks"),
		verifyWorkosTokenMock: vi.fn(),
		logAuditMock: vi.fn(),
	}));

// Keep the real AuthVerificationUnavailableError so the middleware's
// instanceof classification is exercised; mock only the verifier calls.
vi.mock("@/authorizers/verify-token", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/authorizers/verify-token")>()),
	createWorkosJwks: createWorkosJwksMock,
	verifyWorkosToken: verifyWorkosTokenMock,
}));

vi.mock("@/lib/audit", () => ({
	AUDIT_ACTIONS: { ACCESS_DENIED: "ACCESS_DENIED" },
	AUDIT_RESOURCE_TYPES: { USER: "USER" },
	AUDIT_STATUS: { FAILURE: "FAILURE" },
	logAudit: logAuditMock,
}));

function createProtectedApp() {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("requestId", "test-request-id");
		await next();
	});
	app.use("*", requireAuth());
	app.get("/protected", (c) => c.json({ claims: c.get("claims") }));
	app.onError((error, c) => {
		if (error instanceof ApiError) {
			return new Response(
				JSON.stringify({ message: error.message, code: error.code }),
				{
					status: error.statusCode,
					headers: { "content-type": "application/json" },
				},
			);
		}
		return c.json({ message: error.message }, 500);
	});
	return app;
}

describe("requireAuth", () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
	});

	it("fails closed when WORKOS_CLIENT_ID is empty and STAGE is not explicitly local/development", async () => {
		vi.stubEnv("WORKOS_CLIENT_ID", "");
		vi.stubEnv("STAGE", "prodution");

		const response = await createProtectedApp().request("/protected", {
			headers: { authorization: "Bearer token" },
		});

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toMatchObject({
			message: expect.stringContaining("WORKOS_CLIENT_ID is required"),
		});
		expect(createWorkosJwksMock).not.toHaveBeenCalled();
		expect(verifyWorkosTokenMock).not.toHaveBeenCalled();
		expect(logAuditMock).toHaveBeenCalledOnce();
	});

	it("returns 401 for a token the verifier rejects", async () => {
		vi.stubEnv("WORKOS_CLIENT_ID", "client_123");
		vi.stubEnv("STAGE", "production");
		verifyWorkosTokenMock.mockRejectedValue(new Error("signature mismatch"));

		const response = await createProtectedApp().request("/protected", {
			headers: { authorization: "Bearer bad-token" },
		});

		expect(response.status).toBe(401);
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ reason: "invalid_token" }),
			}),
		);
	});

	it("returns 503 (never 401) when key fetching fails — an outage is not a bad token", async () => {
		vi.stubEnv("WORKOS_CLIENT_ID", "client_123");
		vi.stubEnv("STAGE", "production");
		verifyWorkosTokenMock.mockRejectedValue(
			new AuthVerificationUnavailableError("JWKS fetch failed"),
		);

		const response = await createProtectedApp().request("/protected", {
			headers: { authorization: "Bearer valid-looking-token" },
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			code: "AUTH_UNAVAILABLE",
		});
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ reason: "auth_unavailable" }),
			}),
		);
	});

	it("allows unbound verification only for explicit local stages", async () => {
		vi.stubEnv("WORKOS_CLIENT_ID", "");
		vi.stubEnv("STAGE", "local");
		verifyWorkosTokenMock.mockResolvedValue({
			sub: "user_123",
			iss: "https://api.workos.com/",
			email: "ada@example.com",
		});

		const response = await createProtectedApp().request("/protected", {
			headers: { authorization: "Bearer token" },
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			claims: { sub: "user_123", email: "ada@example.com" },
		});
		expect(createWorkosJwksMock).toHaveBeenCalledWith("");
		expect(verifyWorkosTokenMock).toHaveBeenCalledWith("token", "jwks", {
			clientId: "",
		});
	});
});
