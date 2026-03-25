import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as path from "path";
import { Construct } from "constructs";

export interface HandlerConfig {
  name: string;
  path: string;
  memorySize?: number;
  timeout?: cdk.Duration;
  environment?: Record<string, string>;
  handler?: string;
  logRetention?: any;
  stage?: string;
  reservedConcurrentExecutions?: number;
  deadLetterQueue?: any;
}

/**
 * RouteBuilder — creates Lambda handlers with consistent config and
 * wraps each one in a CodeDeploy blue-green deployment group so that
 * every deploy does a canary shift (production) or immediate cutover
 * (staging) with automatic CloudWatch-alarm-driven rollback.
 *
 * Adding a new route:
 *   1. Write your handler in src/node/handlers/
 *   2. Add one entry to the relevant route array in public/protected/internal-routes.ts
 *   Everything else (versioning, alias, blue-green, alarm) is handled here.
 */
export class RouteBuilder {
  constructor(
    private scope: Construct,
    private commonEnv: Record<string, string>,
    private lambdaRole: iam.Role,
    private stage?: string,
    private codeDeployApp?: codedeploy.LambdaApplication,
    private deploymentConfig?: codedeploy.ILambdaDeploymentConfig,
    private alarmTopic?: sns.Topic,
  ) {}

  /**
   * Create a Node.js Lambda handler and wrap it with blue-green deployment.
   * Returns a `lambda.Alias` ("live") that API Gateway integrations should target.
   */
  createHandler(config: HandlerConfig): lambda.Alias {
    const stage = config.stage || this.stage;
    if (!process.env.PROJECT_NAME) {
      throw new Error("PROJECT_NAME environment variable is required");
    }
    const projectName = process.env.PROJECT_NAME;
    const functionName = stage
      ? `${projectName}-${stage}-${config.name
          .replace(/([A-Z])/g, "-$1")
          .toLowerCase()
          .replace(/^-/, "")}`
      : undefined;

    const fn = new lambdaNodejs.NodejsFunction(this.scope, config.name, {
      functionName,
      runtime: lambda.Runtime.NODEJS_24_X,
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
      reservedConcurrentExecutions: config.reservedConcurrentExecutions,
      deadLetterQueue: config.deadLetterQueue,
      bundling: {
        minify: true,
        sourceMap: true,
        sourcesContent: false,
        target: "node24",
        format: lambdaNodejs.OutputFormat.CJS,
        mainFields: ["main", "module"],
      },
    });

    return this.wrapWithBlueGreen(fn, config.name);
  }

  /**
   * Wrap any Lambda function (Node.js or Python) with a blue-green
   * CodeDeploy deployment group and a CloudWatch error-rate alarm.
   *
   * Returns a `lambda.Alias` named "live". Point all API Gateway
   * integrations and authorizers at this alias, not the raw function.
   *
   * CodeDeploy watches the alias update: when CDK publishes a new
   * version and moves the alias pointer, CodeDeploy intercepts and
   * performs the canary shift instead of an instant cutover.
   *
   * Rollback is automatic: if the attached error alarm fires during
   * the shift window, CodeDeploy reverts the alias to the previous
   * version immediately.
   */
  wrapWithBlueGreen(fn: lambda.Function, name: string): lambda.Alias {
    const alias = new lambda.Alias(this.scope, `${name}LiveAlias`, {
      aliasName: "live",
      version: fn.currentVersion,
    });

    if (this.codeDeployApp && this.deploymentConfig) {
      // Alarm: > 5 Lambda errors in any 1-minute window triggers rollback.
      // treatMissingData = NOT_BREACHING so cold/idle functions don't self-rollback.
      const errorAlarm = new cloudwatch.Alarm(
        this.scope,
        `${name}ErrorAlarm`,
        {
          metric: fn.metricErrors({
            period: cdk.Duration.minutes(1),
            statistic: "Sum",
          }),
          threshold: 3,
          evaluationPeriods: 1,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `${name}: error count exceeded 3 in 1 minute — rolling back`,
        },
      );

      // Notify via SNS when the alarm fires (email + any other subscribers)
      if (this.alarmTopic) {
        errorAlarm.addAlarmAction(
          new cloudwatchActions.SnsAction(this.alarmTopic),
        );
      }

      new codedeploy.LambdaDeploymentGroup(
        this.scope,
        `${name}DeploymentGroup`,
        {
          application: this.codeDeployApp,
          alias,
          deploymentConfig: this.deploymentConfig,
          alarms: [errorAlarm],
        },
      );
    }

    return alias;
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
