/**
 * Main schema export file
 *
 * This file re-exports all database tables and enums from their respective domain modules.
 * Import from this file to get access to all schema definitions.
 *
 * Example:
 * ```typescript
 * import { users, profiles, organizations } from './db/schema';
 * ```
 */

// Export audit logs (SOC 2 compliance)
export * from "./audit";
// Export contacts domain
export * from "./contacts";
// Export all enums
export * from "./enums";
// Export journeys & campaigns domain
export * from "./journeys";

// Export messaging domain
export * from "./messaging";
// Export organizations domain
export * from "./organizations";
// Export users domain
export * from "./users";
