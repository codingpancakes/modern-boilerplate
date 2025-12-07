import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface PipelineStackProps extends cdk.StackProps {
  stage: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  dbSecret: secretsmanager.ISecret;
  workosSecret: secretsmanager.ISecret;
  hostedZoneId: string;
  hostedZoneName: string;
}


/**
 * CI/CD Pipeline Stack using AWS CodePipeline and CodeBuild
 * 
 * This creates a fully automated deployment pipeline that:
 * - Pulls code from GitHub
 * - Runs tests and linting
 * - Deploys CDK stacks
 * - No GitHub secrets needed - uses AWS IAM roles
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const projectName = process.env.PROJECT_NAME || 'postway';

    // GitHub connection ARN from SSM Parameter Store
    // Create it with: aws ssm put-parameter --name /github/connection-arn --value "arn:aws:..." --type String
    const githubConnectionArn = cdk.aws_ssm.StringParameter.valueFromLookup(
      this,
      `/github/connection-arn`
    );

    // Source artifact
    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    // Source action - pulls from GitHub
    const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: 'GitHub_Source',
      owner: props.githubOwner,
      repo: props.githubRepo,
      branch: props.githubBranch,
      output: sourceOutput,
      connectionArn: githubConnectionArn,
    });

    // CodeBuild project for building and deploying
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: `${projectName}-${props.stage}-build`,
      description: `Build and deploy ${projectName} ${props.stage} environment`,
      
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0, // Node.js 20
        computeType: codebuild.ComputeType.SMALL,
        privileged: false,
      },

      environmentVariables: {
        // Stage configuration
        STAGE: { value: props.stage },
        NODE_ENV: { value: 'production' },
        AWS_REGION: { value: this.region },
        CDK_DEFAULT_ACCOUNT: { value: this.account },
        PROJECT_NAME: { value: projectName },

        // Secrets from Secrets Manager
        WORKOS_CLIENT_ID: {
          value: `${props.workosSecret.secretArn}:clientId::`,
          type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
        },
        DATABASE_URL: {
          value: `${props.dbSecret.secretArn}:url::`,
          type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
        },

        // Environment-specific variables (from Parameter Store or hardcoded)
        IMAGES_BUCKET_PREFIX: { value: `${projectName}-${props.stage}` },
        IMAGES_BUCKET: { value: `${projectName}-${props.stage}-images` },
        IMAGES_CDN_URL: { value: `https://images-${props.stage}.${projectName}.services` },
        API_DOMAIN: { value: `api-${props.stage}.${projectName}.services` },
        
        // CORS configuration
        CORS_DOMAIN_PATTERNS: { value: `*.${projectName}.services,localhost:*` },
        CORS_EXACT_ORIGINS: { value: `https://app-${props.stage}.${projectName}.services` },
        CORS_PARENT_DOMAINS: { value: `${projectName}.services` },

        // Route53
        HOSTED_ZONE_NAME: { value: props.hostedZoneName },
        HOSTED_ZONE_ID: { value: props.hostedZoneId },

        // Sentry (optional - will be empty if not set)
        SENTRY_DSN: { value: '' },
        SENTRY_ENVIRONMENT: { value: props.stage },
      },

      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),

      // Grant permissions to deploy CDK stacks
      role: new iam.Role(this, 'BuildRole', {
        assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
        managedPolicies: [
          // Full permissions for CDK deployment
          iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
        ],
      }),

      cache: codebuild.Cache.local(
        codebuild.LocalCacheMode.SOURCE,
        codebuild.LocalCacheMode.CUSTOM,
      ),
    });

    // Grant access to secrets
    props.dbSecret.grantRead(buildProject);
    props.workosSecret.grantRead(buildProject);

    // Build action
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Build_and_Deploy',
      project: buildProject,
      input: sourceOutput,
    });

    // Create the pipeline
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: `${projectName}-${props.stage}-pipeline`,
      restartExecutionOnUpdate: true,
      
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build_and_Deploy',
          actions: [buildAction],
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'PipelineName', {
      value: pipeline.pipelineName,
      description: 'Name of the CodePipeline',
    });

    new cdk.CfnOutput(this, 'PipelineUrl', {
      value: `https://console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipeline.pipelineName}/view`,
      description: 'URL to view the pipeline in AWS Console',
    });
  }
}
