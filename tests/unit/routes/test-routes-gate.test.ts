import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors";
import type { AppEnv } from "@/lib/hono/types";
import { test as testRoutes } from "@/routes/test";

/**
 * The /v1/test/* diagnostics gate must FAIL CLOSED: only explicitly allowed
 * stages (local/development/staging) may reach the handlers. Production, an
 * unset STAGE, and typos all get the standard 404 — the same posture as the
 * other stage-keyed gates (auth client-id binding, CORS, introspection).
 */
function appWithTestRoutes() {
	const app = new Hono<AppEnv>();
	app.route("/v1/test", testRoutes);
	app.onError((error, c) => {
		if (error instanceof ApiError && error.statusCode === 404) {
			return c.json({ code: error.code }, 404);
		}
		return c.json({ message: error.message }, 500);
	});
	return app;
}

describe("/v1/test stage gate", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each(["production", "", "prodution", "Prod", undefined])(
		"returns 404 when STAGE is %j",
		async (stage) => {
			if (stage === undefined) {
				vi.stubEnv("STAGE", "");
				delete process.env.STAGE;
			} else {
				vi.stubEnv("STAGE", stage);
			}

			const response = await appWithTestRoutes().request("/v1/test/api-key", {
				headers: { "x-api-key": "anything" },
			});
			expect(response.status).toBe(404);
		},
	);

	it.each(["local", "development", "staging"])(
		"reaches the handler when STAGE is %j",
		async (stage) => {
			vi.stubEnv("STAGE", stage);
			vi.stubEnv("TEST_API_KEY", "expected-key");

			const response = await appWithTestRoutes().request("/v1/test/api-key", {
				headers: { "x-api-key": "expected-key" },
			});
			expect(response.status).toBe(200);
		},
	);
});
