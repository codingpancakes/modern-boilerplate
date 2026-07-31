interface ActiveVersion {
	version_id: string;
	percentage: number;
}

function isActiveVersion(value: unknown): value is ActiveVersion {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { version_id?: unknown }).version_id === "string" &&
		typeof (value as { percentage?: unknown }).percentage === "number"
	);
}

/**
 * Resolve the highest-traffic Worker version from Wrangler's deployment-status
 * response. An explicitly empty array is the only "first deploy" signal;
 * malformed or incomplete responses throw so deployment safety fails closed.
 */
export function parseActiveVersionId(response: unknown): string | null {
	if (
		typeof response !== "object" ||
		response === null ||
		!("versions" in response)
	) {
		throw new Error(
			"Could not determine the active Worker version: invalid Wrangler response",
		);
	}

	const versions = (response as { versions?: unknown }).versions;
	if (!Array.isArray(versions)) {
		throw new Error(
			"Could not determine the active Worker version: versions is not an array",
		);
	}
	if (!versions.every(isActiveVersion)) {
		throw new Error(
			"Could not determine the active Worker version: malformed version entry",
		);
	}
	if (versions.length === 0) return null;

	return versions.reduce((active, candidate) =>
		candidate.percentage > active.percentage ? candidate : active,
	).version_id;
}
