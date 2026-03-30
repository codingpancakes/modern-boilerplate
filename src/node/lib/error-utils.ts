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
