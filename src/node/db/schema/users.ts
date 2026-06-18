import {
	boolean,
	date,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { citext } from "../types/citext";
import { userType } from "./enums";

/**
 * Users table - Core user accounts
 */
export const users = pgTable(
	"users",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		email: citext("email"),
		phone: citext("phone"),
		firstName: text("first_name"),
		lastName: text("last_name"),
		type: userType("type").notNull(),
		status: text("status"),
		defaultTimezone: text("default_timezone"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		lastLoginAt: timestamp("last_login_at", {
			withTimezone: true,
			mode: "string",
		}),
	},
	(table) => [
		uniqueIndex("ux_users_email").on(table.email),
		index("ix_users_phone").on(table.phone),
	],
);

/**
 * Profiles table - Extended user profile information
 */
export const profiles = pgTable(
	"profiles",
	{
		userId: uuid("user_id")
			.primaryKey()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		preferredName: text("preferred_name"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		pronouns: text("pronouns"),
		externalId: text("external_id"),
		location: text("location"),
		countryCode: text("country_code"),
		activatedOn: date("activated_on"),
		deactivatedOn: date("deactivated_on"),
		noSync: boolean("no_sync").default(false),
		photoUrl: text("photo_url"),
		gender: text("gender"),
		lgbtq: boolean("lgbtq"),
		ethnicity: text("ethnicity"),
		languages: text("languages").array(),
		onboardingCompleted: boolean("onboarding_completed").default(false),
		persona: jsonb("persona"),
		snapshot: jsonb("snapshot"),
	},
	(table) => [
		index("ix_profiles_external_id").on(table.externalId),
		index("ix_profiles_country").on(table.countryCode),
	],
);

/**
 * Auth Identities table - OAuth/SSO provider mappings
 */
export const authIdentities = pgTable(
	"auth_identities",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
		providerType: text("provider_type"),
		providerSubject: text("provider_subject"),
		emailAtProvider: citext("email_at_provider"),
		metadata: jsonb("metadata"),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
	},
	(table) => [
		index("ix_auth_user").on(table.userId),
		uniqueIndex("ux_auth_user_provider").on(table.userId, table.providerType),
		uniqueIndex("ux_auth_provider_subject").on(
			table.providerType,
			table.providerSubject,
		),
	],
);
