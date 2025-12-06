import { beforeAll, afterAll, afterEach, vi } from "vitest";

// Mock environment variables
beforeAll(() => {
	process.env.AWS_REGION = "us-east-1";
	process.env.STAGE = "test";
	process.env.API_VERSION = "v1";
	process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
	process.env.WORKOS_CLIENT_ID = "test-client-id";
	process.env.WORKOS_SECRET_ARN = "test-secret-arn";
	process.env.IMAGES_BUCKET = "test-bucket";
	process.env.IMAGES_CDN_URL = "https://test-cdn.example.com";
});

// Clear all mocks after each test
afterEach(() => {
	vi.clearAllMocks();
});

// Cleanup after all tests
afterAll(() => {
	vi.restoreAllMocks();
});
