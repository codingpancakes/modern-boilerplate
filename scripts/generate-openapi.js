const swaggerJsdoc = require("swagger-jsdoc");
const fs = require("fs");
const path = require("path");

function packageNameFallback() {
	try {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
		);
		return typeof pkg.name === "string" && pkg.name.trim()
			? pkg.name.replace(/^@[^/]+\//, "")
			: "serverless-backend";
	} catch {
		return "serverless-backend";
	}
}

// PROJECT_NAME / API_BASE_URL_* may be set in the environment to customize output.
// Without PROJECT_NAME, use package.json so cloned boilerplates do not emit a
// previous project's name in generated docs.
const projectName = process.env.PROJECT_NAME || packageNameFallback();
const localUrl = process.env.API_BASE_URL_LOCAL || "http://localhost:8787";
const stagingUrl = process.env.API_BASE_URL_STAGING || "";
const productionUrl = process.env.API_BASE_URL_PRODUCTION || "";

// OpenAPI configuration
const options = {
	definition: {
		openapi: "3.0.0",
		info: {
			title: `${projectName} API`,
			version: "1.0.0",
			description: "Production-grade serverless REST API on Cloudflare Workers",
		},
		servers: [
			{ url: localUrl, description: "Local development server" },
			...(stagingUrl
				? [{ url: stagingUrl, description: "Staging environment" }]
				: []),
			...(productionUrl
				? [{ url: productionUrl, description: "Production environment" }]
				: []),
		],
		components: {
			securitySchemes: {
				BearerAuth: {
					type: "http",
					scheme: "bearer",
					bearerFormat: "JWT",
					description: "WorkOS JWT token obtained from authentication",
				},
			},
			schemas: {
				SuccessResponse: {
					type: "object",
					properties: {
						success: {
							type: "boolean",
							example: true,
						},
						data: {
							type: "object",
							description: "Response data",
						},
					},
					required: ["success", "data"],
				},
				ErrorResponse: {
					type: "object",
					properties: {
						success: {
							type: "boolean",
							example: false,
						},
						error: {
							type: "string",
							description:
								"Human-readable error message (5xx masked to 'Internal server error' in deployed environments)",
							example: "Validation failed",
						},
						details: {
							type: "object",
							properties: {
								code: {
									type: "string",
									example: "VALIDATION_ERROR",
								},
								requestId: {
									type: "string",
									description: "Correlates the error with server logs",
								},
								timestamp: {
									type: "string",
									format: "date-time",
								},
								extra: {
									description:
										"Additional error context (omitted in deployed environments)",
								},
							},
							required: ["code"],
						},
					},
					required: ["success", "error", "details"],
				},
				PaginatedResponse: {
					type: "object",
					properties: {
						success: {
							type: "boolean",
							example: true,
						},
						data: {
							type: "object",
							properties: {
								items: {
									type: "array",
									items: {
										type: "object",
									},
								},
								nextCursor: {
									type: "string",
									nullable: true,
									description: "Cursor for next page",
								},
								hasMore: {
									type: "boolean",
									description: "Whether more items exist",
								},
							},
						},
					},
				},
			},
			responses: {
				Success: {
					description: "Successful response",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/SuccessResponse",
							},
						},
					},
				},
				BadRequest: {
					description: "Bad Request - Invalid input",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/ErrorResponse",
							},
							example: {
								success: false,
								error: "Invalid input data",
								details: {
									code: "BAD_REQUEST",
								},
							},
						},
					},
				},
				Unauthorized: {
					description: "Unauthorized - Authentication required",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/ErrorResponse",
							},
							example: {
								success: false,
								error: "Authentication required",
								details: {
									code: "UNAUTHORIZED",
								},
							},
						},
					},
				},
				Forbidden: {
					description: "Forbidden - Insufficient permissions",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/ErrorResponse",
							},
							example: {
								success: false,
								error: "Insufficient permissions",
								details: {
									code: "FORBIDDEN",
								},
							},
						},
					},
				},
				NotFound: {
					description: "Not Found - Resource does not exist",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/ErrorResponse",
							},
							example: {
								success: false,
								error: "Resource not found",
								details: {
									code: "NOT_FOUND",
								},
							},
						},
					},
				},
				ServerError: {
					description: "Internal Server Error",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/ErrorResponse",
							},
							example: {
								success: false,
								error: "Internal server error",
								details: {
									code: "INTERNAL_ERROR",
								},
							},
						},
					},
				},
			},
		},
		tags: [
			{
				name: "Users",
				description: "User management and profile operations",
			},
			{
				name: "Media",
				description: "File upload and media management",
			},
			{
				name: "Test",
				description: "Test endpoints for development",
			},
			{
				name: "Utils",
				description: "Utility endpoints (health checks, etc.)",
			},
			{
				name: "Webhooks",
				description: "Webhook handlers for external services",
			},
		],
	},
	// Scan the Hono route modules (the single source of every public path)
	apis: ["./src/node/routes/**/*.ts"],
};

// Generate OpenAPI specification
console.log("🔍 Generating OpenAPI specification...");
console.log("📁 Scanning route files in src/node/routes/");

try {
	const spec = swaggerJsdoc(options);

	// Count endpoints
	const pathCount = Object.keys(spec.paths || {}).length;
	const operationCount = Object.values(spec.paths || {}).reduce(
		(count, path) => {
			return (
				count +
				Object.keys(path).filter((key) =>
					["get", "post", "put", "patch", "delete"].includes(key),
				).length
			);
		},
		0,
	);

	// Write to file
	const outputPath = path.join(__dirname, "../docs/api/openapi.json");
	fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));

	console.log("");
	console.log("✅ OpenAPI specification generated successfully!");
	console.log("");
	console.log(`📊 Statistics:`);
	console.log(`   - Paths: ${pathCount}`);
	console.log(`   - Operations: ${operationCount}`);
	console.log(`   - Tags: ${spec.tags?.length || 0}`);
	console.log("");
	console.log(`📄 Output: ${outputPath}`);
	console.log("");
	console.log("🚀 Next steps:");
	console.log("   - View docs: npm run docs:serve");
	console.log("   - Open browser: http://localhost:3111");
	console.log("");
} catch (error) {
	console.error("");
	console.error("❌ Error generating OpenAPI specification:");
	console.error("");
	console.error(error.message);
	console.error("");
	console.error("💡 Tips:");
	console.error("   - Check @swagger JSDoc comments in route files");
	console.error("   - Ensure YAML syntax is correct");
	console.error("   - Run with DEBUG=swagger-jsdoc:* for detailed logs");
	console.error("");
	process.exit(1);
}
