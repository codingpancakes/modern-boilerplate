# GraphQL Documentation Setup

## ✅ What Was Added

Interactive GraphQL documentation (GraphiQL) - the GraphQL equivalent of Swagger UI for REST APIs.

---

## 📍 Access Points

### Local Development
```bash
npm run dev
```
Then open: **http://localhost:3000/graphql/docs**

### Staging/Production
After deployment: **https://your-api-domain.com/graphql/docs**

---

## 🎯 Features

GraphiQL provides an interactive GraphQL explorer with:

- ✅ **Auto-complete** - Press Ctrl/Cmd + Space for suggestions
- ✅ **Syntax highlighting** - Beautiful query editor
- ✅ **Schema documentation** - Click "Docs" to explore all types
- ✅ **Query history** - Previous queries are saved
- ✅ **Variables editor** - Test queries with variables
- ✅ **Real-time execution** - See results immediately

---

## 🔐 Authentication

To authenticate in GraphiQL:

1. Get your JWT token from WorkOS
2. Open browser console on the GraphiQL page
3. Run:
   ```javascript
   localStorage.setItem('graphql-token', 'YOUR_JWT_TOKEN')
   ```
4. Refresh the page

The token is automatically included in all requests.

---

## 📝 Example Queries

### Get Current User
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
      onboardingCompleted
    }
    organizations {
      role
      organization {
        id
        name
        slug
      }
    }
  }
}
```

### Get Images
```graphql
query GetImages {
  images(limit: 10, category: "avatars") {
    images {
      key
      url
      size
      lastModified
      category
    }
    total
    continuationToken
  }
}
```

### Update Profile
```graphql
mutation UpdateProfile {
  updateProfile(input: {
    preferredName: "John"
    location: "San Francisco"
  }) {
    userId
    preferredName
    location
    updatedAt
  }
}
```

---

## 🛠️ Technical Details

### Files Created

1. **`src/node/handlers/graphql/docs.ts`**
   - Lambda handler that serves GraphiQL HTML
   - Automatically connects to your GraphQL endpoint
   - Includes authentication helper

2. **`infrastructure/lib/api-stack.ts`** (updated)
   - Added GraphQL docs Lambda function
   - Added `/graphql/docs` route (public access)
   - Added CloudFormation output for docs URL

3. **`docs/API_DOCUMENTATION.md`**
   - Complete guide for both REST and GraphQL APIs
   - Usage examples and best practices

### Architecture

```
User Browser
    ↓
GET /graphql/docs
    ↓
API Gateway → Lambda (docs.ts)
    ↓
Returns GraphiQL HTML
    ↓
GraphiQL connects to /graphql endpoint
    ↓
Executes queries with JWT auth
```

---

## 🚀 Deployment

The GraphQL docs will be automatically deployed when you run:

```bash
npm run deploy:staging
# or
npm run deploy:production
```

After deployment, check the CloudFormation outputs for the docs URL:
```
GraphQLDocsEndpoint = https://your-api.com/graphql/docs
```

---

## 📊 Comparison with REST Docs

| Feature | REST (Swagger) | GraphQL (GraphiQL) |
|---------|----------------|-------------------|
| **URL** | `/docs` | `/graphql/docs` |
| **Interactive** | ✅ Yes | ✅ Yes |
| **Auto-complete** | ❌ No | ✅ Yes |
| **Schema Introspection** | ❌ No | ✅ Yes |
| **Authentication** | Header UI | localStorage |
| **Generated From** | JSDoc comments | GraphQL schema |

---

## 🎨 Customization

To customize GraphiQL appearance, edit `src/node/handlers/graphql/docs.ts`:

```typescript
// Change primary color
.graphiql-container {
  --color-primary: 40, 167, 69; // RGB values
}
```

---

## 🔧 Troubleshooting

### GraphiQL shows "Loading..." forever
- Check that the GraphQL endpoint is accessible
- Verify CORS settings allow requests from the docs page

### Authentication not working
- Ensure JWT token is valid and not expired
- Check browser console for errors
- Verify token is stored: `localStorage.getItem('graphql-token')`

### Schema not showing
- Ensure introspection is enabled (it is by default in non-production)
- Check that the GraphQL endpoint is responding

---

## 📚 Next Steps

1. **Explore the schema** - Click "Docs" in GraphiQL to see all types
2. **Try example queries** - Use the default query that loads
3. **Read the guide** - See [GRAPHQL_GUIDE.md](./GRAPHQL_GUIDE.md) for more details
4. **Add more queries** - Extend the schema in `src/node/handlers/graphql/schema/`

---

## 🎉 Summary

You now have:
- ✅ Interactive GraphQL documentation (GraphiQL)
- ✅ Same authentication as REST API
- ✅ Auto-deployed with your infrastructure
- ✅ Public access (no auth required for docs UI)
- ✅ Complete parity with Swagger UI for REST

**Access it at:** `/graphql/docs` 🚀
