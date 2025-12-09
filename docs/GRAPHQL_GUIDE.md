# GraphQL Implementation Guide

**Last Updated:** December 8, 2025  
**Status:** Implementation Ready  
**Estimated Time:** 20-24 hours

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Installation](#installation)
4. [Phase 1: Migrate Existing Endpoints](#phase-1-migrate-existing-endpoints)
5. [Phase 2: Complex Features](#phase-2-complex-features)
6. [Phase 3: Full Domain Model](#phase-3-full-domain-model)
7. [Security & Authentication](#security--authentication)
8. [Testing](#testing)
9. [Frontend Integration](#frontend-integration)
10. [Best Practices](#best-practices)

---

## Overview

### Why GraphQL for This Project?

You're building a **marketing automation SaaS** (Iterable/Customer.io competitor) with:
- ✅ Complex relationships: Campaigns → Contacts → Journeys → Messages → Templates
- ✅ 50-100+ endpoints planned
- ✅ Multiple clients: Next.js web app, future mobile apps, customer integrations
- ✅ Deep nested queries needed for UIs (journey builder, campaign analytics)

### Architecture Decision

**Hybrid Approach:** GraphQL + REST
- **GraphQL:** Application queries, complex relationships, analytics
- **REST:** Webhooks, health checks, public endpoints

**Why Hybrid?**
- Keep existing REST endpoints working
- Migrate frontend gradually
- Webhooks must be REST (external systems)
- Health checks are simpler as REST

---

## Architecture

### Request Flow

```
Next.js Frontend
    ↓
BFF Proxy (Next.js API Routes) - Optional aggregation
    ↓
API Gateway → WorkOS JWT Authorizer → Lambda (GraphQL)
    ↓
GraphQL Resolvers → Drizzle ORM → PostgreSQL (Neon)
```

### Security Model (Same as REST)

```typescript
// API Gateway extracts WorkOS JWT claims
// GraphQL context receives claims
// Resolvers enforce org isolation

context: {
  userId: claims.sub,
  orgId: claims.org_id,
  role: claims.role,
  email: claims.email,
  claims: { ...all WorkOS claims }
}

// Every resolver checks org ownership
campaign: async (parent, { id }, context) => {
  return db.query.campaigns.findFirst({
    where: and(
      eq(campaigns.id, id),
      eq(campaigns.organizationId, context.orgId) // ← Org isolation
    )
  });
}
```

---

## Installation

### 1. Install Dependencies

```bash
pnpm add @apollo/server @apollo/server-integration-lambda graphql dataloader
pnpm add -D @graphql-codegen/cli @graphql-codegen/typescript @graphql-codegen/typescript-resolvers
```

### 2. Create Directory Structure

```bash
mkdir -p src/node/handlers/graphql/resolvers
touch src/node/handlers/graphql/handler.ts
touch src/node/handlers/graphql/schema.ts
touch src/node/handlers/graphql/context.ts
touch src/node/handlers/graphql/dataloaders.ts
touch src/node/handlers/graphql/resolvers/users.ts
touch src/node/handlers/graphql/resolvers/media.ts
touch src/node/handlers/graphql/resolvers/campaigns.ts
touch src/node/handlers/graphql/resolvers/journeys.ts
touch src/node/handlers/graphql/resolvers/contacts.ts
```

---

## Phase 1: Migrate Existing Endpoints

**Goal:** Migrate users, media, and profiles to GraphQL  
**Time:** 8-10 hours

### Step 1: Create GraphQL Schema

**File:** `src/node/handlers/graphql/schema.ts`

```typescript
export const typeDefs = `#graphql
  # ============================================
  # SCALARS
  # ============================================
  scalar DateTime
  scalar JSON

  # ============================================
  # USER TYPES
  # ============================================
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
    onboardingCompleted: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    
    # Relations
    user: User!
  }

  enum UserType {
    OPERATOR
    MEMBER
  }

  # ============================================
  # ORGANIZATION TYPES
  # ============================================
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
    leftAt: DateTime
    
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

  # ============================================
  # MEDIA TYPES
  # ============================================
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
    total: Int!
    continuationToken: String
  }

  # ============================================
  # QUERIES
  # ============================================
  type Query {
    # User queries
    me: User!
    user(id: ID!): User
    
    # Organization queries
    myOrganizations: [OrganizationMembership!]!
    organization(id: ID!): Organization
    
    # Media queries
    images(
      category: String
      limit: Int
      continuationToken: String
    ): ImageList!
  }

  # ============================================
  # MUTATIONS
  # ============================================
  type Mutation {
    # User mutations
    updateMe(input: UpdateUserInput!): User!
    updateProfile(input: UpdateProfileInput!): Profile!
    
    # Media mutations
    generateImageUploadUrl(
      filename: String!
      contentType: String!
      category: String
    ): ImageUploadUrl!
  }

  # ============================================
  # INPUT TYPES
  # ============================================
  input UpdateUserInput {
    email: String
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
  }
`;
```

### Step 2: Create Context (WorkOS Integration)

**File:** `src/node/handlers/graphql/context.ts`

```typescript
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getDb } from '../../lib/db';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

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
    throw new Error('Unauthorized: No valid JWT claims found');
  }

  // Get database connection
  const db = await getDb();

  return {
    userId: claims.sub,
    orgId: claims.org_id || '',
    role: claims.role || 'member',
    email: claims.email || '',
    claims,
    db,
  };
}
```

### Step 3: Create User Resolvers

**File:** `src/node/handlers/graphql/resolvers/users.ts`

```typescript
import { eq, and } from 'drizzle-orm';
import { users, profiles, organizationMemberships } from '../../../db/schema';
import type { GraphQLContext } from '../context';
import { sanitizeObject } from '../../../lib/sanitize';
import { userSchemas } from '../../../lib/validation';

export const userResolvers = {
  Query: {
    // Get current user
    me: async (parent: any, args: any, context: GraphQLContext) => {
      const user = await context.db.query.users.findFirst({
        where: eq(users.id, context.userId),
      });

      if (!user) {
        throw new Error('User not found');
      }

      return user;
    },

    // Get user by ID (must be in same org)
    user: async (
      parent: any,
      { id }: { id: string },
      context: GraphQLContext
    ) => {
      // Verify user is in same organization
      const membership = await context.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.userId, id),
          eq(organizationMemberships.organizationId, context.orgId)
        ),
      });

      if (!membership) {
        throw new Error('User not found or not in your organization');
      }

      const user = await context.db.query.users.findFirst({
        where: eq(users.id, id),
      });

      return user;
    },
  },

  Mutation: {
    // Update current user
    updateMe: async (
      parent: any,
      { input }: { input: any },
      context: GraphQLContext
    ) => {
      // Validate input
      const validated = userSchemas.update.parse(input);
      const sanitized = sanitizeObject(validated);

      // Update user
      const [updated] = await context.db
        .update(users)
        .set({
          ...sanitized,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, context.userId))
        .returning();

      return updated;
    },

    // Update profile
    updateProfile: async (
      parent: any,
      { input }: { input: any },
      context: GraphQLContext
    ) => {
      const sanitized = sanitizeObject(input);

      const [updated] = await context.db
        .update(profiles)
        .set({
          ...sanitized,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(profiles.userId, context.userId))
        .returning();

      return updated;
    },
  },

  // Field resolvers
  User: {
    profile: async (user: any, args: any, context: GraphQLContext) => {
      return context.db.query.profiles.findFirst({
        where: eq(profiles.userId, user.id),
      });
    },

    organizations: async (user: any, args: any, context: GraphQLContext) => {
      return context.db.query.organizationMemberships.findMany({
        where: eq(organizationMemberships.userId, user.id),
      });
    },
  },

  Profile: {
    user: async (profile: any, args: any, context: GraphQLContext) => {
      return context.db.query.users.findFirst({
        where: eq(users.id, profile.userId),
      });
    },
  },
};
```

### Step 4: Create Media Resolvers

**File:** `src/node/handlers/graphql/resolvers/media.ts`

```typescript
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { GraphQLContext } from '../context';
import {
  sanitizeFilename,
  validateFileExtension,
  validateContentType,
  validateFileSize,
} from '../../../lib/sanitize';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const IMAGES_BUCKET = process.env.IMAGES_BUCKET!;
const CDN_URL = process.env.CDN_URL!;

export const mediaResolvers = {
  Query: {
    images: async (
      parent: any,
      {
        category,
        limit = 50,
        continuationToken,
      }: { category?: string; limit?: number; continuationToken?: string },
      context: GraphQLContext
    ) => {
      const prefix = category
        ? `${context.userId}/${category}/`
        : `${context.userId}/`;

      const command = new ListObjectsV2Command({
        Bucket: IMAGES_BUCKET,
        Prefix: prefix,
        MaxKeys: limit,
        ContinuationToken: continuationToken,
      });

      const response = await s3Client.send(command);

      const images = (response.Contents || []).map((item) => ({
        key: item.Key!,
        url: `${CDN_URL}/${item.Key}`,
        size: item.Size || 0,
        lastModified: item.LastModified?.toISOString() || new Date().toISOString(),
        category: item.Key!.split('/')[1] || null,
      }));

      return {
        images,
        total: images.length,
        continuationToken: response.NextContinuationToken || null,
      };
    },
  },

  Mutation: {
    generateImageUploadUrl: async (
      parent: any,
      {
        filename,
        contentType,
        category,
      }: { filename: string; contentType: string; category?: string },
      context: GraphQLContext
    ) => {
      // Validate file
      const safeFilename = sanitizeFilename(filename);
      validateFileExtension(safeFilename, ['jpg', 'jpeg', 'png', 'gif', 'webp']);
      validateContentType(contentType, safeFilename);

      // Generate S3 key
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const key = category
        ? `${context.userId}/${category}/${timestamp}-${randomString}-${safeFilename}`
        : `${context.userId}/${timestamp}-${randomString}-${safeFilename}`;

      // Generate presigned URL
      const command = new PutObjectCommand({
        Bucket: IMAGES_BUCKET,
        Key: key,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600, // 1 hour
      });

      return {
        uploadUrl,
        imageUrl: `${CDN_URL}/${key}`,
        key,
        expiresIn: 3600,
      };
    },
  },
};
```

### Step 5: Create Main Handler

**File:** `src/node/handlers/graphql/handler.ts`

```typescript
import { ApolloServer } from '@apollo/server';
import {
  startServerAndCreateLambdaHandler,
  handlers,
} from '@apollo/server-integration-lambda';
import { typeDefs } from './schema';
import { createContext } from './context';
import { userResolvers } from './resolvers/users';
import { mediaResolvers } from './resolvers/media';

// Merge all resolvers
const resolvers = {
  Query: {
    ...userResolvers.Query,
    ...mediaResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...mediaResolvers.Mutation,
  },
  User: userResolvers.User,
  Profile: userResolvers.Profile,
};

// Create Apollo Server
const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: process.env.STAGE !== 'production', // Enable GraphQL Playground in dev
  formatError: (error) => {
    console.error('GraphQL Error:', error);
    return {
      message: error.message,
      extensions: {
        code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
      },
    };
  },
});

// Export Lambda handler
export const handler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: createContext,
  }
);
```

### Step 6: Add to Infrastructure

**File:** `infrastructure/lib/api-stack.ts`

Add this after your existing Lambda handlers:

```typescript
// GraphQL Handler
const graphqlHandler = new lambdaNodejs.NodejsFunction(this, 'GraphQLHandler', {
  entry: 'src/node/handlers/graphql/handler.ts',
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: cdk.Duration.seconds(30),
  memorySize: 512,
  environment: {
    DATABASE_URL: databaseSecret.secretValueFromJson('url').unsafeUnwrap(),
    STAGE: props.stage,
    IMAGES_BUCKET: props.imagesBucket,
    CDN_URL: props.cdnUrl || '',
    PROJECT_NAME: props.projectName,
  },
  bundling: {
    minify: true,
    sourceMap: true,
    externalModules: ['@aws-sdk/*'], // AWS SDK v3 is available in Lambda runtime
  },
});

// Grant permissions
databaseSecret.grantRead(graphqlHandler);
imagesBucket.grantReadWrite(graphqlHandler);

// Add GraphQL route with WorkOS authorizer
api.addRoutes({
  path: '/graphql',
  methods: [apigw.HttpMethod.POST, apigw.HttpMethod.GET], // GET for GraphQL Playground
  integration: new integrations.HttpLambdaIntegration(
    'GraphQLIntegration',
    graphqlHandler
  ),
  authorizer: jwtAuthorizer, // ← Same WorkOS JWT authorizer as REST!
});

// Add to outputs
new cdk.CfnOutput(this, 'GraphQLEndpoint', {
  value: `${api.apiEndpoint}/graphql`,
  description: 'GraphQL API endpoint',
});
```

### Step 7: Deploy

```bash
# Deploy to staging
pnpm deploy:staging

# Test GraphQL Playground
# Open: https://api-staging.yourdomain.com/graphql
```

---

## Phase 2: Complex Features

**Goal:** Add campaigns, journeys, contacts with GraphQL-first approach  
**Time:** 8-10 hours

### Campaign Schema

```graphql
type Campaign {
  id: ID!
  key: String
  name: String!
  description: String
  campaignType: String
  status: CampaignStatus!
  visibility: ResourceVisibility!
  createdAt: DateTime!
  updatedAt: DateTime!
  
  # Relations
  channel: MessageChannel
  template: Template
  contactList: ContactList
  contactSegment: ContactSegment
  runs: [CampaignRun!]!
  analytics: CampaignAnalytics!
}

type CampaignAnalytics {
  totalSent: Int!
  totalOpened: Int!
  totalClicked: Int!
  totalBounced: Int!
  totalUnsubscribed: Int!
  openRate: Float!
  clickRate: Float!
  bounceRate: Float!
}

enum CampaignStatus {
  DRAFT
  SCHEDULED
  RUNNING
  PAUSED
  COMPLETED
  ARCHIVED
}

type Query {
  campaign(id: ID!): Campaign
  campaigns(
    status: CampaignStatus
    limit: Int
    offset: Int
  ): [Campaign!]!
}

type Mutation {
  createCampaign(input: CreateCampaignInput!): Campaign!
  updateCampaign(id: ID!, input: UpdateCampaignInput!): Campaign!
  deleteCampaign(id: ID!): Boolean!
}
```

### Journey Schema

```graphql
type Journey {
  id: ID!
  key: String
  name: String!
  description: String
  status: JourneyStatus!
  entryMode: String
  version: Int!
  visibility: ResourceVisibility!
  createdAt: DateTime!
  updatedAt: DateTime!
  
  # Relations
  steps: [JourneyStep!]!
  activeRuns(limit: Int): [JourneyRun!]!
  analytics: JourneyAnalytics!
}

type JourneyStep {
  id: ID!
  journeyId: ID!
  stepType: StepType!
  config: JSON!
  position: Int!
  
  # Relations
  nextSteps: [JourneyStepConnection!]!
}

type JourneyStepConnection {
  id: ID!
  fromStepId: ID!
  toStepId: ID!
  condition: JSON
}

type JourneyRun {
  id: ID!
  journeyId: ID!
  contactId: ID!
  status: JourneyRunStatus!
  startedAt: DateTime!
  completedAt: DateTime
  
  # Relations
  contact: Contact!
  currentStep: JourneyStep
}

type JourneyAnalytics {
  totalContacts: Int!
  active: Int!
  completed: Int!
  failed: Int!
  averageDuration: Float
}

enum JourneyStatus {
  DRAFT
  ACTIVE
  PAUSED
  ARCHIVED
}

enum StepType {
  START
  SEND
  DELAY
  FILTER
  USER_UPDATE
  INTEGRATION
}

type Query {
  journey(id: ID!): Journey
  journeys(status: JourneyStatus): [Journey!]!
}
```

---

## Phase 3: Full Domain Model

**Goal:** Complete schema for all entities  
**Time:** 4-6 hours

Add remaining types:
- Contacts & Segments
- Templates & Versions
- Message Channels
- Subscriptions
- Webhooks
- Experiments

---

## Security & Authentication

### Org Isolation Pattern

**Every resolver MUST check organization ownership:**

```typescript
// ✅ CORRECT: Check org ownership
campaign: async (parent, { id }, context) => {
  const campaign = await context.db.query.campaigns.findFirst({
    where: and(
      eq(campaigns.id, id),
      eq(campaigns.organizationId, context.orgId) // ← Required!
    ),
  });
  
  if (!campaign) {
    throw new Error('Campaign not found');
  }
  
  return campaign;
}

// ❌ WRONG: No org check (security vulnerability!)
campaign: async (parent, { id }, context) => {
  return context.db.query.campaigns.findFirst({
    where: eq(campaigns.id, id), // ← Missing org check!
  });
}
```

### Role-Based Access Control

```typescript
// Check user role for sensitive operations
deleteCampaign: async (parent, { id }, context) => {
  // Only admins and owners can delete
  if (!['admin', 'owner'].includes(context.role)) {
    throw new Error('Insufficient permissions');
  }
  
  const campaign = await context.db.query.campaigns.findFirst({
    where: and(
      eq(campaigns.id, id),
      eq(campaigns.organizationId, context.orgId)
    ),
  });
  
  if (!campaign) {
    throw new Error('Campaign not found');
  }
  
  await context.db.delete(campaigns).where(eq(campaigns.id, id));
  
  return true;
}
```

---

## Testing

### GraphQL Playground

Access at: `https://api-staging.yourdomain.com/graphql`

**Example Query:**

```graphql
query GetMe {
  me {
    id
    email
    firstName
    lastName
    profile {
      preferredName
      photoUrl
    }
    organizations {
      role
      organization {
        name
        slug
      }
    }
  }
}
```

**Add Authorization Header:**

```json
{
  "Authorization": "Bearer YOUR_WORKOS_JWT_TOKEN"
}
```

### Unit Tests

```typescript
// tests/unit/graphql/resolvers/users.test.ts
import { describe, it, expect, vi } from 'vitest';
import { userResolvers } from '../../../src/node/handlers/graphql/resolvers/users';

describe('User Resolvers', () => {
  it('should return current user', async () => {
    const mockContext = {
      userId: 'user-123',
      orgId: 'org-456',
      role: 'admin',
      email: 'test@example.com',
      claims: {},
      db: {
        query: {
          users: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'user-123',
              email: 'test@example.com',
            }),
          },
        },
      },
    };

    const result = await userResolvers.Query.me(null, {}, mockContext);

    expect(result).toEqual({
      id: 'user-123',
      email: 'test@example.com',
    });
  });
});
```

---

## Frontend Integration

### Install Apollo Client

```bash
# In your Next.js frontend
pnpm add @apollo/client graphql
```

### Setup Apollo Client

```typescript
// lib/apollo-client.ts
import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';

const httpLink = createHttpLink({
  uri: process.env.NEXT_PUBLIC_GRAPHQL_URL,
});

const authLink = setContext((_, { headers }) => {
  // Get token from your auth provider (WorkOS)
  const token = getAuthToken();
  
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
    },
  };
});

export const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
});
```

### Use in Components

```typescript
// app/dashboard/page.tsx
'use client';

import { useQuery, gql } from '@apollo/client';

const GET_ME = gql`
  query GetMe {
    me {
      id
      email
      firstName
      lastName
      profile {
        preferredName
        photoUrl
      }
    }
  }
`;

export default function DashboardPage() {
  const { data, loading, error } = useQuery(GET_ME);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h1>Welcome, {data.me.firstName}!</h1>
      <p>{data.me.email}</p>
    </div>
  );
}
```

---

## Best Practices

### 1. N+1 Query Prevention with DataLoader

```typescript
// src/node/handlers/graphql/dataloaders.ts
import DataLoader from 'dataloader';
import { eq, inArray } from 'drizzle-orm';
import type { GraphQLContext } from './context';

export function createLoaders(context: GraphQLContext) {
  return {
    userLoader: new DataLoader(async (userIds: readonly string[]) => {
      const users = await context.db.query.users.findMany({
        where: inArray(users.id, [...userIds]),
      });
      
      const userMap = new Map(users.map(u => [u.id, u]));
      return userIds.map(id => userMap.get(id) || null);
    }),
    
    profileLoader: new DataLoader(async (userIds: readonly string[]) => {
      const profiles = await context.db.query.profiles.findMany({
        where: inArray(profiles.userId, [...userIds]),
      });
      
      const profileMap = new Map(profiles.map(p => [p.userId, p]));
      return userIds.map(id => profileMap.get(id) || null);
    }),
  };
}

// Use in resolvers
User: {
  profile: async (user, args, context) => {
    return context.loaders.profileLoader.load(user.id);
  },
}
```

### 2. Error Handling

```typescript
// Custom error classes
export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

// Use in resolvers
campaign: async (parent, { id }, context) => {
  const campaign = await context.db.query.campaigns.findFirst({
    where: and(
      eq(campaigns.id, id),
      eq(campaigns.organizationId, context.orgId)
    ),
  });
  
  if (!campaign) {
    throw new NotFoundError('Campaign');
  }
  
  return campaign;
}
```

### 3. Input Validation

```typescript
// Always validate and sanitize inputs
createCampaign: async (parent, { input }, context) => {
  // Validate with Zod
  const validated = campaignSchemas.create.parse(input);
  
  // Sanitize
  const sanitized = sanitizeObject(validated);
  
  // Create
  const [campaign] = await context.db
    .insert(campaigns)
    .values({
      ...sanitized,
      organizationId: context.orgId,
      createdByUserId: context.userId,
    })
    .returning();
  
  return campaign;
}
```

### 4. Pagination

```typescript
type Query {
  campaigns(
    limit: Int = 50
    offset: Int = 0
    cursor: String
  ): CampaignConnection!
}

type CampaignConnection {
  edges: [CampaignEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type CampaignEdge {
  node: Campaign!
  cursor: String!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}
```

---

## Summary

### Migration Checklist

**Phase 1: Foundation (8-10 hours)**
- [ ] Install dependencies
- [ ] Create schema for users, media, profiles
- [ ] Implement resolvers with org isolation
- [ ] Add WorkOS auth context
- [ ] Deploy to staging
- [ ] Test with GraphQL Playground
- [ ] Update frontend to use GraphQL

**Phase 2: Complex Features (8-10 hours)**
- [ ] Add campaigns schema & resolvers
- [ ] Add journeys schema & resolvers
- [ ] Add contacts & segments
- [ ] Implement DataLoader for N+1 prevention
- [ ] Add analytics resolvers

**Phase 3: Full Domain (4-6 hours)**
- [ ] Add templates & versions
- [ ] Add message channels
- [ ] Add subscriptions
- [ ] Add webhooks (keep REST for external calls)
- [ ] Add experiments & A/B tests

### Key Takeaways

✅ **Security:** Same WorkOS JWT auth, same org isolation  
✅ **Hybrid:** Keep REST for webhooks, use GraphQL for queries  
✅ **Migration:** Gradual, page-by-page frontend migration  
✅ **Performance:** DataLoader prevents N+1 queries  
✅ **Type Safety:** End-to-end types from schema to frontend  

---

**Ready to start implementation!** 🚀
