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

## 2. Create an independent repository

Prefer GitHub's **Use this template** action: create a new repository from this
boilerplate, then clone the new repository. It gets its own remote and cannot
accidentally push product work back to the boilerplate.

If the repository is not configured as a GitHub template, clone it and replace
the remote before making product changes:

```bash
git clone <boilerplate-url> <new-project-directory>
cd <new-project-directory>
git remote remove origin
git remote add origin <new-empty-repository-url>
git remote -v

pnpm install
```

Do not reuse the boilerplate repository as the product repository, and do not
put provider credentials in its Git history.

## 3. Scaffold the project

Run it with no arguments for an interactive wizard (prompts for name, domain, and
API subdomain, `create-next-app` style):

```bash
pnpm init-project                              # interactive
# or non-interactive (scripts/CI):
pnpm init-project <project-name> <domain> [api-subdomain] [--force]
# e.g. pnpm init-project acme acme.dev api
```

This one command:
- sets the `package.json` name and the Worker name in `wrangler.toml`,
- rewrites all resource names (R2 buckets, webhook queues + DLQs, `PROJECT_NAME`),
- sets CORS origins and image CDN URLs from your domain,
- **wires the API custom domains** into `wrangler.toml` (`api.<domain>` /
  `api-staging.<domain>`) — see [set-domain](#8-put-the-api-on-your-domain),
- writes `.env.staging` / `.env.production` secret templates.

Review the generated change before adding product code:

```bash
git diff
pnpm check
```

## 4. Know the three homes for configuration (important)

Getting this right avoids the most common confusion. There are **three separate
places**, and they never overlap:

| What | Where | Examples |
|---|---|---|
| **App secrets** | `.dev.vars` (local) and `.env.<stage>` (deploy) | `DATABASE_URL`, `WORKOS_CLIENT_ID`, `WORKOS_WEBHOOK_SECRET`, `R2_*` |
| **Non-secret config** | `wrangler.toml [vars]` | `STAGE`, `CORS_*`, `PROJECT_NAME`, `IMAGES_BUCKET`, `IMAGES_CDN_URL`, `API_VERSION` |
| **Tooling / deploy auth** | your shell or CI (never a file in the repo) | `npx wrangler login`, `neonctl auth`, `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY` |

The last row is the subtle one: `NEON_API_KEY` authenticates the `neonctl` CLI
to create databases — the **app never uses it** (the app connects with
`DATABASE_URL`). So it belongs in your shell, not in `.dev.vars`. Same for
`CLOUDFLARE_API_TOKEN`. Putting tooling auth in a secret file is wrong and would
push an account-management credential into your app's runtime for no reason.

All the files are gitignored; never commit real values, and rotate anything that
leaks.

## 5. Run locally (minimal — two secrets)

Create the ignored local secret file:

```bash
cp .dev.vars.example .dev.vars
```

To boot the app you only need two app secrets. Put them in `.dev.vars`:

```
DATABASE_URL="postgresql://…@…neon.tech/…?sslmode=require"   # a Neon dev branch
WORKOS_CLIENT_ID="client_…"                                   # WorkOS application
```

Everything else in `.dev.vars` is feature-gated for local work. Deployed
detailed health requires `WORKOS_WEBHOOK_SECRET`; empty R2 credentials make
presign/list operations return a clean 503, and empty `SENTRY_DSN` disables
error reporting.

```bash
pnpm migrate      # applies migrations to the DATABASE_URL in .dev.vars
pnpm dev          # wrangler dev --local → http://localhost:8787
curl http://localhost:8787/v1/health            # → { status: "ok" }
curl http://localhost:8787/v1/health/detailed   # → real DB round-trip
```

Run the complete local gate before treating the initialized repository as a
baseline:

```bash
pnpm check
pnpm test:integration:local
pnpm docs:validate
```

## 6. Commit the initialized baseline

First prove that local and deployed secret files are ignored:

```bash
git status --short
git check-ignore .dev.vars .env.staging .env.production
```

All three paths must be reported as ignored. Then inspect and commit only the
initialized project:

```bash
git add -A
git diff --cached --check
git diff --cached
git commit -m "Initialize project from backend boilerplate"
```

Keep this commit local until staging and the GitHub environments are configured.
The checked-in workflow deploys production on a push to `main`; the first remote
product branch must therefore be `staging`, not an unprepared `main`.

## 7. Set up the external services (one-time, manual)

These live in provider dashboards — they can't be scripted from here:

- **Neon** — create a project/database; copy the connection string into
  `DATABASE_URL`. (Or let `bootstrap --neon` create a per-stage branch in step 9.)
- **WorkOS** — create an application → copy the **client id** into
  `WORKOS_CLIENT_ID`. Add a webhook endpoint pointing at
  `https://api-staging.<domain>/v1/webhooks/workos` and copy its signing secret
  into `WORKOS_WEBHOOK_SECRET`.
- **R2 API token** — in the Cloudflare dashboard → R2 → Manage API Tokens, mint
  an S3-API token and put `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` into `.env.<stage>`. (Bucket creation itself is
  automated in step 9; only the token is manual, because it's credential-minting.)

Use separate development/staging/production databases or branches and
environment-specific provider credentials. Do not point tests or staging at the
production database.

## 8. Put the API on your domain

`init-project` already wrote the custom-domain routes. To change them later:

```bash
pnpm set-domain acme.dev            # api.acme.dev / api-staging.acme.dev
```

Cloudflare Workers Custom Domains require the zone to be **on Cloudflare before
the first deploy that contains those routes**. Add the domain as a Cloudflare
zone and point the registrar's nameservers (or configure Cloudflare's supported
partial/CNAME setup). Wrangler manages the in-zone Worker DNS records on
deploy, and `deploy.ts` health-checks the custom domain automatically.

## 9. Deploy to staging

**a. Authenticate the tooling** (shell, not files):

```bash
npx wrangler login      # Cloudflare
neonctl auth            # only if using --neon below
```

**b. Fill `.env.staging`** with the staging values (same key names as
`.dev.vars`). Deployed detailed health requires all three:

```dotenv
DATABASE_URL="postgresql://..."
WORKOS_CLIENT_ID="client_..."
WORKOS_WEBHOOK_SECRET="whsec_..."
```

Add `SENTRY_DSN` and R2 S3 API credentials when those features are enabled.

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

Or do c→e in one shot: `pnpm bootstrap staging --neon <id> --deploy` — it
sync-secrets, then migrates the **staging** DB (using `DATABASE_URL` from
`.env.staging`, not your local `.dev.vars`), then deploys.

Verify both public and database-backed health:

```bash
curl https://api-staging.<domain>/v1/health
curl https://api-staging.<domain>/v1/health/detailed
```

## 10. Configure GitHub CI/CD

The checked-in workflow (`.github/workflows/ci.yml`) expects GitHub Environments
named `staging` and `production`.

Add these **environment secrets** to both environments, using stage-specific
values where applicable:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Authenticate Worker deployments |
| `CLOUDFLARE_ACCOUNT_ID` | Select the Cloudflare account |
| `DATABASE_URL` | Optional pending-migration preflight against that stage |

The application's WorkOS/R2/Sentry secrets are Worker runtime secrets pushed by
`pnpm sync-secrets`; they do not need to be duplicated in GitHub unless a
workflow step directly consumes them.

Add these **environment variables**:

| Variable | Requirement |
| --- | --- |
| `CHECK_PENDING_MIGRATIONS` | Recommended: `true` |
| `WORKERS_SUBDOMAIN` | Needed only when no custom-domain/`HEALTH_URL` is available |
| `SMOKE_CORS_ORIGIN_STAGING` | Optional staging frontend origin |
| `SMOKE_CORS_ORIGIN_PRODUCTION` | Optional production frontend origin |

`SMOKE_CORS_ORIGIN` is a shared fallback if stage-specific values are not used.
Configure required reviewers on the GitHub `production` environment so a merge
to `main` cannot deploy without approval.

The workflow uses:

| Git event | Behavior |
| --- | --- |
| Pull request into `staging` or `main` | Full CI gate, no deploy |
| Push/merge to `staging` | Gate, then staging deploy |
| Push/merge to `main` | Gate, then production approval/deploy |
| Manual `workflow_dispatch` | Explicit staging or production target |

Push the initialized baseline to `staging`. This runs the full gate and then the
staging deployment against the environment configured above:

```bash
git switch -c staging
git push -u origin staging
git switch main
```

Do **not** push the initialized `main` branch yet. A `main` push starts the
production deployment job.

Repository settings such as branch protection, required status checks, and
environment reviewers are external controls; configure them in GitHub rather
than assuming the workflow file enforces them.

## 11. Production

Use production-only database and provider values in `.env.production`, then:

```bash
pnpm bootstrap production --dry-run
pnpm bootstrap production
pnpm sync-secrets production
DATABASE_URL="<production connection string>" pnpm migrate
```

Configure the production WorkOS webhook at
`https://api.<domain>/v1/webhooks/workos`. When the production environment,
secrets, database migration, and approval gate are ready, push `main`:

```bash
git push -u origin main
```

The workflow runs the complete gate, waits for production-environment approval,
and executes `pnpm deploy:production`. If CI deployment is deliberately
disabled, run `pnpm deploy:production` locally instead—do not run both paths
unnecessarily. Verify both production health endpoints after promotion.

## 12. Frontend / BFF

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
- **GitHub controls** (environment approval, branch protection, required checks).

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
