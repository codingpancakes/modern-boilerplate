import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import * as path from "path";
import { Construct } from "constructs";

export interface HandlerConfig {
  name: string;
  path: string;
  memorySize?: number;
  timeout?: cdk.Duration;
  environment?: Record<string, string>;
  handler?: string; // For multi-handler files like status.ts
  logRetention?: any;
  stage?: string; // For generating clean function names
}

/**
 * RouteBuilder - Utility class for creating Lambda handlers with consistent configuration
 * Eliminates repetitive handler creation code
 */
export class RouteBuilder {
  constructor(
    private scope: Construct,
    private commonEnv: Record<string, string>,
    private lambdaRole: iam.Role,
    private stage?: string
  ) {}

  /**
   * Create a Lambda handler with standard configuration
   */
  createHandler(config: HandlerConfig): lambdaNodejs.NodejsFunction {
    // Generate clean function name: postway-production-workos-webhook
    const stage = config.stage || this.stage;
    if (!process.env.PROJECT_NAME) {
      throw new Error('PROJECT_NAME environment variable is required');
    }
    const projectName = process.env.PROJECT_NAME;
    const functionName = stage 
      ? `${projectName}-${stage}-${config.name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')}`
      : undefined;

    return new lambdaNodejs.NodejsFunction(this.scope, config.name, {
      functionName, // Clean, readable name
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: config.memorySize || 512,
      timeout: config.timeout || cdk.Duration.seconds(30),
      environment: {
        ...this.commonEnv,
        ...config.environment,
      },
      entry: path.join(__dirname, "../../../src/node", config.path),
      handler: config.handler || "handler",
      role: this.lambdaRole,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: config.logRetention,
      bundling: {
        minify: true,
        sourceMap: true,
        sourcesContent: false,
        target: "node20",
        format: lambdaNodejs.OutputFormat.CJS,
        mainFields: ["main", "module"],
      },
    });
  }

  /**
   * Helper to convert kebab-case to PascalCase
   * e.g., "session-started" -> "SessionStarted"
   */
  static toPascalCase(str: string): string {
    return str
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }
}
