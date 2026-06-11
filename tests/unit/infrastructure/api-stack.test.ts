import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiStack } from "../../../infrastructure/lib/api-stack";

/**
 * CDK assertion tests for the API stack.
 *
 * These synthesize the stack to CloudFormation and assert the security-critical
 * wiring is present — the same class of thing that broke us live (authorizer
 * missing/misconfigured, CORS gaps, WAF toggle). They run in the fast unit
 * pipeline; Lambda bundling is disabled via the `aws:cdk:bundling-stacks`
 * context so no esbuild/Docker work happens.
 */

const ENV = { account: "123456789012", region: "us-east-1" };

function synth(overrides: Record<string, string> = {}): Template {
	const saved = { ...process.env };
	Object.assign(process.env, {
		PROJECT_NAME: "testproj",
		CORS_EXACT_ORIGINS: "https://app.example.com",
		// Leave API_DOMAIN unset so the custom-domain/Route53/ACM block is skipped.
		...overrides,
	});

	try {
		const app = new cdk.App({
			// Skip NodejsFunction esbuild bundling during synth (test speed).
			context: { "aws:cdk:bundling-stacks": [] },
		});
		const deps = new cdk.Stack(app, "Deps", { env: ENV });
		const stack = new ApiStack(app, "ApiStack", {
			env: ENV,
			stage: "test",
			workosSecret: new secretsmanager.Secret(deps, "WorkosSecret"),
			dbSecret: new secretsmanager.Secret(deps, "DbSecret"),
			alarmTopic: new sns.Topic(deps, "AlarmTopic"),
		});
		return Template.fromStack(stack);
	} finally {
		process.env = saved;
	}
}

describe("ApiStack synthesis", () => {
	beforeEach(() => {
		delete process.env.API_DOMAIN;
		delete process.env.ENABLE_WAF;
	});

	afterEach(() => {
		delete process.env.API_DOMAIN;
		delete process.env.ENABLE_WAF;
	});

	it("creates a single HTTP API with the configured exact CORS origin", () => {
		const t = synth();
		t.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
		t.hasResourceProperties("AWS::ApiGatewayV2::Api", {
			ProtocolType: "HTTP",
			CorsConfiguration: Match.objectLike({
				AllowOrigins: Match.arrayWith(["https://app.example.com"]),
			}),
		});
	});

	it("attaches a REQUEST-type WorkOS Lambda authorizer", () => {
		const t = synth();
		t.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
			AuthorizerType: "REQUEST",
			Name: "test-workos-authorizer",
		});
	});

	it("fronts the API with a CloudFront distribution", () => {
		const t = synth();
		t.resourceCountIs("AWS::CloudFront::Distribution", 1);
	});

	it("does NOT create a WAF when ENABLE_WAF is unset (boilerplate default)", () => {
		const t = synth();
		t.resourceCountIs("AWS::WAFv2::WebACL", 0);
	});

	it("creates a CLOUDFRONT-scoped WAF and attaches it when ENABLE_WAF=true", () => {
		const t = synth({ ENABLE_WAF: "true" });
		t.resourceCountIs("AWS::WAFv2::WebACL", 1);
		t.hasResourceProperties("AWS::WAFv2::WebACL", {
			Scope: "CLOUDFRONT",
		});
		// The distribution must actually reference the WebACL, not just create it.
		t.hasResourceProperties("AWS::CloudFront::Distribution", {
			DistributionConfig: Match.objectLike({
				WebACLId: Match.anyValue(),
			}),
		});
	});
});
