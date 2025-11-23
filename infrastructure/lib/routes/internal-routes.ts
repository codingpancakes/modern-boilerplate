import * as apigwv2 from "@aws-cdk/aws-apigatewayv2-alpha";
import { Construct } from "constructs";
import { RouteBuilder } from "./route-builder";

/**
 * Internal routes - no public authentication
 * These are meant for internal service-to-service communication
 * Should be protected by VPC/security groups in production
 */
export class InternalRoutes {
  constructor(
    scope: Construct,
    httpApi: apigwv2.HttpApi,
    routeBuilder: RouteBuilder
  ) {
    // No internal routes currently defined
    // Add internal service-to-service routes here as needed
  }
}

// Export handler paths for local testing
export const INTERNAL_HANDLER_PATHS = {};
