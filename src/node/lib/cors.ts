/**
 * Dynamic CORS handler for multi-tenant architecture
 */

// Environment-based configuration
const EXACT_ORIGINS = new Set(
  (process.env.CORS_EXACT_ORIGINS ?? 'https://railbranch.ai,https://railbranch.com')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase())
);

const PARENT_DOMAINS = new Set(
  (process.env.CORS_PARENT_DOMAINS ?? 'railbranch.ai,railbranch.com')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase())
);

// Dev convenience
const DEV = process.env.NODE_ENV !== 'production';
const DEV_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173']);

// Allowed methods and headers
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_REQ_HEADERS = [
  'authorization',
  'content-type', 
  'idempotency-key',
  'x-requested-with',
  'x-api-key',
  'x-secret-token',
  'x-webhook-signature',
  'x-request-id',
  'x-csrf-token'
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
  
  // Scheme policy: require HTTPS in prod; allow HTTP only for known dev origins
  if (url.protocol !== 'https:') {
    if (!DEV || !DEV_ORIGINS.has(normalized)) return false;
  }

  // Check exact origins
  if (EXACT_ORIGINS.has(normalized)) return true;
  if (DEV && DEV_ORIGINS.has(normalized)) return true;

  // Check parent domains (allow subdomains)
  const hostname = url.hostname.toLowerCase();
  for (const parentDomain of Array.from(PARENT_DOMAINS)) {
    if (hostname === parentDomain || hostname.endsWith(`.${parentDomain}`)) {
      return true;
    }
  }

  return false;
}

export function getCorsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Vary': 'Origin', // Always include for CDN cache safety
  };

  if (!origin || !isAllowedOrigin(origin)) {
    return headers;
  }

  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Methods'] = ALLOWED_METHODS.join(',');
  headers['Access-Control-Allow-Headers'] = ALLOWED_REQ_HEADERS.join(',');
  headers['Access-Control-Max-Age'] = '600'; // 10 minutes

  return headers;
}

/**
 * CORS headers for external webhook/service endpoints
 * Allows specific external origins that need to call your APIs
 */
export function getExternalCorsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (!origin) {
    return headers;
  }

  // Check if origin matches external service patterns
  const isAllowedExternalOrigin = 
    // Your existing allowed origins
    /^https:\/\/[a-zA-Z0-9-]+\.sesion\.day$/.test(origin) ||
    /^https:\/\/[a-zA-Z0-9-]+\.railbranch\.com$/.test(origin) ||
    origin === 'https://railbranch.ai' ||
    origin === 'https://railbranch.com' ||
    /^http:\/\/localhost:\d+$/.test(origin) ||
    // External service origins
    /^https:\/\/.*\.stripe\.com$/.test(origin) ||
    /^https:\/\/.*\.twilio\.com$/.test(origin) ||
    /^https:\/\/.*\.sendgrid\.com$/.test(origin) ||
    /^https:\/\/.*\.workos\.com$/.test(origin) ||
    /^https:\/\/.*\.github\.com$/.test(origin) ||
    /^https:\/\/.*\.slack\.com$/.test(origin) ||
    // Add more external services as needed
    origin === 'https://api.external-service.com';

  if (isAllowedExternalOrigin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, Idempotency-Key, X-Requested-With, X-API-Key, X-Secret-Token, X-Webhook-Signature';
    headers['Access-Control-Max-Age'] = '86400';
  }

  return headers;
}

/**
 * CORS headers that allow ANY origin (use sparingly for public webhooks)
 */
export function getOpenCorsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Requested-With, X-API-Key, X-Secret-Token, X-Webhook-Signature',
    'Access-Control-Max-Age': '86400',
  };
}

function toLowerHeaderList(val: string): string[] {
  return val
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}

export function handleOptionsRequest(origin: string | undefined, requestHeaders?: Record<string, string>) {
  const base = getCorsHeaders(origin);
  
  // Validate requested method
  const reqMethod = requestHeaders?.['access-control-request-method'] ||
                    requestHeaders?.['Access-Control-Request-Method'];
  if (reqMethod && !ALLOWED_METHODS.includes(reqMethod.toUpperCase())) {
    return {
      statusCode: 405,
      headers: { ...base },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Validate requested headers (subset of allowed)
  const reqHeaders = requestHeaders?.['access-control-request-headers'] ||
                     requestHeaders?.['Access-Control-Request-Headers'];
  if (reqHeaders) {
    const requested = toLowerHeaderList(reqHeaders);
    const notAllowed = requested.filter(h => !ALLOWED_REQ_HEADERS.includes(h));
    if (notAllowed.length) {
      return {
        statusCode: 400,
        headers: { ...base },
        body: JSON.stringify({ error: 'Headers not allowed', rejected: notAllowed }),
      };
    }
    // Echo the allowed requested headers to match browser expectations
    base['Access-Control-Allow-Headers'] = requested.join(',');
  }

  return {
    statusCode: 204,
    headers: { ...base },
    body: '',
  };
}

export function handleExternalOptionsRequest(origin: string | undefined) {
  return {
    statusCode: 200,
    headers: getExternalCorsHeaders(origin),
    body: '',
  };
}

export function handleOpenOptionsRequest() {
  return {
    statusCode: 200,
    headers: getOpenCorsHeaders(),
    body: '',
  };
}
