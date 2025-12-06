/**
 * Generic Update Helper
 *
 * Automatically maps partial update objects to database update operations.
 * Eliminates manual field-by-field mapping in update handlers.
 */

/**
 * Build update object from partial data
 *
 * Automatically includes only defined fields and adds updatedAt timestamp.
 *
 * @param partial - Partial update data
 * @param options - Optional configuration
 * @returns Update object ready for database
 *
 * @example
 * // Instead of manually mapping 10+ fields:
 * const updates = buildUpdateObject(input.user);
 * await db.update(users).set(updates).where(eq(users.id, userId));
 *
 * // Automatically includes only provided fields + updatedAt
 */
export function buildUpdateObject<T extends Record<string, unknown>>(
	partial: Partial<T>,
	options?: {
		includeTimestamp?: boolean;
		timestampField?: string;
	},
): Record<string, unknown> {
	const { includeTimestamp = true, timestampField = "updatedAt" } =
		options || {};

	// Start with provided fields (only defined values)
	const updates: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(partial)) {
		if (value !== undefined) {
			updates[key] = value;
		}
	}

	// Add timestamp if requested
	if (includeTimestamp) {
		updates[timestampField] = new Date().toISOString();
	}

	return updates;
}

/**
 * Check if update object has any fields (besides timestamp)
 *
 * @param updates - Update object from buildUpdateObject
 * @param timestampField - Name of timestamp field to exclude
 * @returns true if there are fields to update
 *
 * @example
 * const updates = buildUpdateObject(input);
 * if (hasUpdates(updates)) {
 *   await db.update(table).set(updates).where(...);
 * }
 */
export function hasUpdates(
	updates: Record<string, unknown>,
	timestampField: string = "updatedAt",
): boolean {
	const keys = Object.keys(updates).filter((k) => k !== timestampField);
	return keys.length > 0;
}

/**
 * Build multiple update objects for nested updates
 *
 * Useful for handlers that update multiple related tables.
 *
 * @param data - Object with nested update data
 * @returns Map of table name to update object
 *
 * @example
 * // Update user and profile in one go
 * const updates = buildNestedUpdates({
 *   user: { firstName: 'John' },
 *   profile: { bio: 'Developer' }
 * });
 *
 * if (updates.user) await db.update(users).set(updates.user).where(...);
 * if (updates.profile) await db.update(profiles).set(updates.profile).where(...);
 */
export function buildNestedUpdates<
	T extends Record<string, Record<string, unknown>>,
>(
	data: { [K in keyof T]?: Partial<T[K]> },
): { [K in keyof T]?: Record<string, unknown> } {
	const result: Record<string, Record<string, unknown>> = {};

	for (const [tableName, partial] of Object.entries(data)) {
		if (partial && Object.keys(partial).length > 0) {
			const updates = buildUpdateObject(partial as Record<string, unknown>);
			if (hasUpdates(updates)) {
				result[tableName] = updates;
			}
		}
	}

	return result as { [K in keyof T]?: Record<string, unknown> };
}
