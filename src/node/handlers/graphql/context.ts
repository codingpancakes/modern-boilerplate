import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getClaims, getUserIdFromClaims } from "../../lib/auth";
import { getDb } from "../../lib/db";

export interface GraphQLContext {
	userId: string;
	orgId: string;
	role: string;
	email: string;
	providerSubject: string;
	claims: Record<string, unknown>;
	db: Awaited<ReturnType<typeof getDb>>;
}

export async function createContext({
	event,
}: {
	event: APIGatewayProxyEventV2;
}): Promise<GraphQLContext> {
	// Get JWT claims using existing helper
	const claims = getClaims(event);

	// Get internal user ID from provider subject (WorkOS ID -> internal UUID)
	const userId = await getUserIdFromClaims(event);

	// Get database connection
	const db = await getDb();

	return {
		userId, // Internal UUID
		orgId: (claims.org_id as string) || "",
		role: (claims.role as string) || "MEMBER",
		email: (claims.email as string) || "",
		providerSubject: claims.sub, // WorkOS ID
		claims,
		db,
	};
}
