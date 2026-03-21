import { pgEnum } from "drizzle-orm/pg-core";

export const assignmentStatus = pgEnum("assignment_status", [
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
