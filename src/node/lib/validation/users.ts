/**
 * User Validation Schemas
 *
 * Schemas for user and profile operations.
 */

import { z } from "zod";

/**
 * Create user schema
 */
export const createUser = z.object({
	email: z.string().email(),
	firstName: z.string().min(1).max(100),
	lastName: z.string().min(1).max(100),
});

/**
 * Update user schema (partial)
 * Must stay in sync with GraphQL UpdateUserInput
 */
export const updateUser = z.object({
	email: z.string().email().optional(),
	phone: z.string().max(20).optional(),
	firstName: z.string().min(1).max(100).optional(),
	lastName: z.string().min(1).max(100).optional(),
	defaultTimezone: z.string().max(50).optional(),
});

/**
 * Update user profile schema (nested user + profile)
 */
export const updateUserProfile = z
	.object({
		user: z
			.object({
				firstName: z.string().min(1).max(100).optional(),
				lastName: z.string().min(1).max(100).optional(),
				phone: z.string().max(20).optional(),
				defaultTimezone: z.string().max(50).optional(),
			})
			.optional(),
		profile: z
			.object({
				preferredName: z.string().max(100).optional(),
				pronouns: z.string().max(50).optional(),
				location: z.string().max(200).optional(),
				countryCode: z.string().length(2).optional(),
				photoUrl: z.string().url().optional(),
				gender: z.string().max(50).optional(),
				lgbtq: z.boolean().optional(),
				ethnicity: z.string().max(100).optional(),
				languages: z.array(z.string()).optional(),
				onboardingCompleted: z.boolean().optional(),
				persona: z.record(z.unknown()).optional(),
				snapshot: z.record(z.unknown()).optional(),
			})
			.optional(),
	})
	.refine((data) => data.user || data.profile, {
		message: "At least one of user or profile must be provided",
	});

/**
 * Update profile schema (standalone, for GraphQL updateProfile mutation)
 * Must stay in sync with GraphQL UpdateProfileInput
 */
export const updateProfileInput = z.object({
	preferredName: z.string().max(100).optional(),
	pronouns: z.string().max(50).optional(),
	location: z.string().max(200).optional(),
	countryCode: z.string().length(2).optional(),
	photoUrl: z.string().url().optional(),
	gender: z.string().max(50).optional(),
	lgbtq: z.boolean().optional(),
	ethnicity: z.string().max(100).optional(),
	languages: z.array(z.string()).optional(),
	onboardingCompleted: z.boolean().optional(),
	persona: z.record(z.unknown()).optional(),
	snapshot: z.record(z.unknown()).optional(),
});

/**
 * User schemas object
 */
export const userSchemas = {
	create: createUser,
	update: updateUser,
	updateProfile: updateUserProfile,
	updateProfileInput: updateProfileInput,
};
