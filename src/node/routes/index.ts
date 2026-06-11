import { Hono } from "hono";
import { requireAuth } from "../lib/hono/auth";
import type { AppEnv } from "../lib/hono/types";
import { media } from "./media";
import { users } from "./users";
import { utils } from "./utils";
import { webhooks } from "./webhooks";

/**
 * Route barrel — the Hono mirror of `infrastructure/lib/routes/*.ts`.
 *
 * Mount paths here MUST match the API Gateway routes exactly; domain agents
 * add endpoints inside their own module (relative to its mount) and never
 * touch this file or `app.ts`. Auth is applied here per-domain, exactly like
 * attaching the WorkOS authorizer to a route in CDK.
 */
export const routes = new Hono<AppEnv>();

// Protected domains (API Gateway attaches the WorkOS JWT authorizer)
routes.use("/v1/users/*", requireAuth());
routes.use("/v1/media/*", requireAuth());
routes.route("/v1/users", users);
routes.route("/v1/media", media);

// Public domains (webhooks verify their own signatures; utils owns /v1/health*)
routes.route("/v1/webhooks", webhooks);
routes.route("/v1", utils);
