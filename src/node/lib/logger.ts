/**
 * Thin structured JSON logger — the Workers replacement for
 * `@aws-lambda-powertools/logger`.
 *
 * Drop-in surface for how Powertools is used in this codebase:
 *
 *   // before: const logger = new Logger({ serviceName: "media" });
 *   import { createLogger } from "../lib/logger";
 *   const logger = createLogger({ serviceName: "media" });
 *   logger.info("Upload created", { key, size });
 *
 * Each call emits ONE JSON line to the console (picked up by Workers Logs /
 * Logpush): `{ level, message, service, timestamp, ...extra }` — the same
 * field names Powertools emits, so log queries keep working.
 *
 * Level threshold honors `POWERTOOLS_LOG_LEVEL` then `LOG_LEVEL` (default
 * INFO), read per call: on Workers, `process.env` is populated per invocation
 * by nodejs_compat, so module-init reads could race the first request.
 *
 * Not ported from Powertools (unused or Lambda-only here): `addContext`,
 * `appendKeys`, child loggers, log sampling.
 */

const LOG_LEVELS = {
	DEBUG: 10,
	INFO: 20,
	WARN: 30,
	ERROR: 40,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

const CONSOLE_METHOD: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
	DEBUG: "debug",
	INFO: "info",
	WARN: "warn",
	ERROR: "error",
};

/** Arbitrary structured fields merged into the emitted JSON line. */
export type LogAttributes = Record<string, unknown>;

export interface StructuredLogger {
	debug(message: string, extra?: LogAttributes): void;
	info(message: string, extra?: LogAttributes): void;
	warn(message: string, extra?: LogAttributes): void;
	error(message: string, extra?: LogAttributes): void;
}

function isLogLevel(value: string): value is LogLevel {
	return value in LOG_LEVELS;
}

function threshold(): number {
	const raw = (
		process.env.POWERTOOLS_LOG_LEVEL ||
		process.env.LOG_LEVEL ||
		"INFO"
	).toUpperCase();
	return isLogLevel(raw) ? LOG_LEVELS[raw] : LOG_LEVELS.INFO;
}

export function createLogger(options: {
	serviceName: string;
}): StructuredLogger {
	const emit = (
		level: LogLevel,
		message: string,
		extra?: LogAttributes,
	): void => {
		if (LOG_LEVELS[level] < threshold()) return;
		const timestamp = new Date().toISOString();
		let line: string;
		try {
			line = JSON.stringify({
				level,
				message,
				service: options.serviceName,
				timestamp,
				...extra,
			});
		} catch {
			// Unserializable extras (circular refs, BigInt) must never make
			// logging throw — fall back to the bare envelope.
			line = JSON.stringify({
				level,
				message,
				service: options.serviceName,
				timestamp,
				loggerError: "extra fields were not JSON-serializable and were dropped",
			});
		}
		console[CONSOLE_METHOD[level]](line);
	};

	return {
		debug: (message, extra) => emit("DEBUG", message, extra),
		info: (message, extra) => emit("INFO", message, extra),
		warn: (message, extra) => emit("WARN", message, extra),
		error: (message, extra) => emit("ERROR", message, extra),
	};
}
