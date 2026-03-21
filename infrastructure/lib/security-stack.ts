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

    // WorkOS credentials secret - shell only, value populated via: pnpm sync-secrets <stage>
    this.workosSecret = new secretsmanager.Secret(this, 'WorkOSSecret', {
      secretName: `/${projectName}/${props.stage}/workos`,
      description: `${projectName} WorkOS API credentials`,
    });

    // Database credentials secret - shell only, value populated via: pnpm sync-secrets <stage>
    this.dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `/${projectName}/${props.stage}/database`,
      description: `${projectName} Neon database credentials`,
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
