#!/usr/bin/env tsx
/**
 * Lightweight deployed-environment load smoke.
 *
 * This is intentionally smaller than a full k6/autocannon suite: it validates
 * that the deployed Worker, DB-backed health check, auth rejection paths,
 * GraphQL endpoint, and webhook signature gate stay responsive under a modest,
 * controlled request rate.
 *
 * Usage:
 *   pnpm load:smoke staging
 *   pnpm load:smoke production
 *   pnpm load:smoke https://api.example.com
 *
 * Env:
 *   LOAD_TEST_URL              explicit target base URL
 *   API_BASE_URL_STAGING       staging base URL fallback
 *   API_BASE_URL_PRODUCTION    production base URL fallback
 *   WORKERS_SUBDOMAIN          derives workers.dev URL when no base URL is set
 *   LOAD_DURATION_SECONDS      default 30
 *   LOAD_RPS                   default 10
 *   LOAD_CONCURRENCY           default 8
 *   LOAD_TIMEOUT_MS            default 10000
 *   LOAD_MAX_ERROR_RATE        percent, default 1
 *   LOAD_MAX_P95_MS            default 3000
 */

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

type Stage = "staging" | "production";

type Check = {
	label: string;
	path: string;
	init?: RequestInit;
	expectedStatus: number;
	weight: number;
};

type Result = {
	label: string;
	ok: boolean;
	status: number | null;
	latencyMs: number;
	error?: string;
};

const stageArg = process.argv[2] || "staging";

const checks: Check[] = [
	{ label: "health", path: "/v1/health", expectedStatus: 200, weight: 3 },
	{
		label: "detailed-health",
		path: "/v1/health/detailed",
		expectedStatus: 200,
		weight: 1,
	},
	{ label: "auth-401", path: "/v1/users/me", expectedStatus: 401, weight: 1 },
	{
		label: "graphql-401",
		path: "/v1/graphql",
		init: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: "{ __typename }" }),
		},
		expectedStatus: 401,
		weight: 1,
	},
	{
		label: "webhook-401",
		path: "/v1/webhooks/workos",
		init: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "evt_load_smoke",
				event: "user.created",
				data: {},
			}),
		},
		expectedStatus: 401,
		weight: 1,
	},
];

function parsePositiveInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function parseNonNegativeNumber(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`${name} must be a non-negative number`);
	}
	return parsed;
}

function stageFromInput(input: string): Stage | null {
	if (input === "staging" || input === "production") return input;
	return null;
}

function readWorkerName(): string {
	const toml = readFileSync("wrangler.toml", "utf-8");
	const match = toml.match(/^\s*name\s*=\s*"([^"]+)"/m);
	if (!match) throw new Error("Could not read Worker name from wrangler.toml");
	return match[1];
}

function trimBaseUrl(url: string): string {
	return url.replace(/\/v1\/health(?:\/detailed)?\/?$/, "").replace(/\/$/, "");
}

function resolveBaseUrl(input: string): string {
	if (/^https?:\/\//.test(input)) return trimBaseUrl(input);

	const stage = stageFromInput(input);
	if (!stage) {
		throw new Error(
			"Usage: pnpm load:smoke <staging|production|https://target.example.com>",
		);
	}

	const stageEnvName = `API_BASE_URL_${stage.toUpperCase()}`;
	const explicit =
		process.env.LOAD_TEST_URL ||
		process.env[stageEnvName] ||
		process.env.HEALTH_URL;
	if (explicit) return trimBaseUrl(explicit);

	const subdomain = process.env.WORKERS_SUBDOMAIN;
	if (!subdomain) {
		throw new Error(
			`Set LOAD_TEST_URL, ${stageEnvName}, HEALTH_URL, or WORKERS_SUBDOMAIN`,
		);
	}

	return `https://${readWorkerName()}-${stage}.${subdomain}.workers.dev`;
}

const baseUrl = resolveBaseUrl(stageArg);
const durationSeconds = parsePositiveInt("LOAD_DURATION_SECONDS", 30);
const rps = parsePositiveInt("LOAD_RPS", 10);
const concurrency = parsePositiveInt("LOAD_CONCURRENCY", 8);
const timeoutMs = parsePositiveInt("LOAD_TIMEOUT_MS", 10_000);
const maxErrorRate = parseNonNegativeNumber("LOAD_MAX_ERROR_RATE", 1);
const maxP95Ms = parsePositiveInt("LOAD_MAX_P95_MS", 3_000);

const weightedChecks = checks.flatMap((check) =>
	Array.from({ length: check.weight }, () => check),
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCheck(index: number): Promise<Result> {
	const check = weightedChecks[index % weightedChecks.length];
	const started = performance.now();
	try {
		const response = await fetch(`${baseUrl}${check.path}`, {
			...check.init,
			signal: AbortSignal.timeout(timeoutMs),
		});
		const latencyMs = performance.now() - started;
		await response.arrayBuffer();
		return {
			label: check.label,
			ok: response.status === check.expectedStatus,
			status: response.status,
			latencyMs,
		};
	} catch (error) {
		return {
			label: check.label,
			ok: false,
			status: null,
			latencyMs: performance.now() - started,
			error: (error as Error).message,
		};
	}
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
	);
	return sorted[index];
}

async function runLoad(): Promise<Result[]> {
	const totalRequests = durationSeconds * rps;
	const intervalMs = 1000 / rps;
	const started = performance.now();
	const pending: Promise<void>[] = [];
	const results: Result[] = [];
	let inFlight = 0;

	for (let index = 0; index < totalRequests; index++) {
		const dueAt = started + index * intervalMs;
		const delayMs = dueAt - performance.now();
		if (delayMs > 0) await sleep(delayMs);

		while (inFlight >= concurrency) {
			await sleep(5);
		}

		inFlight++;
		const task = runCheck(index)
			.then((result) => {
				results.push(result);
			})
			.finally(() => {
				inFlight--;
			});
		pending.push(task);
	}

	await Promise.all(pending);
	return results;
}

function printSummary(results: Result[]): boolean {
	const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
	const failed = results.filter((result) => !result.ok);
	const errorRate = (failed.length / results.length) * 100;
	const p50 = percentile(latencies, 50);
	const p95 = percentile(latencies, 95);
	const p99 = percentile(latencies, 99);
	const byLabel = new Map<string, { ok: number; failed: number }>();

	for (const result of results) {
		const bucket = byLabel.get(result.label) ?? { ok: 0, failed: 0 };
		if (result.ok) bucket.ok++;
		else bucket.failed++;
		byLabel.set(result.label, bucket);
	}

	console.log(`Target: ${baseUrl}`);
	console.log(
		`Load: ${durationSeconds}s at ${rps} rps, concurrency ${concurrency}`,
	);
	console.log(
		`Latency: p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms`,
	);
	console.log(
		`Errors: ${failed.length}/${results.length} (${errorRate.toFixed(2)}%)`,
	);

	for (const [label, bucket] of byLabel.entries()) {
		console.log(`  ${label}: ok=${bucket.ok} failed=${bucket.failed}`);
	}

	const firstFailures = failed.slice(0, 5);
	for (const failure of firstFailures) {
		console.log(
			`  failure ${failure.label}: status=${failure.status ?? "network"} ${failure.error ?? ""}`,
		);
	}

	return errorRate <= maxErrorRate && p95 <= maxP95Ms;
}

console.log(`Starting load smoke: ${baseUrl}`);

runLoad()
	.then((results) => {
		const passed = printSummary(results);
		if (!passed) {
			console.error(
				`Load smoke failed thresholds: max error rate ${maxErrorRate}%, max p95 ${maxP95Ms}ms`,
			);
			process.exit(1);
		}
	})
	.catch((error) => {
		console.error((error as Error).message);
		process.exit(1);
	});
