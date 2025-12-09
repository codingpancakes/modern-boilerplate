import * as apigwv2 from "@aws-cdk/aws-apigatewayv2-alpha";
import * as apigwv2Integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import * as apigwv2Authorizers from "@aws-cdk/aws-apigatewayv2-authorizers-alpha";
import { Construct } from "constructs";
import { RouteBuilder } from "./route-builder";

/**
 * Protected routes - require WorkOS JWT authentication
 * - Media uploads and management
 * - User profile endpoints
 */
export class ProtectedRoutes {
  constructor(
    scope: Construct,
    httpApi: apigwv2.HttpApi,
    routeBuilder: RouteBuilder,
    authorizer: apigwv2Authorizers.HttpLambdaAuthorizer,
    bucketName: string
  ) {
    this.setupMediaRoutes(httpApi, routeBuilder, authorizer, bucketName);
    this.setupMemberRoutes(httpApi, routeBuilder, authorizer);
  }

  private setupMediaRoutes(
    httpApi: apigwv2.HttpApi,
    routeBuilder: RouteBuilder,
    authorizer: apigwv2Authorizers.HttpLambdaAuthorizer,
    bucketName: string
  ) {
    const mediaEnv = {
      IMAGES_BUCKET: bucketName,
      NODE_ENV: process.env.NODE_ENV || "production",
    };

    const mediaRoutes = [
      {
        name: "UploadImage",
        path: "upload-image",
        file: "upload-image.ts",
        method: apigwv2.HttpMethod.POST,
      },
      {
        name: "UploadImageDirect",
        path: "upload-image-direct",
        file: "upload-image-direct.ts",
        method: apigwv2.HttpMethod.POST,
      },
      {
        name: "ListImages",
        path: "images",
        file: "list-images.ts",
        method: apigwv2.HttpMethod.GET,
      },
    ];

    mediaRoutes.forEach(({ name, path, file, method }) => {
      const handler = routeBuilder.createHandler({
        name: `Media${name}Handler`,
        path: `handlers/media/${file}`,
        environment: mediaEnv,
        reservedConcurrentExecutions: 20, // Media operations can be concurrent
      });

      httpApi.addRoutes({
        path: `/v1/media/${path}`,
        methods: [method],
        integration: new apigwv2Integrations.HttpLambdaIntegration(
          `Media${name}Integration`,
          handler
        ),
        authorizer, // WorkOS JWT required
      });
    });
  }

  private setupMemberRoutes(
    httpApi: apigwv2.HttpApi,
    routeBuilder: RouteBuilder,
    authorizer: apigwv2Authorizers.HttpLambdaAuthorizer
  ) {
    const memberRoutes = [
      {
        name: "Me",
        path: "me",
        file: "me.ts",
        method: apigwv2.HttpMethod.GET,
      },
      {
        name: "UpdateMe",
        path: "me",
        file: "update.ts",
        method: apigwv2.HttpMethod.PATCH,
      },
    ];

    memberRoutes.forEach(({ name, path, file, method }) => {
      const handler = routeBuilder.createHandler({
        name: `User${name}Handler`,
        path: `handlers/users/${file}`,
        reservedConcurrentExecutions: 30, // User-facing endpoints, high traffic
      });

      httpApi.addRoutes({
        path: `/v1/users/${path}`,
        methods: [method],
        integration: new apigwv2Integrations.HttpLambdaIntegration(
          `User${name}Integration`,
          handler
        ),
        authorizer, // WorkOS JWT required
      });
    });
  }
}

// Export handler paths for local testing
export const PROTECTED_HANDLER_PATHS = {
  mediaUploadImage: "handlers/media/upload-image.ts",
  mediaUploadImageDirect: "handlers/media/upload-image-direct.ts",
  mediaListImages: "handlers/media/list-images.ts",
  userMe: "handlers/users/me.ts",
  userUpdateMe: "handlers/users/update.ts",
};
