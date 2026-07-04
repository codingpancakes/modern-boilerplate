import type { Pool } from "pg";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

/**
 * Request-level integration tests for the media upload routes.
 *
 * Drives the REAL exported `app` (same seams as http-routes.test.ts: getDb →
 * node-postgres, verifyWorkosToken → fixed claims) with a FAKE R2 binding
 * (`env.IMAGES`) so the direct-upload path runs end-to-end without real R2.
 *
 * The point of this file is the wiring the unit tests can't prove: that the
 * route actually INVOKES magic-byte validation, content-type/extension
 * matching, the size cap, and user-scoped key generation. Deleting any of
 * those calls in routes/media.ts must fail a test here.
 */

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/lib/db", async () => {
	const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
	return { ...actual, getDb: getDbMock };
});

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));
vi.mock("@/authorizers/verify-token", async () => {
	const actual = await vi.importActual<
		typeof import("@/authorizers/verify-token")
	>("@/authorizers/verify-token");
	return { ...actual, verifyWorkosToken: verifyTokenMock };
});

import { app } from "@/app";
import { auditLogs, authIdentities, profiles, users } from "@/db/schema/index";
import {
	createTestDb,
	type TestDb,
	truncateAuditLogs,
	truncateUserGraph,
} from "./helpers/test-db";

let db: TestDb;
let pool: Pool;

const SUBJECT_A = "user_workos_media_a";
const SUBJECT_B = "user_workos_media_b";

const ctx = {
	waitUntil: () => {},
	passThroughOnException: () => {},
	// biome-ignore lint/suspicious/noExplicitAny: minimal ExecutionContext stub
} as any;

/** An in-memory stand-in for the R2 bucket binding, recording put() calls. */
function fakeBucket() {
	const puts: Array<{ key: string; options: unknown }> = [];
	return {
		puts,
		binding: {
			put: (key: string, _body: unknown, options: unknown) => {
				puts.push({ key, options });
				return Promise.resolve({ key });
			},
			// biome-ignore lint/suspicious/noExplicitAny: partial R2 binding stub
		} as any,
	};
}

function pngBase64(byteLength = 64): string {
	const buf = Buffer.alloc(byteLength);
	// PNG magic bytes.
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
	return buf.toString("base64");
}

function jpegBase64(byteLength = 64): string {
	const buf = Buffer.alloc(byteLength);
	Buffer.from([0xff, 0xd8, 0xff]).copy(buf);
	return buf.toString("base64");
}

function uploadDirect(
	body: Record<string, unknown>,
	bucket: ReturnType<typeof fakeBucket>,
): Promise<Response> {
	return Promise.resolve(
		app.fetch(
			new Request("http://localhost/v1/media/upload-image-direct", {
				method: "POST",
				headers: {
					authorization: "Bearer test-token",
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			}),
			{ IMAGES: bucket.binding } as Parameters<typeof app.fetch>[1],
			ctx,
		),
	);
}

async function seedUser(subject: string, email: string): Promise<string> {
	const [user] = await db
		.insert(users)
		.values({ email, type: "MEMBER" })
		.returning();
	if (!user) throw new Error("failed to seed user");
	await db.insert(profiles).values({ userId: user.id });
	await db.insert(authIdentities).values({
		userId: user.id,
		providerType: "workos",
		providerSubject: subject,
	});
	return user.id;
}

function actAs(subject: string, email: string) {
	verifyTokenMock.mockResolvedValue({
		sub: subject,
		iss: "https://api.workos.com/",
		email,
	});
}

beforeAll(async () => {
	({ db, pool } = await createTestDb());
	getDbMock.mockResolvedValue(db);
	process.env.STAGE = "local";
	process.env.IMAGES_BUCKET = "test-bucket";
	process.env.IMAGES_CDN_URL = "https://cdn.example.com";
}, 60_000);

afterAll(async () => {
	await pool?.end();
	delete process.env.IMAGES_BUCKET;
	delete process.env.IMAGES_CDN_URL;
});

beforeEach(async () => {
	await truncateUserGraph(pool);
	await truncateAuditLogs(pool);
});

afterEach(() => {
	getDbMock.mockResolvedValue(db);
});

describe("POST /v1/media/upload-image-direct", () => {
	it("stores a valid PNG under a user-scoped key and audits it", async () => {
		const userId = await seedUser(SUBJECT_A, "a@example.com");
		actAs(SUBJECT_A, "a@example.com");
		const bucket = fakeBucket();

		const res = await uploadDirect(
			{
				filename: "photo.png",
				contentType: "image/png",
				imageData: pngBase64(),
				category: "profile",
			},
			bucket,
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.key).toMatch(new RegExp(`^users/${userId}/profile/`));
		expect(body.data.imageUrl).toBe(
			`https://cdn.example.com/${body.data.key}`,
		);

		// The object was actually written to the binding under that exact key.
		expect(bucket.puts).toHaveLength(1);
		expect(bucket.puts[0].key).toBe(body.data.key);

		const audit = await db.select().from(auditLogs);
		expect(audit).toHaveLength(1);
		expect(audit[0]?.resourceType).toBe("MEDIA");
		expect(audit[0]?.resourceId).toBe(body.data.key);
	});

	it("rejects bytes that don't match the declared content type (magic-byte check is wired)", async () => {
		await seedUser(SUBJECT_A, "a@example.com");
		actAs(SUBJECT_A, "a@example.com");
		const bucket = fakeBucket();

		// Declared PNG + .png extension, but the bytes are a JPEG.
		const res = await uploadDirect(
			{
				filename: "fake.png",
				contentType: "image/png",
				imageData: jpegBase64(),
			},
			bucket,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/does not match the declared content type/);
		// Nothing was written.
		expect(bucket.puts).toHaveLength(0);
	});

	it("rejects a content-type / extension mismatch", async () => {
		await seedUser(SUBJECT_A, "a@example.com");
		actAs(SUBJECT_A, "a@example.com");
		const bucket = fakeBucket();

		const res = await uploadDirect(
			{
				filename: "photo.png",
				contentType: "image/jpeg",
				imageData: jpegBase64(),
			},
			bucket,
		);

		expect(res.status).toBe(400);
		expect(bucket.puts).toHaveLength(0);
	});

	it("rejects an oversized direct upload (size cap is wired)", async () => {
		await seedUser(SUBJECT_A, "a@example.com");
		actAs(SUBJECT_A, "a@example.com");
		const bucket = fakeBucket();

		const res = await uploadDirect(
			{
				filename: "big.png",
				contentType: "image/png",
				imageData: pngBase64(5 * 1024 * 1024), // > 4.5MB decoded
			},
			bucket,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/exceeds maximum allowed size/);
		expect(bucket.puts).toHaveLength(0);
	});

	it("scopes keys per user — one caller can never write under another's prefix", async () => {
		const userA = await seedUser(SUBJECT_A, "a@example.com");
		const userB = await seedUser(SUBJECT_B, "b@example.com");
		expect(userA).not.toBe(userB);

		actAs(SUBJECT_A, "a@example.com");
		const bucketA = fakeBucket();
		const resA = await uploadDirect(
			{ filename: "a.png", contentType: "image/png", imageData: pngBase64() },
			bucketA,
		);
		const bodyA = await resA.json();

		actAs(SUBJECT_B, "b@example.com");
		const bucketB = fakeBucket();
		const resB = await uploadDirect(
			{ filename: "b.png", contentType: "image/png", imageData: pngBase64() },
			bucketB,
		);
		const bodyB = await resB.json();

		// Each key is derived from the VERIFIED caller's own id, never the input.
		expect(bodyA.data.key).toMatch(new RegExp(`^users/${userA}/`));
		expect(bodyB.data.key).toMatch(new RegExp(`^users/${userB}/`));
		expect(bodyA.data.key).not.toContain(userB);
		expect(bodyB.data.key).not.toContain(userA);
	});

	it("requires authentication", async () => {
		const bucket = fakeBucket();
		const res = await Promise.resolve(
			app.fetch(
				new Request("http://localhost/v1/media/upload-image-direct", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						filename: "photo.png",
						contentType: "image/png",
						imageData: pngBase64(),
					}),
				}),
				{ IMAGES: bucket.binding } as Parameters<typeof app.fetch>[1],
				ctx,
			),
		);

		expect(res.status).toBe(401);
		expect(bucket.puts).toHaveLength(0);
	});
});
