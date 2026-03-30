import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyResultV2,
} from "aws-lambda";

/**
 * GraphiQL Documentation Handler
 *
 * Serves an interactive GraphQL explorer UI similar to Swagger UI for REST APIs.
 * This handler returns the GraphiQL HTML interface that connects to your GraphQL endpoint.
 *
 * Access at: /graphql/docs
 */
export const handler = async (
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
	// Get the GraphQL endpoint from the request
	// Sanitize to prevent XSS via crafted Host header
	const protocol = (event.headers["x-forwarded-proto"] || "http").replace(
		/[^a-z]/gi,
		"",
	);
	const host = (event.headers.host || event.requestContext.domainName).replace(
		/[^a-zA-Z0-9.:_-]/g,
		"",
	);
	const graphqlEndpoint = `${protocol}://${host}/v1/graphql`;

	// Return GraphiQL HTML
	const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GraphQL API Documentation</title>
  <style>
    body {
      margin: 0;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    #graphiql {
      height: 100vh;
    }
    .graphiql-container {
      --color-primary: 40, 167, 69;
    }
  </style>
  <link rel="stylesheet" href="https://unpkg.com/graphiql@3.0.0/graphiql.min.css" integrity="sha384-8D+CgOsXwzp5mBEyn+QlSFCghSG2zOx6Twnssnq6J81f12aHtpeNU6r2e/+yMxDX" crossorigin="anonymous" />
</head>
<body>
  <div id="graphiql">Loading...</div>
  
  <script
    crossorigin="anonymous"
    integrity="sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z"
    src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"
  ></script>
  <script
    crossorigin="anonymous"
    integrity="sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1"
    src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"
  ></script>
  <script
    crossorigin="anonymous"
    integrity="sha384-Eqxb3y1DI7Ndw2RMd4uMbXrtm6NoEW7ru9Y0D8xr+MEPgEZm74pT38DWgdoLlVNx"
    src="https://unpkg.com/graphiql@3.0.0/graphiql.min.js"
  ></script>

  <script>
    const root = ReactDOM.createRoot(document.getElementById('graphiql'));
    const fetcher = GraphiQL.createFetcher({
      url: ${JSON.stringify(graphqlEndpoint)},
      headers: {
        // Add authorization header from localStorage if available
        get Authorization() {
          const token = localStorage.getItem('graphql-token');
          return token ? \`Bearer \${token}\` : '';
        }
      }
    });

    // Sample query to show on load
    const defaultQuery = \`# Welcome to GraphQL API Documentation
# 
# This is an interactive GraphQL explorer.
# Type queries on the left, see results on the right.
#
# Keyboard shortcuts:
#  - Ctrl/Cmd + Enter: Execute query
#  - Ctrl/Cmd + Space: Auto-complete
#  - Ctrl/Cmd + /: Comment/uncomment
#
# To authenticate:
# 1. Get your JWT token from WorkOS
# 2. Run this in browser console:
#    localStorage.setItem('graphql-token', 'YOUR_JWT_TOKEN')
# 3. Refresh this page

# Example: Get your user profile
query Me {
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

# Example: Update your account (both user and profile)
# mutation UpdateMyAccount {
#   updateMyAccount(
#     user: { firstName: "John", lastName: "Doe" }
#     profile: { preferredName: "Johnny" }
#   ) {
#     user {
#       id
#       firstName
#       lastName
#     }
#     profile {
#       userId
#       preferredName
#     }
#   }
# }

# Example: List uploaded images
# query GetImages {
#   images(limit: 10) {
#     images {
#       key
#       url
#       size
#       lastModified
#       category
#     }
#     count
#     hasMore
#   }
# }
\`;

    root.render(
      React.createElement(GraphiQL, {
        fetcher,
        defaultQuery,
        defaultEditorToolsVisibility: true,
        headerEditorEnabled: true,
        shouldPersistHeaders: true,
      })
    );

    // Add auth helper to console
    console.log('%c🔐 Authentication Helper', 'color: #28a745; font-size: 14px; font-weight: bold');
    console.log('To authenticate, run:');
    console.log('%clocalStorage.setItem("graphql-token", "YOUR_JWT_TOKEN")', 'color: #007bff; font-family: monospace');
    console.log('Then refresh the page.');
  </script>
</body>
</html>
  `.trim();

	return {
		statusCode: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-cache, no-store, must-revalidate",
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options": "DENY",
			"Referrer-Policy": "strict-origin-when-cross-origin",
			"Content-Security-Policy":
				"default-src 'none'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com; connect-src 'self'; img-src 'self' data:;",
		},
		body: html,
	};
};
