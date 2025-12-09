# API Documentation

## Overview

This project provides both **REST** and **GraphQL** APIs with interactive documentation for each.

---

## 🔵 REST API Documentation (Swagger/OpenAPI)

### Local Development
```bash
npm run docs:serve
```
Then open: http://localhost:3111

### Production/Staging
Access at: `https://your-api-domain.com/docs`

**Features:**
- ✅ Interactive API explorer (try-it-out functionality)
- ✅ Auto-generated from JSDoc comments in handlers
- ✅ Request/response schemas with Zod validation
- ✅ Authentication examples

**Endpoints Documented:**
- User management (`/users/*`)
- Media uploads (`/media/*`)
- Webhooks (`/webhooks/*`)
- Health checks (`/health`)

---

## 🟢 GraphQL API Documentation (GraphiQL)

### Local Development
Start the dev server:
```bash
npm run dev
```
Then open: http://localhost:3000/graphql/docs

### Production/Staging
Access at: `https://your-api-domain.com/graphql/docs`

**Features:**
- ✅ Interactive GraphQL explorer (like Swagger for GraphQL)
- ✅ Auto-complete and syntax highlighting
- ✅ Built-in schema documentation
- ✅ Query history and variables editor
- ✅ Real-time query execution

**Available Queries:**
- `me` - Get current user
- `user(id)` - Get user by ID
- `myOrganizations` - Get user's organizations
- `images` - List uploaded images

**Available Mutations:**
- `updateMe` - Update current user
- `updateProfile` - Update user profile
- `generateImageUploadUrl` - Get presigned upload URL

### Authentication

GraphiQL requires a JWT token from WorkOS. To authenticate:

1. Get your JWT token from WorkOS authentication
2. Open browser console on the GraphiQL page
3. Run:
   ```javascript
   localStorage.setItem('graphql-token', 'YOUR_JWT_TOKEN')
   ```
4. Refresh the page

The token will be automatically included in all requests.

---

## 📊 Comparison: REST vs GraphQL

| Feature | REST (Swagger) | GraphQL (GraphiQL) |
|---------|----------------|-------------------|
| **Documentation UI** | Swagger UI | GraphiQL |
| **Try It Out** | ✅ Yes | ✅ Yes |
| **Auto-complete** | ❌ No | ✅ Yes |
| **Schema Introspection** | ❌ No | ✅ Yes |
| **Flexible Queries** | ❌ Fixed endpoints | ✅ Custom queries |
| **Over-fetching** | ⚠️ Common | ✅ Prevented |
| **Versioning** | ⚠️ Required | ✅ Schema evolution |

---

## 🚀 Quick Start Examples

### REST API Example (cURL)

```bash
# Get current user
curl -X GET https://your-api.com/users/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### GraphQL API Example (cURL)

```bash
# Get current user with profile
curl -X POST https://your-api.com/graphql \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { me { id email firstName profile { preferredName photoUrl } } }"
  }'
```

### GraphQL API Example (JavaScript)

```javascript
// Using fetch
const response = await fetch('https://your-api.com/graphql', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: `
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
    `
  })
});

const { data } = await response.json();
console.log(data.me);
```

---

## 📝 Updating Documentation

### REST API (Swagger)

Documentation is auto-generated from JSDoc comments:

```typescript
/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get current user
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current user details
 */
export const handler = async (event) => {
  // ...
};
```

Run `npm run docs:generate` to regenerate.

### GraphQL API (GraphiQL)

Documentation is auto-generated from GraphQL schema files:

```graphql
# src/node/handlers/graphql/schema/users.graphql

"""
User type representing a registered user in the system
"""
type User {
  """Unique user identifier"""
  id: ID!
  
  """User's email address"""
  email: String
  
  # ... more fields
}
```

Schema changes are automatically reflected in GraphiQL.

---

## 🔒 Security

Both APIs use the same WorkOS JWT authentication:

1. **API Gateway** validates JWT tokens
2. **Lambda Context** receives user claims
3. **Resolvers/Handlers** enforce organization isolation

Every query/mutation checks:
- ✅ User is authenticated
- ✅ User belongs to the organization
- ✅ User has required permissions

---

## 🛠️ Development Workflow

1. **Add new REST endpoint:**
   - Create handler in `src/node/handlers/`
   - Add JSDoc comments
   - Run `npm run docs:generate`
   - Test in Swagger UI

2. **Add new GraphQL query/mutation:**
   - Update schema in `src/node/handlers/graphql/schema/*.graphql`
   - Add resolver in `src/node/handlers/graphql/resolvers/`
   - Test in GraphiQL

3. **Deploy:**
   ```bash
   npm run deploy:staging
   ```

---

## 📚 Additional Resources

- [GraphQL Guide](./GRAPHQL_GUIDE.md) - Complete GraphQL implementation guide
- [OpenAPI Spec](./api/openapi.json) - Machine-readable REST API spec
- [GraphQL Schema](../src/node/handlers/graphql/schema/) - GraphQL type definitions

---

## 🎯 Best Practices

### When to Use REST
- ✅ Webhooks (external systems)
- ✅ Simple CRUD operations
- ✅ File uploads
- ✅ Health checks

### When to Use GraphQL
- ✅ Complex nested queries
- ✅ Dashboard data aggregation
- ✅ Mobile apps (reduce over-fetching)
- ✅ Real-time features (with subscriptions)
- ✅ Flexible client requirements

---

**Need help?** Check the [GRAPHQL_GUIDE.md](./GRAPHQL_GUIDE.md) for detailed implementation examples.
