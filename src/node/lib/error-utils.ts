/**
 * Shared error coercion utilities.
 *
 * Eliminates the `error instanceof Error ? error.message : String(error)`
 * pattern duplicated across 7+ files.
 */

/** Extract a safe message string from an unknown thrown value. */
export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Coerce an unknown thrown value into an Error instance. */
export function toError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

/** Detect wrapped Postgres unique-constraint errors, including Drizzle causes. */
export function isUniqueConstraintViolation(err: unknown): boolean {
	let current: unknown = err;

	for (let depth = 0; depth < 8 && current; depth++) {
		if (hasPostgresUniqueCode(current)) return true;

		const message = errorMessage(current).toLowerCase();
		if (
			message.includes("23505") ||
			message.includes("duplicate key") ||
			message.includes("unique constraint")
		) {
			return true;
		}

		current = getCause(current);
	}

	return false;
}

function hasPostgresUniqueCode(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return value.code === "23505";
}

function getCause(value: unknown): unknown {
	if (value instanceof Error) return value.cause;
	if (!isRecord(value)) return undefined;
	return value.cause;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
