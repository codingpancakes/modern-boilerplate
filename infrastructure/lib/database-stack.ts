import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct, IConstruct } from 'constructs';
import { IAspect, Aspects } from 'aws-cdk-lib';
import * as path from 'path';

// CDK Aspect to add LogRetention with proper sequencing to avoid rate limits
class LogRetentionAspect implements IAspect {
  private lambdaFunctions: lambda.Function[] = [];
  private stage: string;

  constructor(stage: string) {
    this.stage = stage;
  }

  visit(node: IConstruct): void {
    if (node instanceof lambdaNodejs.NodejsFunction || node instanceof lambda.Function) {
      this.lambdaFunctions.push(node);
    }
  }

  public applyLogRetention(scope: Construct): void {
    // Determine retention based on environment
    const retention = 
      this.stage === 'production' ? logs.RetentionDays.ONE_MONTH :
      logs.RetentionDays.ONE_WEEK; // staging

    this.lambdaFunctions.forEach((lambdaFunction, index) => {
      const logRetention = new logs.LogRetention(scope, `${lambdaFunction.node.id}LogRetention`, {
        logGroupName: `/aws/lambda/${lambdaFunction.functionName}`,
        retention: retention,
      });

      // Add dependencies to serialize LogRetention creation (avoid rate limits)
      if (index > 0) {
        const previousRetention = scope.node.findChild(`${this.lambdaFunctions[index - 1].node.id}LogRetention`);
        if (previousRetention) {
          logRetention.node.addDependency(previousRetention);
        }
      }
    });
  }
}

export interface DatabaseStackProps extends cdk.StackProps {
  stage: string;
  dbSecret: secretsmanager.Secret;
}

export class DatabaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // Migration runner Lambda (optional, for automated migrations)
    const migrationRole = new iam.Role(this, 'MigrationRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    props.dbSecret.grantRead(migrationRole);

    const projectName = process.env.PROJECT_NAME || 'railbranch';
    const migrationRunner = new lambdaNodejs.NodejsFunction(this, 'MigrationRunner', {
      functionName: `${projectName}-${props.stage}-migration-runner`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        STAGE: props.stage,
        DB_SECRET_ARN: props.dbSecret.secretArn,
      },
      entry: path.join(__dirname, '../../scripts/migrate.ts'),
      handler: 'handler',
      role: migrationRole,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
        // Prefer CommonJS entry points for dependencies and bundle AWS SDK v3
        mainFields: ['main', 'module'],
      },
    });

    // Output migration runner ARN
    new cdk.CfnOutput(this, 'MigrationRunnerArn', {
      value: migrationRunner.functionArn,
      description: 'ARN of migration runner Lambda',
    });

    // Apply LogRetention aspect with proper sequencing to avoid rate limits
    const logRetentionAspect = new LogRetentionAspect(stage);
    Aspects.of(this).add(logRetentionAspect);
    logRetentionAspect.applyLogRetention(this);
  }
}
