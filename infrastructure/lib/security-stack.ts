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

    // Get values from environment variables
    const workosClientId = process.env.WORKOS_CLIENT_ID;
    const databaseUrl = process.env.DATABASE_URL;

    // WorkOS credentials secret - populated from env vars
    this.workosSecret = new secretsmanager.Secret(this, 'WorkOSSecret', {
      secretName: `/${projectName}/${props.stage}/workos`,
      description: `${projectName} WorkOS API credentials`,
      secretStringValue: workosClientId
        ? cdk.SecretValue.unsafePlainText(
            JSON.stringify({
              clientId: workosClientId,
            })
          )
        : undefined,
      generateSecretString: workosClientId
        ? undefined
        : {
            secretStringTemplate: JSON.stringify({
              clientId: 'REPLACE_WITH_ACTUAL_CLIENT_ID',
            }),
            generateStringKey: 'dummy',
            excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
          },
    });

    // Database credentials secret - populated from env vars
    this.dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `/${projectName}/${props.stage}/database`,
      description: `${projectName} Neon database credentials`,
      secretStringValue: databaseUrl
        ? cdk.SecretValue.unsafePlainText(
            JSON.stringify({
              url: databaseUrl,
            })
          )
        : undefined,
      generateSecretString: databaseUrl
        ? undefined
        : {
            secretStringTemplate: JSON.stringify({
              url: 'REPLACE_WITH_DATABASE_URL',
            }),
            generateStringKey: 'dummy',
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
