import {
	createLocalJWKSet,
	exportJWK,
	generateKeyPair,
	type JWTVerifyGetKey,
	SignJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyWorkosToken } from "@/authorizers/verify-token";

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

/**
 * Contract test for the shared WorkOS token verifier.
 *
 * This guards the exact regression that shipped on 2026-03-30 and sat broken
 * for ~2 months: requiring an `aud` claim that WorkOS access tokens never
 * carry, which rejected every real token. A real-shaped token (with
 * `client_id`, NO `aud`) MUST be accepted; a wrong/missing `client_id` MUST be
 * rejected. Uses real RS256 signing — no network, no real WorkOS token.
 */

const CLIENT_ID = "client_01TESTCLIENT0000000000000";
const WORKOS_ISSUER = `https://api.workos.com/user_management/${CLIENT_ID}`;
const KID = "test-key-1";

let privateKey: SigningKey;
let jwks: JWTVerifyGetKey;
let otherPrivateKey: SigningKey;

beforeAll(async () => {
	const pair = await generateKeyPair("RS256");
	privateKey = pair.privateKey;
	const pub = await exportJWK(pair.publicKey);
	pub.kid = KID;
	pub.alg = "RS256";
	jwks = createLocalJWKSet({ keys: [pub] });

	// A second keypair NOT present in the JWKS, to simulate a forged signature.
	const other = await generateKeyPair("RS256");
	otherPrivateKey = other.privateKey;
});

interface SignOpts {
	issuer?: string;
	signingKey?: SigningKey;
	expiresIn?: string;
	includeAud?: boolean;
}

async function signToken(
	claims: Record<string, unknown>,
	opts: SignOpts = {},
): Promise<string> {
	const {
		issuer = WORKOS_ISSUER,
		signingKey = privateKey,
		expiresIn = "1h",
		includeAud = false,
	} = opts;

	const jwt = new SignJWT({
		...claims,
		...(includeAud ? { aud: CLIENT_ID } : {}),
	})
		.setProtectedHeader({ alg: "RS256", kid: KID })
		.setIssuedAt()
		.setIssuer(issuer)
		.setExpirationTime(expiresIn);

	return jwt.sign(signingKey);
}

describe("verifyWorkosToken (authorizer contract)", () => {
	it("accepts a real-shaped WorkOS token: client_id present, NO aud claim", async () => {
		const token = await signToken({
			sub: "user_01ABC",
			client_id: CLIENT_ID,
		});

		const claims = await verifyWorkosToken(token, jwks, {
			clientId: CLIENT_ID,
		});

		expect(claims.sub).toBe("user_01ABC");
		expect(claims.client_id).toBe(CLIENT_ID);
		// The exact regression guard: no `aud` was issued, yet it verifies.
		expect(claims.aud).toBeUndefined();
	});

	it("also accepts a token that happens to include an aud claim", async () => {
		const token = await signToken(
			{ sub: "user_01ABC", client_id: CLIENT_ID },
			{ includeAud: true },
		);

		const claims = await verifyWorkosToken(token, jwks, {
			clientId: CLIENT_ID,
		});

		expect(claims.sub).toBe("user_01ABC");
	});

	it("rejects a token whose client_id is for a different app", async () => {
		const token = await signToken({
			sub: "user_01ABC",
			client_id: "client_01SOMEONEELSE",
		});

		await expect(
			verifyWorkosToken(token, jwks, { clientId: CLIENT_ID }),
		).rejects.toThrow(/client_id/);
	});

	it("rejects a token missing the client_id claim entirely", async () => {
		const token = await signToken({ sub: "user_01ABC" });

		await expect(
			verifyWorkosToken(token, jwks, { clientId: CLIENT_ID }),
		).rejects.toThrow(/client_id/);
	});

	it("rejects a token missing the sub claim", async () => {
		const token = await signToken({ client_id: CLIENT_ID });

		await expect(
			verifyWorkosToken(token, jwks, { clientId: CLIENT_ID }),
		).rejects.toThrow(/sub/);
	});

	it("rejects a token from an untrusted issuer", async () => {
		const token = await signToken(
			{ sub: "user_01ABC", client_id: CLIENT_ID },
			{ issuer: "https://evil.example.com/" },
		);

		await expect(
			verifyWorkosToken(token, jwks, { clientId: CLIENT_ID }),
		).rejects.toThrow();
	});

	it("rejects a token signed by a key not in the JWKS (forged signature)", async () => {
		const token = await signToken(
			{ sub: "user_01ABC", client_id: CLIENT_ID },
			{ signingKey: otherPrivateKey },
		);

		await expect(
			verifyWorkosToken(token, jwks, { clientId: CLIENT_ID }),
		).rejects.toThrow();
	});

	it("rejects an expired token", async () => {
		const token = await signToken(
			{ sub: "user_01ABC", client_id: CLIENT_ID },
			{ expiresIn: "-5m" },
		);

		await expect(
			verifyWorkosToken(token, jwks, { clientId: CLIENT_ID }),
		).rejects.toThrow();
	});

	it("skips client binding when clientId is empty (local dev), still enforcing sub + issuer", async () => {
		// With no configured client id, the verifier accepts any client_id but
		// the issuer list still references the default WorkOS issuer.
		const token = await signToken(
			{ sub: "user_01ABC", client_id: "client_anything" },
			{ issuer: "https://api.workos.com/" },
		);

		const claims = await verifyWorkosToken(token, jwks, { clientId: "" });
		expect(claims.sub).toBe("user_01ABC");
	});
});
