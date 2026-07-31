import { isIP } from "node:net";

export type DeployStage = "staging" | "production";

/**
 * Read the first custom-domain pattern from the selected Wrangler environment.
 * This deliberately parses sections line-by-line instead of constructing a
 * regular expression from a command-line stage value.
 */
export function customDomainForStage(
	toml: string,
	stage: DeployStage,
): string | undefined {
	const targetSection = `[[env.${stage}.routes]]`;
	let section = "";

	for (const rawLine of toml.split("\n")) {
		const line = rawLine.trim();
		if (line.startsWith("[[") && line.endsWith("]]")) {
			section = line;
			continue;
		}
		if (section !== targetSection) continue;
		const pattern = line.match(/^pattern\s*=\s*"([^"]+)"/)?.[1];
		if (pattern) return pattern;
	}

	return undefined;
}

/**
 * Deployment probes may target only a plain public HTTPS origin. Reject URL
 * credentials, paths, alternate ports, IP literals, and internal/single-label
 * hosts before any network request is attempted.
 */
export function normalizePublicHttpsBase(input: string): string {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new Error("Deployment health origin is not a valid URL");
	}

	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.port ||
		(url.pathname !== "/" && url.pathname !== "") ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"Deployment health origin must be a plain https:// hostname with no credentials, port, path, query, or fragment",
		);
	}

	const hostname = url.hostname.toLowerCase();
	const labels = hostname.split(".");
	if (
		isIP(hostname) !== 0 ||
		labels.length < 2 ||
		labels.some(
			(label) =>
				!label ||
				label.length > 63 ||
				!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
		)
	) {
		throw new Error("Deployment health origin must use a public DNS hostname");
	}

	return `https://${hostname}`;
}
