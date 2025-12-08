import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Aspects } from 'aws-cdk-lib';
import * as path from 'path';
import { LogRetentionAspect } from './utils/log-retention-aspect';

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

    if (!process.env.PROJECT_NAME) {
      throw new Error('PROJECT_NAME environment variable is required');
    }
    const projectName = process.env.PROJECT_NAME;
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
