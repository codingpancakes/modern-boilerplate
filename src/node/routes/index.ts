import { Hono } from "hono";
import { requireAuth } from "../lib/hono/auth";
import type { AppEnv } from "../lib/hono/types";
import { graphql } from "./graphql";
import { media } from "./media";
import { test } from "./test";
import { users } from "./users";
import { utils } from "./utils";
import { webhooks } from "./webhooks";

/**
 * Route barrel — every public path of the Worker, in one place.
 *
 * Domain agents add endpoints inside their own module (relative to its
 * mount) and never touch this file or `app.ts`. Auth is applied here
 * per-domain via `requireAuth()`.
 */
export const routes = new Hono<AppEnv>();

// Protected domains (WorkOS JWT verified by requireAuth middleware)
routes.use("/v1/users/*", requireAuth());
routes.use("/v1/media/*", requireAuth());
routes.use("/v1/graphql/*", requireAuth());
routes.route("/v1/users", users);
routes.route("/v1/media", media);
routes.route("/v1/graphql", graphql);

// Public domains (webhooks verify their own signatures; utils owns /v1/health*)
routes.route("/v1/webhooks", webhooks);

// Dev-only diagnostics (the sub-app 404s every request when STAGE=production)
routes.route("/v1/test", test);

routes.route("/v1", utils);
