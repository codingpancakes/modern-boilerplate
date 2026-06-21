import type { RateLimit } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/hono/rate-limit";
import type { AppEnv } from "@/lib/hono/types";
import type { WorkerEnv } from "@/worker";

function createApp() {
	const app = new Hono<AppEnv>();
	app.use("*", rateLimit());
	app.get("/ok", (c) => c.text("ok"));
	app.onError((error, c) => {
		if (error instanceof ApiError && error.statusCode === 429) {
			return c.json({ code: error.code }, 429);
		}
		return c.json({ code: "INTERNAL_ERROR" }, 500);
	});
	return app;
}

function envWithLimiter(success: boolean): {
	env: WorkerEnv;
	limit: ReturnType<typeof vi.fn>;
} {
	const limit = vi.fn().mockResolvedValue({ success });
	const limiter = { limit } as unknown as RateLimit;
	return {
		env: { RATE_LIMITER: limiter } as WorkerEnv,
		limit,
	};
}

describe("rateLimit middleware", () => {
	it("passes requests when the binding allows the key", async () => {
		const { env, limit } = envWithLimiter(true);

		const response = await createApp().request(
			"/ok",
			{
				headers: { "cf-connecting-ip": "198.51.100.10" },
			},
			env,
		);

		expect(response.status).toBe(200);
		expect(limit).toHaveBeenCalledWith({ key: "198.51.100.10" });
	});

	it("throws RATE_LIMITED when the binding rejects the key", async () => {
		const { env, limit } = envWithLimiter(false);

		const response = await createApp().request(
			"/ok",
			{
				headers: { "cf-connecting-ip": "198.51.100.11" },
			},
			env,
		);

		expect(response.status).toBe(429);
		await expect(response.json()).resolves.toEqual({ code: "RATE_LIMITED" });
		expect(limit).toHaveBeenCalledWith({ key: "198.51.100.11" });
	});

	it("no-ops when the binding is absent", async () => {
		const response = await createApp().request("/ok", {}, {} as WorkerEnv);

		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toBe("ok");
	});
});
