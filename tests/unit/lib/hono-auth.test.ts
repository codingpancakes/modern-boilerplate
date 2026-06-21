import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors";
import { requireAuth } from "@/lib/hono/auth";
import type { AppEnv } from "@/lib/hono/types";

const { createWorkosJwksMock, verifyWorkosTokenMock, logAuditMock } =
	vi.hoisted(() => ({
		createWorkosJwksMock: vi.fn(() => "jwks"),
		verifyWorkosTokenMock: vi.fn(),
		logAuditMock: vi.fn(),
	}));

vi.mock("@/authorizers/verify-token", () => ({
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
		if (error instanceof ApiError && error.statusCode === 401) {
			return c.json({ message: error.message }, 401);
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
