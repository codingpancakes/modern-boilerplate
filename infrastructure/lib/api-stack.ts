import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "@aws-cdk/aws-apigatewayv2-alpha";
import * as apigwv2Authorizers from "@aws-cdk/aws-apigatewayv2-authorizers-alpha";
import * as apigwv2Integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import { Construct, IConstruct } from "constructs";
import { IAspect, Aspects } from "aws-cdk-lib";
import * as path from "path";
import { RouteBuilder } from "./routes/route-builder";
import { PublicRoutes } from "./routes/public-routes";
import { ProtectedRoutes } from "./routes/protected-routes";
import { InternalRoutes } from "./routes/internal-routes";

// CDK Aspect to add LogRetention with proper sequencing to avoid rate limits
class LogRetentionAspect implements IAspect {
  private lambdaFunctions: lambda.Function[] = [];
  private stage: string;

  constructor(stage: string) {
    this.stage = stage;
  }

  visit(node: IConstruct): void {
    if (
      node instanceof lambdaNodejs.NodejsFunction ||
      node instanceof lambda.Function
    ) {
      this.lambdaFunctions.push(node);
    }
  }

  // Called after all constructs are visited
  public applyLogRetention(scope: Construct): void {
    // Determine retention based on environment
    const retention = 
      this.stage === "production" ? logs.RetentionDays.ONE_MONTH :
      logs.RetentionDays.ONE_WEEK; // staging

    this.lambdaFunctions.forEach((lambdaFunction, index) => {
      const logRetention = new logs.LogRetention(
        scope,
        `${lambdaFunction.node.id}LogRetention`,
        {
          logGroupName: `/aws/lambda/${lambdaFunction.functionName}`,
          retention: retention,
        }
      );

      // Add dependencies to serialize LogRetention creation (avoid rate limits)
      if (index > 0) {
        const previousRetention = scope.node.findChild(
          `${this.lambdaFunctions[index - 1].node.id}LogRetention`
        );
        if (previousRetention) {
          logRetention.node.addDependency(previousRetention);
        }
      }
    });
  }
}

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  workosSecret: secretsmanager.Secret;
  dbSecret: secretsmanager.Secret;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // CORS is now handled dynamically in Lambda functions to support
    // multi-tenant wildcard domains (*.domain.com)
    // See src/node/lib/cors.ts for the CORS configuration

    // Project name for API naming
    if (!process.env.PROJECT_NAME) {
      throw new Error('PROJECT_NAME environment variable is required');
    }
    const projectName = process.env.PROJECT_NAME;

    // Create HTTP API
    // CORS is handled in Lambda functions to support multi-tenant wildcard domains
    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: `${projectName}-${props.stage}-api`,
      description: "Production-grade serverless HTTP API",
      // No corsPreflight - handled in Lambda for dynamic multi-tenant support
      disableExecuteApiEndpoint: false,
    });

    // Configure API Gateway throttling (rate limiting)
    // Note: HTTP API v2 throttling is configured via the default stage
    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as cdk.aws_apigatewayv2.CfnStage;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: props.stage === "production" ? 2000 : 1000,
        throttlingRateLimit: props.stage === "production" ? 1000 : 500,
      };
    }

    // Common Lambda environment variables
    const commonEnv = {
      PROJECT_NAME: projectName,
      NODE_ENV: props.stage === "production" ? "production" : "staging",
      STAGE: props.stage,
      WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID || "",
      // Provide direct DB URL if present; handlers also support DB_SECRET_ARN fallback
      DATABASE_URL: process.env.DATABASE_URL || "",
      WORKOS_SECRET_ARN: props.workosSecret.secretArn,
      DB_SECRET_ARN: props.dbSecret.secretArn,
      // S3 and Media Configuration
      IMAGES_BUCKET: process.env.IMAGES_BUCKET || "",
      IMAGES_CDN_URL: process.env.IMAGES_CDN_URL || "",
      IMAGES_BUCKET_PREFIX: process.env.IMAGES_BUCKET_PREFIX || "",
      // CORS Configuration
      CORS_DOMAIN_PATTERNS: process.env.CORS_DOMAIN_PATTERNS || "",
      CORS_EXACT_ORIGINS: process.env.CORS_EXACT_ORIGINS || "",
      CORS_PARENT_DOMAINS: process.env.CORS_PARENT_DOMAINS || "",
    };

    // Custom Lambda Authorizer for WorkOS (matches local validation)
    const workosAuthorizerHandler = new lambdaNodejs.NodejsFunction(
      this,
      "WorkOSAuthorizer",
      {
        functionName: `${projectName}-${props.stage}-workos-authorizer`,
        entry: path.join(__dirname, "../../src/node/authorizers/workos-jwt.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        environment: commonEnv,
        bundling: {
          minify: true,
          sourceMap: false,
          target: "node20",
          format: lambdaNodejs.OutputFormat.CJS,
          mainFields: ["main", "module"],
        },
      }
    );

    const customAuthorizer = new apigwv2Authorizers.HttpLambdaAuthorizer(
      "WorkOSAuthorizer",
      workosAuthorizerHandler,
      {
        authorizerName: `${props.stage}-workos-authorizer`,
        responseTypes: [apigwv2Authorizers.HttpLambdaResponseType.SIMPLE],
        // Cache valid tokens for 5 minutes to reduce Lambda invocations
        // Tokens are validated by signature, so caching is safe
        resultsCacheTtl: cdk.Duration.minutes(5),
      }
    );

    // Lambda execution role with consolidated permissions
    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"),
      ],
      inlinePolicies: {
        LambdaServicePolicy: new iam.PolicyDocument({
          statements: [
            // Secrets Manager access
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["secretsmanager:GetSecretValue"],
              resources: [
                props.workosSecret.secretArn,
                props.dbSecret.secretArn,
              ],
            }),
            // S3 access for image buckets
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
              resources: [`arn:aws:s3:::${process.env.IMAGES_BUCKET_PREFIX || `${projectName}-images-depot`}*/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:ListBucket"],
              resources: [`arn:aws:s3:::${process.env.IMAGES_BUCKET_PREFIX || `${projectName}-images-depot`}*`],
            }),
            // Lambda invoke for TypeScript -> Python proxy pattern
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["lambda:InvokeFunction"],
              resources: [`arn:aws:lambda:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:function:${projectName}-${props.stage}-*`],
            }),
          ],
        }),
      },
    });

    // Get S3 bucket name from environment variable
    const bucketName = process.env.IMAGES_BUCKET || 
      (props.stage === "production"
        ? `${projectName}-images-depot`
        : `${projectName}-images-depot-staging`);

    // Create route builder for handler creation
    const routeBuilder = new RouteBuilder(this, commonEnv, lambdaRole, props.stage);

    // Register route groups organized by authentication pattern
    // Public routes: health checks, webhooks (no auth, but with their own verification)
    new PublicRoutes(this, this.httpApi, routeBuilder);

    // Protected routes: media endpoints (require WorkOS JWT)
    new ProtectedRoutes(
      this,
      this.httpApi,
      routeBuilder,
      customAuthorizer,
      bucketName
    );

    // Internal routes: messaging system (no auth, should be VPC-protected in prod)
    new InternalRoutes(this, this.httpApi, routeBuilder);

    // Python test handler (kept separate as it's a special case)
    const pythonTestHandler = new lambda.Function(this, "PythonTestHandler", {
      functionName: `${projectName}-${props.stage}-python-test-handler`,
      runtime: lambda.Runtime.PYTHON_3_11,
      code: lambda.Code.fromAsset(path.join(__dirname, "../../src/python")),
      handler: "handlers.test.hello.handler",
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(5),
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: undefined, // Disabled to avoid AWS rate limits
    });

    this.httpApi.addRoutes({
      path: "/v1/test/python",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "PythonTestIntegration",
        pythonTestHandler
      ),
    });

    // Python user profile handler (invoked by TypeScript proxy)
    const pythonUserProfileHandler = new lambda.Function(this, "PythonUserProfileHandler", {
      functionName: `${projectName}-${props.stage}-python-user-profile`,
      runtime: lambda.Runtime.PYTHON_3_11,
      code: lambda.Code.fromAsset(path.join(__dirname, "../../src/python")),
      handler: "handlers.users.profile.handler",
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: undefined,
    });

    // TypeScript proxy handler for authenticated Python profile endpoint
    const tsProxyProfileHandler = routeBuilder.createHandler({
      name: "PythonProfileProxyHandler",
      path: "handlers/users/python-profile.ts",
      environment: {
        ...commonEnv,
        PYTHON_PROFILE_FUNCTION_NAME: pythonUserProfileHandler.functionName,
      },
    });

    this.httpApi.addRoutes({
      path: "/v1/users/python-profile",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "PythonProfileProxyIntegration",
        tsProxyProfileHandler
      ),
      authorizer: customAuthorizer,
    });

    // Note: Throttling can be configured later via AWS Console if needed
    // API Gateway v2 throttling is managed differently than v1

    // Custom domain configuration (optional)
    if (process.env.API_DOMAIN) {
      const apiDomain = process.env.API_DOMAIN;
      const zoneName = process.env.HOSTED_ZONE_NAME; 
      const certArn = process.env.API_CERT_ARN; // optional: existing ACM cert ARN

      let hostedZone: route53.IHostedZone | undefined;
      if (zoneName && process.env.HOSTED_ZONE_ID) {
        // Use the zone ID directly instead of lookup to avoid cross-account issues
        hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "ApiHostedZone", {
          hostedZoneId: process.env.HOSTED_ZONE_ID,
          zoneName: zoneName,
        });
      }

      let certificate: acm.ICertificate | undefined;
      if (certArn) {
        certificate = acm.Certificate.fromCertificateArn(
          this,
          "ApiDomainCert",
          certArn
        );
      } else if (hostedZone) {
        certificate = new acm.Certificate(
          this,
          "ApiDomainDnsCert",
          {
            domainName: apiDomain!,
            validation: acm.CertificateValidation.fromDns(hostedZone),
          }
        );
      }

      if (certificate) {
        const domainName = new apigwv2.DomainName(this, "ApiCustomDomain", {
          domainName: apiDomain!,
          certificate,
        });

        new apigwv2.ApiMapping(this, "ApiDefaultMapping", {
          api: this.httpApi,
          domainName,
          stage: this.httpApi.defaultStage!,
        });

        // Optional: create Route53 alias record if hosted zone is provided
        if (hostedZone) {
          // Derive recordName from full domain and zone name
          const recordName = apiDomain!.endsWith(`.${hostedZone.zoneName}`)
            ? apiDomain!.slice(
                0,
                apiDomain!.length - hostedZone.zoneName.length - 1
              )
            : apiDomain!; // fallback

          new route53.ARecord(this, "ApiDomainAliasRecord", {
            zone: hostedZone,
            recordName,
            target: route53.RecordTarget.fromAlias(
              new route53targets.ApiGatewayv2DomainProperties(
                domainName.regionalDomainName,
                domainName.regionalHostedZoneId
              )
            ),
          });
        }

        new cdk.CfnOutput(this, "CustomDomain", {
          value: `https://${apiDomain}`,
          description: "Custom API domain",
        });

        // Helpful outputs when DNS is managed outside Route53
        new cdk.CfnOutput(this, "ApiCustomDomainRegionalDomainName", {
          value: domainName.regionalDomainName,
          description:
            "Target domain name for DNS (use CNAME if not using Route53)",
        });
        new cdk.CfnOutput(this, "ApiCustomDomainRegionalHostedZoneId", {
          value: domainName.regionalHostedZoneId,
          description: "Hosted Zone ID for alias targeting",
        });
      } else {
        new cdk.CfnOutput(this, "CustomDomainNotConfigured", {
          value: `Set API_CERT_ARN or HOSTED_ZONE_NAME to configure custom domain for ${apiDomain}`,
          description: "Custom domain prerequisites are missing",
        });
      }
    }

    // Output API endpoint
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: this.httpApi.url!,
      description: "HTTP API endpoint URL",
    });


    // Apply LogRetention aspect with proper sequencing to avoid rate limits
    const logRetentionAspect = new LogRetentionAspect(stage);
    Aspects.of(this).add(logRetentionAspect);

    // Apply LogRetention after all constructs are created
    logRetentionAspect.applyLogRetention(this);
  }
}
