import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface SecurityStackProps extends cdk.StackProps {
  stage: string;
}

export class SecurityStack extends cdk.Stack {
  public readonly workosSecret: secretsmanager.Secret;
  public readonly dbSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);

    if (!process.env.PROJECT_NAME) {
      throw new Error('PROJECT_NAME environment variable is required');
    }
    const projectName = process.env.PROJECT_NAME;

    // Get values from environment variables - fail fast if missing
    const workosClientId = process.env.WORKOS_CLIENT_ID;
    const databaseUrl = process.env.DATABASE_URL;

    // Validate required secrets
    if (!workosClientId) {
      throw new Error(
        'WORKOS_CLIENT_ID environment variable is required. ' +
        'Set it in your .env file and run: pnpm sync-secrets ' + props.stage
      );
    }
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL environment variable is required. ' +
        'Set it in your .env file and run: pnpm sync-secrets ' + props.stage
      );
    }

    // WorkOS credentials secret - populated from env vars
    this.workosSecret = new secretsmanager.Secret(this, 'WorkOSSecret', {
      secretName: `/${projectName}/${props.stage}/workos`,
      description: `${projectName} WorkOS API credentials`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
          clientId: workosClientId,
        })
      ),
    });

    // Database credentials secret - populated from env vars
    this.dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `/${projectName}/${props.stage}/database`,
      description: `${projectName} Neon database credentials`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
          url: databaseUrl,
        })
      ),
    });

    // Output secret ARNs for reference
    new cdk.CfnOutput(this, 'WorkOSSecretArn', {
      value: this.workosSecret.secretArn,
      description: 'ARN of WorkOS credentials secret',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.dbSecret.secretArn,
      description: 'ARN of database credentials secret',
    });
  }
}
