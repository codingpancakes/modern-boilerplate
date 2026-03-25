#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { SecurityStack } from '../lib/security-stack';
import { DatabaseStack } from '../lib/database-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { MediaStack } from '../lib/media-stack';
import { PublicAssetsStack } from '../lib/public-assets-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { CostMonitoringStack } from '../lib/cost-monitoring-stack';
import { CloudTrailStack } from '../lib/cloudtrail-stack';

const app = new cdk.App();

// Fail-fast if required environment variables are missing
if (!process.env.PROJECT_NAME) {
  throw new Error('PROJECT_NAME environment variable is required');
}
if (!process.env.STAGE) {
  throw new Error('STAGE environment variable is required');
}
if (!process.env.HOSTED_ZONE_NAME) {
  throw new Error('HOSTED_ZONE_NAME environment variable is required');
}
if (!process.env.GITHUB_OWNER) {
  throw new Error('GITHUB_OWNER environment variable is required');
}
if (!process.env.GITHUB_REPO) {
  throw new Error('GITHUB_REPO environment variable is required');
}
if (!process.env.GITHUB_BRANCH) {
  throw new Error('GITHUB_BRANCH environment variable is required');
}
if (!process.env.AWS_REGION) {
  throw new Error('AWS_REGION environment variable is required');
}

const projectName = process.env.PROJECT_NAME;
const stage = process.env.STAGE;
const stackPrefix = `${projectName}-${stage}`;

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION,
};

// Security stack (secrets, IAM)
const securityStack = new SecurityStack(app, `${stackPrefix}-SecurityStack`, {
  env,
  stage,
});

// Database stack (migration runner)
const databaseStack = new DatabaseStack(app, `${stackPrefix}-DatabaseStack`, {
  env,
  stage,
  dbSecret: securityStack.dbSecret,
});

// Monitoring stack (X-Ray, CloudWatch)
const monitoringStack = new MonitoringStack(app, `${stackPrefix}-MonitoringStack`, {
  env,
  stage,
  alarmEmail: process.env.ALERT_EMAIL,
});

// Cost monitoring stack (AWS Budgets)
const costMonitoringStack = new CostMonitoringStack(app, `${stackPrefix}-CostMonitoringStack`, {
  env,
  stage,
  alertEmail: process.env.ALERT_EMAIL,
  monthlyBudget: stage === 'production' ? 200 : 50, // $200 prod, $50 staging
});

// CloudTrail stack (audit logging)
const cloudTrailStack = new CloudTrailStack(app, `${stackPrefix}-CloudTrailStack`, {
  env,
  stage,
});

// Media stack (S3 buckets, CloudFront CDN)
const mediaStack = new MediaStack(app, `${stackPrefix}-MediaStack`, {
  env,
  stage,
  domainName: process.env.HOSTED_ZONE_NAME,
  hostedZoneId: process.env.HOSTED_ZONE_ID,
  // imagesCertArn: undefined (CDK will create certificate automatically)
});

// Public Assets stack (S3 bucket for public assets, CloudFront CDN)
const publicAssetsStack = new PublicAssetsStack(app, `${stackPrefix}-PublicAssetsStack`, {
  env,
  stage,
  domainName: process.env.HOSTED_ZONE_NAME,
  hostedZoneId: process.env.HOSTED_ZONE_ID,
  // assetsCertArn: undefined (CDK will create certificate automatically)
});

// API stack (HTTP API, Lambda handlers)
const apiStack = new ApiStack(app, `${stackPrefix}-ApiStack`, {
  env,
  stage,
  workosSecret: securityStack.workosSecret,
  dbSecret: securityStack.dbSecret,
  alarmTopic: monitoringStack.alarmTopic,
});

// Add dependencies
apiStack.addDependency(securityStack);
apiStack.addDependency(mediaStack);
apiStack.addDependency(monitoringStack);
databaseStack.addDependency(securityStack);

// Independent stacks - no dependencies needed
// Referenced to avoid unused variable warnings
publicAssetsStack.node.addValidation({
  validate: () => [],
});

monitoringStack.node.addValidation({
  validate: () => [],
});

costMonitoringStack.node.addValidation({
  validate: () => [],
});

cloudTrailStack.node.addValidation({
  validate: () => [],
});

// Pipeline stack (CI/CD) - only create for staging/production
if (stage === 'staging' || stage === 'production') {
  const pipelineStack = new PipelineStack(app, `${stackPrefix}-PipelineStack`, {
    env,
    stage,
    githubOwner: process.env.GITHUB_OWNER,
    githubRepo: process.env.GITHUB_REPO,
    githubBranch: process.env.GITHUB_BRANCH,
    dbSecret: securityStack.dbSecret,
    workosSecret: securityStack.workosSecret,
    hostedZoneId: process.env.HOSTED_ZONE_ID || '',
    hostedZoneName: process.env.HOSTED_ZONE_NAME,
  });

  pipelineStack.addDependency(securityStack);
}

// Apply global tags to all resources
cdk.Tags.of(app).add('Project', projectName);
cdk.Tags.of(app).add('Stage', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
