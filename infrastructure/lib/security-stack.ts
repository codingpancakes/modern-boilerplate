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

    const projectName = process.env.PROJECT_NAME || 'postway';

    // WorkOS credentials secret
    this.workosSecret = new secretsmanager.Secret(this, 'WorkOSSecret', {
      secretName: `/${projectName}/${props.stage}/workos`,
      description: `${projectName} WorkOS API credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          apiKey: 'REPLACE_WITH_ACTUAL_API_KEY',
          clientId: 'REPLACE_WITH_ACTUAL_CLIENT_ID',
          webhookSecret: 'REPLACE_WITH_WEBHOOK_SECRET',
        }),
        generateStringKey: 'dummy',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    // Database credentials secret
    this.dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `/${projectName}/${props.stage}/database`,
      description: `${projectName} Neon database credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          host: 'REPLACE_WITH_NEON_HOST',
          port: 5432,
          dbname: 'REPLACE_WITH_DB_NAME',
          username: 'REPLACE_WITH_USERNAME',
        }),
        generateStringKey: 'password',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
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
