import DataLoader from "dataloader";
import { and, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import {
	organizationMembers,
	organizations,
	profiles,
	users,
} from "../../db/schema/index";
import type { AuditContext } from "../../lib/audit";
import { getUserIdFromClaims } from "../../lib/auth";
import { getDb } from "../../lib/db";
import type { AppEnv } from "../../lib/hono/types";

export interface GraphQLContext extends AuditContext {
	userId: string;
	role: string;
	email: string;
	providerSubject: string;
	claims: Record<string, unknown>;
	requestId: string;
	ipAddress?: string;
	userAgent?: string;
	db: Awaited<ReturnType<typeof getDb>>;
	organizationId?: string;
	loaders: ReturnType<typeof createLoaders>;
}

export function createLoaders(db: Awaited<ReturnType<typeof getDb>>) {
	return {
		userById: new DataLoader<string, typeof users.$inferSelect | null>(
			async (ids) => {
				const rows = await db
					.select()
					.from(users)
					.where(inArray(users.id, [...ids]));
				const map = new Map(rows.map((r) => [r.id, r]));
				return ids.map((id) => map.get(id) ?? null);
			},
		),

		profileByUserId: new DataLoader<
			string,
			typeof profiles.$inferSelect | null
		>(async (userIds) => {
			const rows = await db
				.select()
				.from(profiles)
				.where(inArray(profiles.userId, [...userIds]));
			const map = new Map(rows.map((r) => [r.userId, r]));
			return userIds.map((id) => map.get(id) ?? null);
		}),

		orgById: new DataLoader<string, typeof organizations.$inferSelect | null>(
			async (ids) => {
				const rows = await db
					.select()
					.from(organizations)
					.where(inArray(organizations.id, [...ids]));
				const map = new Map(rows.map((r) => [r.id, r]));
				return ids.map((id) => map.get(id) ?? null);
			},
		),

		membershipsByUserId: new DataLoader<
			string,
			(typeof organizationMembers.$inferSelect)[]
		>(async (userIds) => {
			const rows = await db
				.select()
				.from(organizationMembers)
				.where(
					and(
						inArray(organizationMembers.userId, [...userIds]),
						eq(organizationMembers.status, "ACTIVE"),
					),
				);
			const grouped = new Map<
				string,
				(typeof organizationMembers.$inferSelect)[]
			>();
			for (const r of rows) {
				if (!r.userId) continue;
				const arr = grouped.get(r.userId) ?? [];
				arr.push(r);
				grouped.set(r.userId, arr);
			}
			return userIds.map((id) => grouped.get(id) ?? []);
		}),

		membershipsByOrgId: new DataLoader<
			string,
			(typeof organizationMembers.$inferSelect)[]
		>(async (orgIds) => {
			const rows = await db
				.select()
				.from(organizationMembers)
				.where(
					and(
						inArray(organizationMembers.organizationId, [...orgIds]),
						eq(organizationMembers.status, "ACTIVE"),
					),
				);
			const grouped = new Map<
				string,
				(typeof organizationMembers.$inferSelect)[]
			>();
			for (const r of rows) {
				const arr = grouped.get(r.organizationId) ?? [];
				arr.push(r);
				grouped.set(r.organizationId, arr);
			}
			return orgIds.map((id) => grouped.get(id) ?? []);
		}),
	};
}

/**
 * Build the per-request GraphQL context from the Hono context. Claims are set
 * by `requireAuth()` (applied to `/v1/graphql/*` in the route barrel), so this
 * never re-parses tokens — same trust boundary as every REST route.
 * DataLoaders are created fresh per request: batching/dedup never crosses a
 * request boundary (also a Workers requirement — no I/O reuse across
 * requests).
 */
export async function createContext(
	c: Context<AppEnv>,
): Promise<GraphQLContext> {
	const claims = c.get("claims");
	const sub = claims?.sub;
	if (typeof sub !== "string" || sub.length === 0) {
		throw new Error("JWT missing required 'sub' claim");
	}

	// Internal user id lookup + JIT provisioning (shared with REST routes).
	const userId = await getUserIdFromClaims(claims);
	const db = await getDb();

	return {
		userId,
		organizationId: claims.org_id || undefined,
		role: claims.role || "VIEWER",
		email: claims.email || "",
		providerSubject: sub,
		claims,
		requestId: c.get("requestId"),
		// CF-Connecting-IP is set by Cloudflare (and simulated by wrangler dev);
		// fall back to X-Forwarded-For's first hop — replaces the API Gateway
		// `requestContext.http.sourceIp`.
		ipAddress:
			c.req.header("cf-connecting-ip") ??
			c.req.header("x-forwarded-for")?.split(",")[0]?.trim(),
		userAgent: c.req.header("user-agent"),
		db,
		loaders: createLoaders(db),
	};
}
