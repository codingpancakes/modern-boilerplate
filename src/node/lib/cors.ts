/**
 * Dynamic CORS handler for multi-tenant architecture
 */

function exactOrigins(): Set<string> {
	return new Set(
		(process.env.CORS_EXACT_ORIGINS || "")
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean)
			.filter((s) => s.length > 0),
	);
}

function parentDomains(): Set<string> {
	return new Set(
		[
			process.env.CORS_PARENT_DOMAINS || "",
			// CORS_DOMAIN_PATTERNS uses wildcard format (*.example.com) -- strip leading *. for subdomain matching
			...(process.env.CORS_DOMAIN_PATTERNS || "")
				.split(",")
				.map((s) => s.trim().replace(/^\*\./, "")),
		]
			.join(",")
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean)
			.filter((s) => s.length > 0)
			// Reject bare TLDs (e.g. "com", "io") — must contain at least one dot
			.filter((s) => s.includes(".")),
	);
}

function isDevLikeStage(): boolean {
	return (
		process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "staging"
	);
}

const DEV_ORIGINS = new Set([
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"http://localhost:5173",
]);

// Allowed methods and headers
const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_REQ_HEADERS = [
	"authorization",
	"content-type",
	"idempotency-key",
	"x-requested-with",
	"x-api-key",
	"x-secret-token",
	"x-webhook-signature",
	"x-request-id",
];

export function isAllowedOrigin(origin?: string): boolean {
	if (!origin) return false;

	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}

	// Normalize to lowercase
	const normalized = `${url.protocol}//${url.host}`.toLowerCase();
	const dev = isDevLikeStage();

	// Scheme policy: require HTTPS in prod; allow HTTP only for known dev origins
	if (url.protocol !== "https:") {
		if (!dev || !DEV_ORIGINS.has(normalized)) return false;
	}

	// Check exact origins
	if (exactOrigins().has(normalized)) return true;
	if (dev && DEV_ORIGINS.has(normalized)) return true;

	// Check parent domains (allow subdomains)
	const hostname = url.hostname.toLowerCase();
	for (const parentDomain of parentDomains()) {
		if (hostname === parentDomain || hostname.endsWith(`.${parentDomain}`)) {
			return true;
		}
	}

	return false;
}

export function getCorsHeaders(
	origin: string | undefined,
): Record<string, string> {
	// NOTE: no "Content-Type" here. These are applied to every response by the
	// app middleware; forcing application/json would clobber non-JSON responses
	// (GraphiQL HTML, future binary). JSON handlers set it themselves via
	// c.json()/sendSuccess; Content-Type is a content header, not a CORS header.
	const headers: Record<string, string> = {
		Vary: "Origin", // Always include for CDN cache safety
	};

	if (!origin || !isAllowedOrigin(origin)) {
		return headers;
	}

	headers["Access-Control-Allow-Origin"] = origin;
	headers["Access-Control-Allow-Methods"] = ALLOWED_METHODS.join(",");
	headers["Access-Control-Allow-Headers"] = ALLOWED_REQ_HEADERS.join(",");
	headers["Access-Control-Max-Age"] = "600"; // 10 minutes

	return headers;
}

/**
 * CORS headers for external webhook/service endpoints
 * Allows specific external origins that need to call your APIs
 */
export function getExternalCorsHeaders(
	origin: string | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (!origin) {
		return headers;
	}

	// Exact allow-list of known external service origins (no wildcards)
	const ALLOWED_EXTERNAL_ORIGINS = new Set([
		"https://api.workos.com",
		"https://dashboard.workos.com",
		"https://github.com",
		"https://hooks.slack.com",
	]);

	const isAllowedExternalOrigin =
		(isDevLikeStage() && /^http:\/\/localhost:\d+$/.test(origin)) ||
		ALLOWED_EXTERNAL_ORIGINS.has(origin);

	if (isAllowedExternalOrigin) {
		headers["Access-Control-Allow-Origin"] = origin;
		headers["Access-Control-Allow-Methods"] =
			"GET, POST, PUT, PATCH, DELETE, OPTIONS";
		headers["Access-Control-Allow-Headers"] =
			"Authorization, Content-Type, Idempotency-Key, X-Requested-With, X-API-Key, X-Secret-Token, X-Webhook-Signature";
		headers["Access-Control-Max-Age"] = "86400";
	}

	return headers;
}

/**
 * Standard security headers — apply to every response regardless of auth model
 */
export function securityHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	return {
		...headers,
		"Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
		"Referrer-Policy": "strict-origin-when-cross-origin",
		"Permissions-Policy": "geolocation=(), microphone=(), camera=()",
	};
}

function toLowerHeaderList(val: string): string[] {
	return val
		.split(",")
		.map((h) => h.trim().toLowerCase())
		.filter(Boolean);
}

export function handleOptionsRequest(
	origin: string | undefined,
	requestHeaders?: Record<string, string>,
) {
	const base = getCorsHeaders(origin);

	// Validate requested method
	const reqMethod =
		requestHeaders?.["access-control-request-method"] ||
		requestHeaders?.["Access-Control-Request-Method"];
	if (reqMethod && !ALLOWED_METHODS.includes(reqMethod.toUpperCase())) {
		return {
			statusCode: 405,
			headers: { ...base },
			body: JSON.stringify({ error: "Method not allowed" }),
		};
	}

	// Validate requested headers (subset of allowed)
	const reqHeaders =
		requestHeaders?.["access-control-request-headers"] ||
		requestHeaders?.["Access-Control-Request-Headers"];
	if (reqHeaders) {
		const requested = toLowerHeaderList(reqHeaders);
		const notAllowed = requested.filter(
			(h) => !ALLOWED_REQ_HEADERS.includes(h),
		);
		if (notAllowed.length) {
			return {
				statusCode: 400,
				headers: { ...base },
				body: JSON.stringify({ error: "Headers not allowed" }),
			};
		}
		// Echo the allowed requested headers to match browser expectations
		base["Access-Control-Allow-Headers"] = requested.join(",");
	}

	return {
		statusCode: 204,
		headers: { ...base },
		body: "",
	};
}

export function handleExternalOptionsRequest(origin: string | undefined) {
	return {
		statusCode: 200,
		headers: getExternalCorsHeaders(origin),
		body: "",
	};
}
