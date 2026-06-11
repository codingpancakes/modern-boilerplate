import { describe, expect, it } from "vitest";
import {
	createPaginatedResponse,
	decodeCursor,
	encodeCursor,
} from "@/lib/pagination";

describe("pagination cursors", () => {
	describe("encodeCursor / decodeCursor round-trip", () => {
		it("preserves a microsecond-precision ISO timestamp losslessly", () => {
			const createdAt = "2026-06-11T10:00:00.123456Z";
			const decoded = decodeCursor(encodeCursor(createdAt, "row-1"));

			expect(decoded).toEqual({ createdAt, id: "row-1" });
		});

		it("preserves the Postgres text timestamp format losslessly", () => {
			// Drizzle `mode: "string"` returns the raw pg text representation.
			const createdAt = "2026-06-11 10:00:00.123456+00";
			const decoded = decodeCursor(encodeCursor(createdAt, "row-1"));

			expect(decoded).toEqual({ createdAt, id: "row-1" });
		});

		it("produces base64url output (no padding or url-unsafe chars)", () => {
			const cursor = encodeCursor("2026-06-11T10:00:00.123456Z", "row-1");
			expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
		});

		it("preserves ids containing underscores", () => {
			const decoded = decodeCursor(
				encodeCursor("2026-06-11T10:00:00.000001Z", "user_abc_123"),
			);
			expect(decoded?.id).toBe("user_abc_123");
		});
	});

	describe("same-millisecond, different-microsecond ordering", () => {
		it("keeps rows in the same millisecond distinguishable and ordered", () => {
			// Both timestamps collapse to the same value at JS Date (ms) precision —
			// the old numeric cursor could not tell them apart.
			const earlier = "2026-06-11 10:00:00.123400+00";
			const later = "2026-06-11 10:00:00.123456+00";
			expect(new Date(earlier).getTime()).toBe(new Date(later).getTime());

			const decodedEarlier = decodeCursor(encodeCursor(earlier, "a"));
			const decodedLater = decodeCursor(encodeCursor(later, "a"));

			expect(decodedEarlier?.createdAt).not.toBe(decodedLater?.createdAt);
			// String comparison on the uniform pg text format matches Postgres
			// timestamp ordering, so the keyset `>` boundary excludes/includes
			// the right rows.
			expect(
				(decodedEarlier?.createdAt ?? "") < (decodedLater?.createdAt ?? ""),
			).toBe(true);
		});
	});

	describe("legacy v1 cursor compatibility", () => {
		it("decodes a v1 'epochMillis_id' cursor at ms precision", () => {
			const legacy = Buffer.from("1781172000123_row-9").toString("base64url");

			expect(decodeCursor(legacy)).toEqual({
				createdAt: new Date(1781172000123).toISOString(),
				id: "row-9",
			});
		});

		it("rejects a v1 cursor with a non-numeric timestamp", () => {
			const legacy = Buffer.from("12abc_row-9").toString("base64url");
			expect(decodeCursor(legacy)).toBeNull();
		});
	});

	describe("malformed cursor rejection", () => {
		it.each([
			["empty string", ""],
			["not base64 of anything structured", "!!!not-base64!!!"],
			["base64 of plain text", Buffer.from("hello").toString("base64url")],
			[
				"base64 of truncated JSON",
				Buffer.from('{"v":2,"createdAt":').toString("base64url"),
			],
			[
				"JSON missing id",
				Buffer.from(
					JSON.stringify({ v: 2, createdAt: "2026-06-11T10:00:00.123456Z" }),
				).toString("base64url"),
			],
			[
				"JSON with empty id",
				Buffer.from(
					JSON.stringify({
						v: 2,
						createdAt: "2026-06-11T10:00:00.123456Z",
						id: "",
					}),
				).toString("base64url"),
			],
			[
				"JSON with non-string createdAt",
				Buffer.from(
					JSON.stringify({ v: 2, createdAt: 1781172000123, id: "row-1" }),
				).toString("base64url"),
			],
			[
				"JSON with unparseable createdAt",
				Buffer.from(
					JSON.stringify({ v: 2, createdAt: "not-a-date", id: "row-1" }),
				).toString("base64url"),
			],
			[
				"JSON with unknown version",
				Buffer.from(
					JSON.stringify({
						v: 99,
						createdAt: "2026-06-11T10:00:00.123456Z",
						id: "row-1",
					}),
				).toString("base64url"),
			],
			["JSON array", Buffer.from("[1,2]").toString("base64url")],
		])("returns null for %s", (_label, cursor) => {
			expect(decodeCursor(cursor)).toBeNull();
		});
	});

	describe("createPaginatedResponse", () => {
		const row = (id: string, createdAt: string) => ({ id, createdAt });

		it("encodes the last item's stored createdAt verbatim in nextCursor", () => {
			const items = [
				row("a", "2026-06-11 10:00:00.123400+00"),
				row("b", "2026-06-11 10:00:00.123456+00"),
				row("c", "2026-06-11 10:00:00.123457+00"),
			];

			const response = createPaginatedResponse(items, 2);

			expect(response.hasMore).toBe(true);
			expect(response.items).toHaveLength(2);
			expect(response.nextCursor).toBeDefined();
			expect(decodeCursor(response.nextCursor ?? "")).toEqual({
				createdAt: "2026-06-11 10:00:00.123456+00",
				id: "b",
			});
		});

		it("omits nextCursor when there are no more pages", () => {
			const items = [row("a", "2026-06-11 10:00:00.123456+00")];

			const response = createPaginatedResponse(items, 2);

			expect(response).toEqual({
				items,
				nextCursor: undefined,
				hasMore: false,
			});
		});
	});
});
