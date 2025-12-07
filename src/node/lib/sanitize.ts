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

	// Remove or escape HTML if not allowed
	if (!options.allowHtml) {
		sanitized = escapeHtml(sanitized);
	}

	return sanitized;
}

/**
 * Escape HTML special characters to prevent XSS
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
		allowedExtensions?: string[];
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
		const extension = sanitized.split(".").pop() || "";
		const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf("."));
		const maxNameLength = maxLength - extension.length - 1;
		sanitized = `${nameWithoutExt.substring(0, maxNameLength)}.${extension}`;
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
 * Sanitize URL to prevent open redirect and SSRF attacks
 *
 * @param url - The URL to sanitize
 * @param options - Sanitization options
 * @returns Sanitized URL or null if invalid
 */
export function sanitizeUrl(
	url: string,
	options: {
		allowedProtocols?: string[];
		allowedDomains?: string[];
	} = {},
): string | null {
	if (typeof url !== "string") {
		return null;
	}

	const allowedProtocols = options.allowedProtocols || ["http:", "https:"];

	try {
		const parsed = new URL(url);

		// Check protocol
		if (!allowedProtocols.includes(parsed.protocol)) {
			return null;
		}

		// Check domain if allowedDomains provided
		if (options.allowedDomains && options.allowedDomains.length > 0) {
			const hostname = parsed.hostname.toLowerCase();
			const isAllowed = options.allowedDomains.some((domain) => {
				const domainLower = domain.toLowerCase();
				return hostname === domainLower || hostname.endsWith(`.${domainLower}`);
			});

			if (!isAllowed) {
				return null;
			}
		}

		return parsed.toString();
	} catch {
		// Invalid URL
		return null;
	}
}

/**
 * Sanitize object by recursively sanitizing all string values
 *
 * @param obj - The object to sanitize
 * @param options - Sanitization options
 * @returns Sanitized object
 */
export function sanitizeObject<T extends Record<string, unknown>>(
	obj: T,
	options: {
		maxStringLength?: number;
		allowHtml?: boolean;
	} = {},
): T {
	const sanitized: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(obj)) {
		if (typeof value === "string") {
			sanitized[key] = sanitizeString(value, {
				maxLength: options.maxStringLength,
				allowHtml: options.allowHtml,
			});
		} else if (value && typeof value === "object" && !Array.isArray(value)) {
			sanitized[key] = sanitizeObject(
				value as Record<string, unknown>,
				options,
			);
		} else if (Array.isArray(value)) {
			sanitized[key] = value.map((item) => {
				if (typeof item === "string") {
					return sanitizeString(item, {
						maxLength: options.maxStringLength,
						allowHtml: options.allowHtml,
					});
				}
				if (item && typeof item === "object") {
					return sanitizeObject(item as Record<string, unknown>, options);
				}
				return item;
			});
		} else {
			sanitized[key] = value;
		}
	}

	return sanitized as T;
}

/**
 * Validate and sanitize email address
 *
 * @param email - The email to validate
 * @returns Sanitized email or null if invalid
 */
export function sanitizeEmail(email: string): string | null {
	if (typeof email !== "string") {
		return null;
	}

	// Basic email validation regex
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	const trimmed = email.trim().toLowerCase();

	if (!emailRegex.test(trimmed)) {
		return null;
	}

	// Additional checks
	if (trimmed.length > 254) {
		return null; // Max email length per RFC 5321
	}

	return trimmed;
}

/**
 * File upload size limits (in bytes)
 */
export const FILE_SIZE_LIMITS = {
	IMAGE: 10 * 1024 * 1024, // 10 MB
	DOCUMENT: 25 * 1024 * 1024, // 25 MB
	VIDEO: 100 * 1024 * 1024, // 100 MB
	AVATAR: 2 * 1024 * 1024, // 2 MB
} as const;

/**
 * Allowed file extensions by category
 */
export const ALLOWED_FILE_EXTENSIONS = {
	IMAGE: ["jpg", "jpeg", "png", "gif", "webp", "svg"],
	DOCUMENT: ["pdf", "doc", "docx", "txt", "csv", "xls", "xlsx"],
	VIDEO: ["mp4", "webm", "mov", "avi"],
	AVATAR: ["jpg", "jpeg", "png", "webp"],
} as const;

/**
 * Validate file size
 *
 * @param sizeInBytes - File size in bytes
 * @param category - File category
 * @returns true if valid, false otherwise
 */
export function validateFileSize(
	sizeInBytes: number,
	category: keyof typeof FILE_SIZE_LIMITS,
): boolean {
	const limit = FILE_SIZE_LIMITS[category];
	return sizeInBytes > 0 && sizeInBytes <= limit;
}

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

/**
 * Get human-readable file size
 *
 * @param bytes - Size in bytes
 * @returns Human-readable string (e.g., "10 MB")
 */
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 Bytes";

	const k = 1024;
	const sizes = ["Bytes", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
}
