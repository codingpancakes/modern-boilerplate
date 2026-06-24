/**
 * GraphQL SDL — single source of truth for the schema.
 *
 * Previously each domain lived in a sibling `.graphql` file loaded with
 * `readFileSync` at module init. Workers has no filesystem and the bundler
 * does not ship loose assets, so the SDL is inlined here verbatim.
 */

// base.graphql — Base schema with root types
const base = /* GraphQL */ `
	type Query {
		_empty: String @deprecated(reason: "Placeholder field — use extended types")
	}

	type Mutation {
		_empty: String @deprecated(reason: "Placeholder field — use extended types")
	}
`;

// scalars.graphql — Custom scalar types
const scalars = /* GraphQL */ `
	scalar DateTime
	scalar JSON
`;

// users.graphql — User types and operations
const usersSdl = /* GraphQL */ `
	type User {
		id: ID!
		email: String
		phone: String
		firstName: String
		lastName: String
		type: UserType!
		status: String
		defaultTimezone: String
		createdAt: DateTime!
		updatedAt: DateTime!
		lastLoginAt: DateTime

		# Relations
		profile: Profile
		organizations: [OrganizationMembership!]!
	}

	type Profile {
		userId: ID!
		preferredName: String
		pronouns: String
		location: String
		countryCode: String
		photoUrl: String
		gender: String
		lgbtq: Boolean
		ethnicity: String
		languages: [String!]
		onboardingCompleted: Boolean!
		persona: JSON
		snapshot: JSON
		createdAt: DateTime!
		updatedAt: DateTime!

		# Relations
		user: User!
	}

	enum UserType {
		OPERATOR
		MEMBER
	}

	# Queries
	extend type Query {
		me: User!
		user(id: ID!): User
	}

	# Response types
	type UpdateMeResponse {
		user: User!
		profile: Profile!
	}

	# Mutations
	extend type Mutation {
		updateMe(input: UpdateUserInput!): User!
		updateProfile(input: UpdateProfileInput!): Profile!
		updateMyAccount(
			user: UpdateUserInput
			profile: UpdateProfileInput
		): UpdateMeResponse!
	}

	# Input types
	input UpdateUserInput {
		phone: String
		firstName: String
		lastName: String
		defaultTimezone: String
	}

	input UpdateProfileInput {
		preferredName: String
		pronouns: String
		location: String
		countryCode: String
		photoUrl: String
		gender: String
		lgbtq: Boolean
		ethnicity: String
		languages: [String!]
		onboardingCompleted: Boolean
		persona: JSON
		snapshot: JSON
	}
`;

// organizations.graphql — Organization types and operations
const organizationsSdl = /* GraphQL */ `
	type Organization {
		id: ID!
		name: String
		slug: String
		orgType: String
		visibility: String
		defaultTimezone: String
		countryCode: String
		branding: JSON
		metadata: JSON
		status: String
		createdAt: DateTime!
		updatedAt: DateTime!

		# Relations
		members: [OrganizationMembership!]!
	}

	type OrganizationMembership {
		id: ID!
		userId: ID!
		organizationId: ID!
		role: OrgRole!
		joinedAt: DateTime!

		# Relations
		user: User!
		organization: Organization!
	}

	enum OrgRole {
		OWNER
		ADMIN
		MANAGER
		MEMBER
		VIEWER
	}

	type OrganizationMembershipPage {
		items: [OrganizationMembership!]!
		nextCursor: String
		hasMore: Boolean!
	}

	# Queries
	extend type Query {
		myOrganizations(limit: Int, cursor: String): OrganizationMembershipPage!
		organization(id: ID!): Organization
		organizationMembers(
			organizationId: ID!
			limit: Int
			cursor: String
		): OrganizationMembershipPage!
	}

	# Mutations
	extend type Mutation {
		createOrganization(input: CreateOrganizationInput!): Organization!
		updateOrganization(id: ID!, input: UpdateOrganizationInput!): Organization!
		deleteOrganization(id: ID!): Boolean!
		inviteMember(
			organizationId: ID!
			input: InviteMemberInput!
		): OrganizationMembership!
		updateMemberRole(
			organizationId: ID!
			input: UpdateMemberRoleInput!
		): OrganizationMembership!
		removeMember(organizationId: ID!, memberId: ID!): Boolean!
		leaveOrganization(organizationId: ID!): Boolean!
		# Invitee consent: a PENDING invite only becomes a real membership when
		# the invited user accepts it themselves.
		acceptInvitation(organizationId: ID!): OrganizationMembership!
		declineInvitation(organizationId: ID!): Boolean!
	}

	# Input types
	input CreateOrganizationInput {
		name: String!
		slug: String!
		orgType: String
		visibility: String
		defaultTimezone: String
		countryCode: String
		branding: JSON
		metadata: JSON
	}

	input UpdateOrganizationInput {
		name: String
		slug: String
		orgType: String
		visibility: String
		defaultTimezone: String
		countryCode: String
		branding: JSON
		metadata: JSON
	}

	input InviteMemberInput {
		userId: ID!
		role: OrgRole = MEMBER
	}

	input UpdateMemberRoleInput {
		memberId: ID!
		role: OrgRole!
	}
`;

// media.graphql — Media types and operations
const media = /* GraphQL */ `
	type Image {
		key: String!
		url: String!
		size: Int!
		lastModified: DateTime!
		category: String
	}

	type ImageUploadUrl {
		uploadUrl: String!
		imageUrl: String!
		key: String!
		expiresIn: Int!
	}

	type ImageList {
		images: [Image!]!
		count: Int!
		hasMore: Boolean!
		continuationToken: String
	}

	# Queries
	extend type Query {
		images(category: String, limit: Int, continuationToken: String): ImageList!
	}

	# Mutations
	extend type Mutation {
		generateImageUploadUrl(
			filename: String!
			contentType: String!
			fileSize: Int!
			category: String
		): ImageUploadUrl!
	}
`;

// audit.graphql — Audit log read API
const audit = /* GraphQL */ `
	type AuditLog {
		id: ID!
		userId: ID
		organizationId: ID
		orgUnitId: ID
		action: String!
		resourceType: String!
		resourceId: ID
		changes: JSON
		ipAddress: String
		userAgent: String
		requestId: String
		metadata: JSON
		status: String
		errorMessage: String
		timestamp: DateTime!
	}

	extend type Query {
		# With organizationId: returns logs for an organization the caller administers.
		# Without organizationId: returns org-less system/user logs for OPERATOR users.
		auditLogs(
			organizationId: ID
			userId: ID
			limit: Int
			action: String
			resourceType: String
		): [AuditLog!]!
	}
`;

// Combine all schema parts (same order as the old file loader)
export const typeDefs = `
  ${base}
  ${scalars}
  ${usersSdl}
  ${organizationsSdl}
  ${media}
  ${audit}
`;
