import * as apigwv2 from "@aws-cdk/aws-apigatewayv2-alpha";
import * as apigwv2Integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { RouteBuilder } from "./route-builder";

/**
 * Public routes - no authentication required
 * - Health checks
 * - Webhooks (with their own verification: HMAC, signatures, etc.)
 * - CORS preflight
 */
export class PublicRoutes {
  constructor(
    scope: Construct,
    httpApi: apigwv2.HttpApi,
    routeBuilder: RouteBuilder
  ) {
    this.setupHealthRoutes(httpApi, routeBuilder);
    this.setupWebhookRoutes(httpApi, routeBuilder);
    this.setupCorsRoutes(httpApi, routeBuilder);
  }

  private setupHealthRoutes(
    httpApi: apigwv2.HttpApi,
    routeBuilder: RouteBuilder
  ) {
    const healthHandler = routeBuilder.createHandler({
      name: "HealthHandler",
      path: "handlers/utils/health.ts",
      memorySize: 256,
      timeout: cdk.Duration.seconds(5),
    });

    httpApi.addRoutes({
      path: "/v1/health",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "HealthIntegration",
        healthHandler
      ),
    });
  }

  private setupWebhookRoutes(
    httpApi: apigwv2.HttpApi,
    routeBuilder: RouteBuilder
  ) {
    // WorkOS webhook (HMAC verification in handler)
    const workosHandler = routeBuilder.createHandler({
      name: "WorkOSWebhookHandler",
      path: "handlers/webhooks/workos.ts",
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
    });

    httpApi.addRoutes({
      path: "/v1/webhooks/workos",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "WorkOSWebhookIntegration",
        workosHandler
      ),
    });
  }

  private setupCorsRoutes(
    httpApi: apigwv2.HttpApi,
    routeBuilder: RouteBuilder
  ) {
    const optionsHandler = routeBuilder.createHandler({
      name: "OptionsHandler",
      path: "handlers/utils/options.ts",
      memorySize: 256,
      timeout: cdk.Duration.seconds(3),
      logRetention: undefined, // Disabled to avoid AWS rate limits
    });

    httpApi.addRoutes({
      path: "/v1/{proxy+}",
      methods: [apigwv2.HttpMethod.OPTIONS],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "OptionsIntegration",
        optionsHandler
      ),
    });
  }
}

// Export handler paths for local testing
export const PUBLIC_HANDLER_PATHS = {
  health: "handlers/utils/health.ts",
  options: "handlers/utils/options.ts",
  workosWebhook: "handlers/webhooks/workos.ts",
};
