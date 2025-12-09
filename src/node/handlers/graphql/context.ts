import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getDb } from "../../lib/db";

export interface GraphQLContext {
	userId: string;
	orgId: string;
	role: string;
	email: string;
	claims: Record<string, any>;
	db: Awaited<ReturnType<typeof getDb>>;
}

export async function createContext({
	event,
}: {
	event: APIGatewayProxyEventV2;
}): Promise<GraphQLContext> {
	// Extract WorkOS JWT claims from API Gateway authorizer
	const requestContext = event.requestContext as {
		authorizer?: {
			jwt?: {
				claims: {
					sub: string;
					org_id?: string;
					role?: string;
					email?: string;
					[key: string]: any;
				};
			};
		};
	};

	const claims = requestContext.authorizer?.jwt?.claims;

	if (!claims || !claims.sub) {
		throw new Error("Unauthorized: No valid JWT claims found");
	}

	// Get database connection
	const db = await getDb();

	return {
		userId: claims.sub,
		orgId: claims.org_id || "",
		role: claims.role || "member",
		email: claims.email || "",
		claims,
		db,
	};
}
