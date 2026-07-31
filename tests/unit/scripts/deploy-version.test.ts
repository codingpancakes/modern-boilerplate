import { describe, expect, it } from "vitest";
import { parseActiveVersionId } from "../../../scripts/lib/deploy-version";

describe("parseActiveVersionId", () => {
	it("returns the highest-traffic version as the rollback target", () => {
		expect(
			parseActiveVersionId({
				versions: [
					{ version_id: "old", percentage: 90 },
					{ version_id: "canary", percentage: 10 },
				],
			}),
		).toBe("old");
	});

	it("returns null only for an explicitly empty version list", () => {
		expect(parseActiveVersionId({ versions: [] })).toBeNull();
	});

	it.each([
		undefined,
		{},
		{ versions: null },
		{ versions: [{ version_id: "missing-percentage" }] },
	])("fails closed for a malformed Wrangler response: %j", (response) => {
		expect(() => parseActiveVersionId(response)).toThrow(
			"Could not determine the active Worker version",
		);
	});
});
