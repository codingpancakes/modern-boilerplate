import { handle } from "hono/aws-lambda";
import { app } from "./app";

/**
 * API Gateway entrypoint for the single Hono app (`src/node/app.ts`).
 *
 * Every existing per-route Lambda entry file becomes a thin re-export of
 * this handler (`export { handler } from "../../lambda";`) so CDK wiring,
 * RouteBuilder bundling, and blue-green deploys stay 100% untouched — API
 * Gateway still routes to one function per path, but every function runs
 * the same app and Hono dispatches on the request path.
 */
export const handler = handle(app);
