#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { SecurityStack } from '../lib/security-stack';
import { DatabaseStack } from '../lib/database-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { MediaStack } from '../lib/media-stack';
import { PublicAssetsStack } from '../lib/public-assets-stack';

const app = new cdk.App();

const projectName = process.env.PROJECT_NAME || 'railbranch';
const stage = process.env.STAGE || 'dev';
const stackPrefix = `${projectName}-${stage}`;

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION || 'us-east-1',
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
});

// Media stack (S3 buckets, CloudFront CDN)
const mediaStack = new MediaStack(app, `${stackPrefix}-MediaStack`, {
  env,
  stage,
  domainName: process.env.HOSTED_ZONE_NAME || 'railbranch.services',
  hostedZoneId: process.env.HOSTED_ZONE_ID,
  // imagesCertArn: undefined (CDK will create certificate automatically)
});

// Public Assets stack (S3 bucket for public assets, CloudFront CDN)
const publicAssetsStack = new PublicAssetsStack(app, `${stackPrefix}-PublicAssetsStack`, {
  env,
  stage,
  domainName: process.env.HOSTED_ZONE_NAME || 'railbranch.services',
  hostedZoneId: process.env.HOSTED_ZONE_ID,
  // assetsCertArn: undefined (CDK will create certificate automatically)
});

// API stack (HTTP API, Lambda handlers)
const apiStack = new ApiStack(app, `${stackPrefix}-ApiStack`, {
  env,
  stage,
  workosSecret: securityStack.workosSecret,
  dbSecret: securityStack.dbSecret,
});

// Add dependencies
apiStack.addDependency(securityStack);
apiStack.addDependency(mediaStack);
databaseStack.addDependency(securityStack);

// Independent stacks - no dependencies needed
// Referenced to avoid unused variable warnings
publicAssetsStack.node.addValidation({
  validate: () => [],
});

monitoringStack.node.addValidation({
  validate: () => [],
});
