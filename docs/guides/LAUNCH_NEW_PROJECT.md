# Launch a New Project — Step by Step

From a fresh clone of this boilerplate to a running local app, then a deployed
staging and production API on your own domain. Follow it top to bottom the first
time; later you'll only revisit the deploy steps.

This guide ties the helper scripts together. For deeper reference on any single
topic, see [CLOUDFLARE_SETUP.md](../CLOUDFLARE_SETUP.md).

---

## 0. What you'll end up with

- Local dev on `http://localhost:8787` (no cloud account needed).
- A staging API at `api-staging.<domain>` and production at `api.<domain>`.
- Your frontend (e.g. a Next.js app with a BFF proxy) calls those hosts.

## 1. Prerequisites

- **Node.js 24** and **pnpm**, **Docker** (only for real-DB integration tests).
- Accounts (created outside this repo): **Cloudflare**, **Neon** (Postgres),
  **WorkOS** (auth).
- CLIs: **wrangler** (bundled), and **neonctl** only if you want the optional
  `bootstrap --neon` step.

```bash
pnpm install
```

## 2. Scaffold the project

```bash
pnpm init-project <project-name> <domain>      # e.g. pnpm init-project acme-api acme.dev
```

This one command:
- sets the `package.json` name and the Worker name in `wrangler.toml`,
- rewrites all resource names (R2 buckets, webhook queues + DLQs, `PROJECT_NAME`),
- sets CORS origins and image CDN URLs from your domain,
- **wires the API custom domains** into `wrangler.toml` (`api.<domain>` /
  `api-staging.<domain>`) — see [set-domain](#7-put-the-api-on-your-domain),
- writes `.env.staging` / `.env.production` secret templates.

## 3. Know the three homes for configuration (important)

Getting this right avoids the most common confusion. There are **three separate
places**, and they never overlap:

| What | Where | Examples |
|---|---|---|
| **App secrets** | `.dev.vars` (local) and `.env.<stage>` (deploy) | `DATABASE_URL`, `WORKOS_CLIENT_ID`, `WORKOS_WEBHOOK_SECRET`, `R2_*` |
| **Non-secret config** | `wrangler.toml [vars]` | `STAGE`, `CORS_*`, `PROJECT_NAME`, `IMAGES_BUCKET`, `IMAGES_CDN_URL`, `API_VERSION` |
| **Tooling / deploy auth** | your shell or CI (never a file in the repo) | `wrangler login`, `neonctl auth`, `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY` |

The last row is the subtle one: `NEON_API_KEY` authenticates the `neonctl` CLI
to create databases — the **app never uses it** (the app connects with
`DATABASE_URL`). So it belongs in your shell, not in `.dev.vars`. Same for
`CLOUDFLARE_API_TOKEN`. Putting tooling auth in a secret file is wrong and would
push an account-management credential into your app's runtime for no reason.

All the files are gitignored; never commit real values, and rotate anything that
leaks.

## 4. Run locally (minimal — two secrets)

To boot the app you only need two app secrets. Put them in `.dev.vars`:

```
DATABASE_URL="postgresql://…@…neon.tech/…?sslmode=require"   # a Neon dev branch
WORKOS_CLIENT_ID="client_…"                                   # WorkOS application
```

Everything else in `.dev.vars` is feature-gated — leave it empty until you need
that feature (empty R2 → media returns a clean 503; empty `SENTRY_DSN` → error
reporting off; etc.).

```bash
pnpm migrate      # applies migrations to the DATABASE_URL in .dev.vars
pnpm dev          # wrangler dev --local → http://localhost:8787
curl http://localhost:8787/v1/health            # → { status: "ok" }
curl http://localhost:8787/v1/health/detailed   # → real DB round-trip
```

## 5. Set up the external services (one-time, manual)

These live in provider dashboards — they can't be scripted from here:

- **Neon** — create a project/database; copy the connection string into
  `DATABASE_URL`. (Or let `bootstrap --neon` create a per-stage branch in step 6.)
- **WorkOS** — create an application → copy the **client id** into
  `WORKOS_CLIENT_ID`. Add a webhook endpoint pointing at
  `https://api-staging.<domain>/v1/webhooks/workos` and copy its signing secret
  into `WORKOS_WEBHOOK_SECRET`.
- **R2 API token** — in the Cloudflare dashboard → R2 → Manage API Tokens, mint
  an S3-API token and put `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` into `.env.<stage>`. (Bucket creation itself is
  automated in step 6; only the token is manual, because it's credential-minting.)

## 6. Deploy to staging

**a. Authenticate the tooling** (shell, not files):

```bash
wrangler login          # Cloudflare
neonctl auth            # only if using --neon below
```

**b. Fill `.env.staging`** with the staging values (same key names as
`.dev.vars`; at minimum `DATABASE_URL` + `WORKOS_CLIENT_ID`).

**c. Provision Cloudflare resources** (idempotent — safe to re-run):

```bash
pnpm bootstrap staging --dry-run                 # preview what it will create
pnpm bootstrap staging                           # webhook queue + DLQ + R2 bucket
# optional: also create a Neon branch and write DATABASE_URL into .env.staging
pnpm bootstrap staging --neon <neon-project-id>
```

Queues **must** exist before the first deploy — `bootstrap` creates them.

**d. Push secrets and migrate the staging DB:**

```bash
pnpm sync-secrets staging                        # .env.staging → Cloudflare secrets
DATABASE_URL="<staging connection string>" pnpm migrate   # migrate the staging DB
```

`migrate` uses `.dev.vars`' `DATABASE_URL` by default; set it inline (as above)
to target a deployed database instead.

**e. Deploy** (health-gated canary with auto-rollback):

```bash
pnpm deploy:staging
```

Or do c→e in one shot: `pnpm bootstrap staging --neon <id> --deploy`.

## 7. Put the API on your domain

`init-project` already wrote the custom-domain routes. To change them later:

```bash
pnpm set-domain acme.dev            # api.acme.dev / api-staging.acme.dev
```

**Manual step (different DNS provider → not automatable here):** Cloudflare
Workers Custom Domains require the zone to be **on Cloudflare**. Add `acme.dev`
as a zone in Cloudflare and point your registrar's nameservers (or Cloudflare's
partial/CNAME setup) at it. Once the zone is on Cloudflare, wrangler manages the
in-zone DNS record on deploy, and `deploy.ts` health-checks the custom domain
automatically.

## 8. Production

Repeat step 6 with `production` (and the production `.env.production`,
`--neon` project/branch, and connection string). Gate production behind manual
approval in your GitHub environment.

## 9. Frontend / BFF

The API is on `api.<domain>`; your frontend/BFF (e.g. Next.js) proxies to it.
Have the BFF forward the WorkOS **access token** as `Authorization: Bearer …` —
the backend validates it (RS256 + `client_id` binding). Because the browser
talks to your BFF (same origin), you can lock the backend's CORS down hard.
Optional hardening: put **Cloudflare Access** (a service token) in front of
`api.<domain>` so only your BFF can reach it.

## What stays manual (by nature)

- **WorkOS** app + webhook setup (dashboard).
- **R2 S3 API token** minting (credential-minting; dashboard → `.env.<stage>`).
- **DNS** at your registrar (point the zone at Cloudflare).

Everything else — resource creation, secret push, migrations, canary deploy,
custom-domain wiring — is scripted.

## Quick reference

| Command | Does |
|---|---|
| `pnpm init-project <name> <domain>` | Scaffold names, envs, custom domains |
| `pnpm dev` | Run locally |
| `pnpm bootstrap <stage> [--dry-run] [--neon <id>] [--deploy]` | Create queues + bucket (+ Neon branch, + deploy) |
| `pnpm sync-secrets <stage>` | Push `.env.<stage>` secrets to Cloudflare |
| `pnpm set-domain <domain>` | (Re)wire API custom domains |
| `pnpm deploy:<stage>` | Health-gated canary deploy |
