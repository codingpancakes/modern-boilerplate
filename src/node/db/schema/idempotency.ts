import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Idempotency Keys table - prevents duplicate request processing.
 *
 * For user-supplied HTTP idempotency keys, `key` stores the internal
 * subject-scoped storage key, not the raw Idempotency-Key header value.
 *
 * Infrastructure, not a domain table — lives in its own schema file rather
 * than under organizations.
 */
export const idempotencyKeys = pgTable(
	"idempotency_keys",
	{
		key: text("key").primaryKey().notNull(),
		requestHash: text("request_hash").notNull(),
		status: text("status").notNull(),
		response: text("response"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "string",
		}),
		expiresAt: timestamp("expires_at", {
			withTimezone: true,
			mode: "string",
		}).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [index("ix_idempotency_keys_expires").on(table.expiresAt)],
);
