import type { APIGatewayProxyEventV2 } from "aws-lambda";
import DataLoader from "dataloader";
import { inArray } from "drizzle-orm";
import {
	organizationMembers,
	organizations,
	profiles,
	users,
} from "../../db/schema/index";
import type { AuditContext } from "../../lib/audit";
import { getClaims, getUserIdFromClaims } from "../../lib/auth";
import { getDb } from "../../lib/db";

export interface GraphQLContext extends AuditContext {
	userId: string;
	orgId: string;
	role: string;
	email: string;
	providerSubject: string;
	claims: Record<string, unknown>;
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
				.where(inArray(organizationMembers.userId, [...userIds]));
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
				.where(inArray(organizationMembers.organizationId, [...orgIds]));
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

export async function createContext({
	event,
}: {
	event: APIGatewayProxyEventV2;
}): Promise<GraphQLContext> {
	const claims = getClaims(event);
	const userId = await getUserIdFromClaims(event);
	const db = await getDb();

	const orgId = (claims.org_id as string) || "";

	return {
		userId,
		orgId,
		organizationId: orgId || undefined,
		role: (claims.role as string) || "MEMBER",
		email: (claims.email as string) || "",
		providerSubject: claims.sub,
		claims,
		db,
		loaders: createLoaders(db),
	};
}
