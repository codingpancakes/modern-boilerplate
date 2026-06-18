import { pgEnum } from "drizzle-orm/pg-core";

export const assignmentStatus = pgEnum("assignment_status", [
	// PENDING = invited but not yet accepted. PENDING members are NOT exposed by
	// the ACTIVE-filtered member/user queries, so an invite can't leak the
	// invitee's data until they consent (acceptInvitation).
	"PENDING",
	"ACTIVE",
	"INACTIVE",
	"ENDED",
]);

export const userType = pgEnum("user_type", ["OPERATOR", "MEMBER"]);

export const orgRole = pgEnum("org_role", [
	"OWNER",
	"ADMIN",
	"MANAGER",
	"MEMBER",
	"VIEWER",
]);
