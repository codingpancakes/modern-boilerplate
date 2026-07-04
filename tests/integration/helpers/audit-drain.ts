import { flushAudits, runWithAuditScope } from "@/lib/audit";

/**
 * Wrap a resolver map so every call runs inside an audit scope and drains its
 * fire-and-forget `logAudit()` writes before returning.
 *
 * Makes teardown deterministic: the resolvers emit `void logAudit(...)` writes
 * that settle after they return, and an in-flight audit INSERT can deadlock
 * against a following `TRUNCATE ... CASCADE`. Draining inside the scope removes
 * the race (previously papered over with a fixed `setTimeout`). Call-site types
 * are preserved — the returned map has the same shape as the input.
 */
export function withAuditDrain<T extends object>(map: T): T {
	const wrapped: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(map)) {
		wrapped[key] =
			typeof value === "function"
				? (...args: unknown[]) =>
						runWithAuditScope(async () => {
							const result = await (
								value as (...a: unknown[]) => Promise<unknown>
							)(...args);
							await flushAudits();
							return result;
						})
				: value;
	}
	return wrapped as T;
}
