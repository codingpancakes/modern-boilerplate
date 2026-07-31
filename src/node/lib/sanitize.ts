/**
 * Input Sanitization Utilities
 *
 * Structural sanitization for user-provided data that is about to be
 * PERSISTED: control-character removal, HTML tag stripping, URL scheme
 * validation, length caps.
 *
 * Deliberately NOT entity-escaping: stored data stays plain text exactly as
 * the user meant it (`O'Brien` is `O'Brien`, `A & B Co` is `A & B Co`).
 * Escaping is a RENDER-time concern — escaping at rest corrupts search and
 * uniqueness semantics and double-escapes on every read-modify-write
 * round-trip. Use {@link escapeHtml} at the point a value is interpolated
 * into HTML.
 */

/**
 * Sanitize a plain-text string for persistence.
 *
 * Always removes control characters and HTML tags (including script/style
 * blocks with their contents); with `allowHtml: true` a whitelist of
 * formatting tags survives instead (for rich-text fields). Never
 * entity-escapes — see the module docblock.
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

	// Remove NUL and C0 control characters (keep \t \r \n — ordinary
	// whitespace, optionally handled below).
	// biome-ignore lint/suspicious/noControlCharactersInRegex: that's the point
	sanitized = sanitized.replace(/[\0\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

	sanitized = options.allowHtml
		? stripUnsafeTags(sanitized)
		: stripAllTags(sanitized);

	// Trim whitespace (after tag stripping, which can expose leading/trailing
	// whitespace that surrounded a removed tag)
	sanitized = sanitized.trim();

	// Strip newlines if requested
	if (options.stripNewlines) {
		sanitized = sanitized.replace(/[\r\n]/g, " ");
	}

	// Enforce max length
	if (options.maxLength && sanitized.length > options.maxLength) {
		sanitized = sanitized.substring(0, options.maxLength);
	}

	return sanitized;
}

/**
 * Remove every HTML tag; script/style blocks lose their CONTENTS too (the
 * text inside them is code, not prose). Idempotent — running it twice never
 * changes the result again, unlike escaping. Non-markup uses of `<` with no
 * closing `>` ("a < b", "I <3 you") survive untouched.
 */
function stripAllTags(input: string): string {
	return filterMarkup(input, false);
}

const SAFE_TAGS = new Set([
	"a",
	"b",
	"blockquote",
	"br",
	"code",
	"em",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"i",
	"li",
	"ol",
	"p",
	"pre",
	"span",
	"strong",
	"ul",
]);

interface MarkupToken {
	closing: boolean;
	end: number;
	name: string;
}

/** Parse one tag without using regex-based HTML filtering. */
function markupTokenAt(input: string, start: number): MarkupToken | undefined {
	if (input[start] !== "<") return undefined;
	let cursor = start + 1;
	while (cursor < input.length && /\s/.test(input[cursor] ?? "")) cursor++;
	const closing = input[cursor] === "/";
	if (closing) {
		cursor++;
		while (cursor < input.length && /\s/.test(input[cursor] ?? "")) cursor++;
	}
	const nameStart = cursor;
	while (cursor < input.length && /[a-zA-Z0-9]/.test(input[cursor] ?? "")) {
		cursor++;
	}
	if (cursor === nameStart || !/[a-zA-Z]/.test(input[nameStart] ?? "")) {
		return undefined;
	}
	const name = input.slice(nameStart, cursor).toLowerCase();

	let quote: '"' | "'" | undefined;
	for (; cursor < input.length; cursor++) {
		const char = input[cursor];
		if (quote) {
			if (char === quote) quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === ">") {
			return {
				closing,
				end: cursor + 1,
				name,
			};
		}
	}
	return undefined;
}

/**
 * Tokenize markup, discard script/style blocks, and optionally reconstruct a
 * formatting-only whitelist with every attribute removed.
 */
function filterMarkup(input: string, allowSafeTags: boolean): string {
	let output = "";
	let suppressed: "script" | "style" | undefined;
	let cursor = 0;

	while (cursor < input.length) {
		if (input[cursor] !== "<") {
			if (!suppressed) output += input[cursor];
			cursor++;
			continue;
		}

		const token = markupTokenAt(input, cursor);
		if (!token) {
			if (!suppressed) output += "<";
			cursor++;
			continue;
		}
		cursor = token.end;

		if (token.name === "script" || token.name === "style") {
			if (token.closing && suppressed === token.name) suppressed = undefined;
			else if (!token.closing && !suppressed) suppressed = token.name;
			continue;
		}
		if (suppressed) continue;
		if (allowSafeTags && SAFE_TAGS.has(token.name)) {
			output += `<${token.closing ? "/" : ""}${token.name}>`;
		}
	}

	return output;
}

/**
 * Strip all HTML tags except a safe formatting whitelist.
 * Reconstruct surviving tags without attributes, so event handlers, styles,
 * and dangerous URL schemes cannot cross the persistence boundary.
 */
function stripUnsafeTags(input: string): string {
	return filterMarkup(input, true);
}

/**
 * Escape HTML special characters to prevent XSS.
 *
 * RENDER-time utility: call this where a stored value is interpolated into
 * HTML (emails, server-rendered pages). Data at rest is stored unescaped —
 * see the module docblock.
 *
 * @param input - The string to escape
 * @returns HTML-escaped string
 */
export function escapeHtml(input: string): string {
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
// Keys whose string values are treated as URLs (scheme-validated) rather than
// run through tag/control-char stripping.
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

	// For absolute URLs, require HTTPS. URL-like keys are often later used as
	// redirects, images, or fetch targets; preserving http:// would create an
	// unnecessary downgrade/open-redirect footgun.
	if (value.includes("://")) {
		try {
			const parsed = new URL(value);
			if (parsed.protocol !== "https:") {
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
	// Fail closed past the depth cap (consistent with sanitizeObject) — drop the
	// over-deep array rather than returning it unsanitized.
	if (depth >= MAX_SANITIZE_DEPTH) return [];

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
