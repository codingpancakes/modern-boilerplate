/**
 * Input Sanitization Utilities
 *
 * Provides XSS prevention and input sanitization for user-provided data.
 */

/**
 * Sanitize string input to prevent XSS attacks
 *
 * Removes or escapes potentially dangerous characters and HTML tags
 *
 * @param input - The string to sanitize
 * @param options - Sanitization options
 * @returns Sanitized string
 */
export function sanitizeString(
	input: string,
	options: {
		allowHtml?: boolean;
		maxLength?: number;
		stripNewlines?: boolean;
	} = {},
): string {
	if (typeof input !== "string") {
		return "";
	}

	let sanitized = input;

	// Trim whitespace
	sanitized = sanitized.trim();

	// Enforce max length
	if (options.maxLength && sanitized.length > options.maxLength) {
		sanitized = sanitized.substring(0, options.maxLength);
	}

	// Strip newlines if requested
	if (options.stripNewlines) {
		sanitized = sanitized.replace(/[\r\n]/g, " ");
	}

	if (!options.allowHtml) {
		sanitized = escapeHtml(sanitized);
	} else {
		sanitized = stripUnsafeTags(sanitized);
	}

	return sanitized;
}

const SAFE_TAG_RE =
	/^\/?(b|i|em|strong|p|br|ul|ol|li|a|span|blockquote|code|pre|h[1-6])$/i;

/**
 * Strip all HTML tags except a safe formatting whitelist.
 * Also strips event-handler attributes (on*) from surviving tags.
 */
function stripUnsafeTags(input: string): string {
	return input
		.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag: string) => {
			if (!SAFE_TAG_RE.test(tag)) return "";
			return match.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
		})
		.replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s>][\s\S]*?<\/style>/gi, "");
}

/**
 * Escape HTML special characters to prevent XSS
 *
 * @param input - The string to escape
 * @returns HTML-escaped string
 */
function escapeHtml(input: string): string {
	const htmlEscapeMap: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#x27;",
		"/": "&#x2F;",
	};

	return input.replace(/[&<>"'/]/g, (char) => htmlEscapeMap[char] || char);
}

/**
 * Sanitize filename to prevent path traversal and other attacks
 *
 * @param filename - The filename to sanitize
 * @param options - Sanitization options
 * @returns Sanitized filename
 */
export function sanitizeFilename(
	filename: string,
	options: {
		maxLength?: number;
		allowedExtensions?: readonly string[];
	} = {},
): string {
	if (typeof filename !== "string") {
		return "file";
	}

	let sanitized = filename;

	// Remove path separators and null bytes
	sanitized = sanitized.replace(/[/\\:\0]/g, "_");

	// Remove leading dots (hidden files)
	sanitized = sanitized.replace(/^\.+/, "");

	// Replace multiple dots with single dot
	sanitized = sanitized.replace(/\.{2,}/g, ".");

	// Remove non-alphanumeric characters except dots, dashes, and underscores
	sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, "_");

	// Enforce max length (default 255)
	const maxLength = options.maxLength || 255;
	if (sanitized.length > maxLength) {
		const dotIndex = sanitized.lastIndexOf(".");
		if (dotIndex > 0) {
			const extension = sanitized.substring(dotIndex + 1);
			const nameWithoutExt = sanitized.substring(0, dotIndex);
			const maxNameLength = maxLength - extension.length - 1;
			sanitized = `${nameWithoutExt.substring(0, Math.max(1, maxNameLength))}.${extension}`;
		} else {
			sanitized = sanitized.substring(0, maxLength);
		}
	}

	// Validate extension if allowedExtensions provided
	if (options.allowedExtensions && options.allowedExtensions.length > 0) {
		const extension = sanitized.split(".").pop()?.toLowerCase() || "";
		if (!options.allowedExtensions.includes(extension)) {
			throw new Error(`File extension .${extension} is not allowed`);
		}
	}

	// Ensure filename is not empty
	if (!sanitized || sanitized === ".") {
		sanitized = "file";
	}

	return sanitized;
}

/**
 * Sanitize object by recursively sanitizing all string values
 *
 * @param obj - The object to sanitize
 * @param options - Sanitization options
 * @returns Sanitized object
 */
// Keys whose string values should NOT be HTML-escaped (URLs, JSON, etc.)
const RAW_STRING_KEYS = new Set([
	"photoUrl",
	"photo_url",
	"imageUrl",
	"image_url",
	"avatarUrl",
	"avatar_url",
	"url",
	"href",
	"src",
	"callback",
	"callbackUrl",
	"callback_url",
	"redirectUrl",
	"redirect_url",
	"websiteUrl",
	"website_url",
]);

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "blob:"]);

/**
 * Sanitize a URL value: block dangerous schemes and validate structure.
 * Returns empty string if the URL is malicious or malformed.
 */
function sanitizeUrlValue(value: string): string {
	if (!value) return "";
	const lower = value.toLowerCase();

	for (const scheme of BLOCKED_SCHEMES) {
		if (lower.startsWith(scheme)) return "";
	}

	// Block protocol-relative URLs (//host/path)
	if (value.startsWith("//")) return "";

	// For absolute URLs, validate they have a proper http(s) scheme
	if (value.includes("://")) {
		try {
			const parsed = new URL(value);
			if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
				return "";
			}
		} catch {
			return "";
		}
	}

	return value;
}

/**
 * Maximum nesting depth `sanitizeObject` will descend into. Bounds the
 * recursion so a pathological/deeply-nested payload can't blow the stack
 * (mirrors `redactSensitive`'s depth guard in audit.ts). Beyond the cap we stop
 * descending and return the sub-tree untouched rather than recursing further.
 */
// Above the validation layer's max nesting (10) so every Zod-accepted payload
// is fully sanitized; this is only a stack-overflow backstop, not a functional
// limit. Past it we fail CLOSED (drop the subtree) rather than passing raw,
// unsanitized data through to a DB write.
const MAX_SANITIZE_DEPTH = 12;

interface SanitizeOptions {
	maxStringLength?: number;
	allowHtml?: boolean;
	rawKeys?: Set<string>;
}

export function sanitizeObject<T extends Record<string, unknown>>(
	obj: T,
	options: SanitizeOptions = {},
	depth = 0,
): T {
	// Fail closed: drop an over-deep subtree rather than return it unsanitized.
	if (depth >= MAX_SANITIZE_DEPTH) return {} as T;

	const skipEscape = options.rawKeys ?? RAW_STRING_KEYS;
	const sanitized: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(obj)) {
		if (typeof value === "string") {
			if (skipEscape.has(key)) {
				const trimmed = value.trim();
				sanitized[key] = sanitizeUrlValue(trimmed);
			} else {
				sanitized[key] = sanitizeString(value, {
					maxLength: options.maxStringLength,
					allowHtml: options.allowHtml,
				});
			}
		} else if (value && typeof value === "object" && !Array.isArray(value)) {
			sanitized[key] = sanitizeObject(
				value as Record<string, unknown>,
				options,
				depth + 1,
			);
		} else if (Array.isArray(value)) {
			sanitized[key] = sanitizeArray(value, options, depth + 1);
		} else {
			sanitized[key] = value;
		}
	}

	return sanitized as T;
}

function sanitizeArray(
	arr: unknown[],
	options: SanitizeOptions,
	depth: number,
): unknown[] {
	if (depth >= MAX_SANITIZE_DEPTH) return arr;

	return arr.map((item) => {
		if (typeof item === "string") {
			return sanitizeString(item, {
				maxLength: options.maxStringLength,
				allowHtml: options.allowHtml,
			});
		}
		if (Array.isArray(item)) {
			return sanitizeArray(item, options, depth + 1);
		}
		if (item && typeof item === "object") {
			return sanitizeObject(
				item as Record<string, unknown>,
				options,
				depth + 1,
			);
		}
		return item;
	});
}

/**
 * File upload size limits (in bytes)
 */
export const FILE_SIZE_LIMITS = {
	IMAGE: 15 * 1024 * 1024, // 15 MB — covers high-res mobile photos (iPhone ~3-8 MB)
	DOCUMENT: 25 * 1024 * 1024, // 25 MB
	VIDEO: 100 * 1024 * 1024, // 100 MB
	AVATAR: 2 * 1024 * 1024, // 2 MB
} as const;

/**
 * Allowed file extensions by category
 */
export const ALLOWED_FILE_EXTENSIONS = {
	IMAGE: ["jpg", "jpeg", "png", "gif", "webp"],
	DOCUMENT: ["pdf", "doc", "docx", "txt", "csv", "xls", "xlsx"],
	VIDEO: ["mp4", "webm", "mov", "avi"],
	AVATAR: ["jpg", "jpeg", "png", "webp"],
} as const;

/**
 * Validate file extension
 *
 * @param filename - The filename
 * @param category - File category
 * @returns true if valid, false otherwise
 */
export function validateFileExtension(
	filename: string,
	category: keyof typeof ALLOWED_FILE_EXTENSIONS,
): boolean {
	const extension = filename.split(".").pop()?.toLowerCase() || "";
	const allowed = ALLOWED_FILE_EXTENSIONS[category] as readonly string[];
	return allowed.includes(extension);
}
