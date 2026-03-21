#!/usr/bin/env tsx
/**
 * Sync environment variables from .env files to AWS Secrets Manager
 * 
 * Usage:
 *   pnpm sync-secrets staging
 *   pnpm sync-secrets production
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const stage = process.argv[2];

if (!stage || !['staging', 'production'].includes(stage)) {
  console.error('❌ Usage: pnpm run sync-secrets <staging|production>');
  process.exit(1);
}

const envFile = path.join(process.cwd(), `.env.${stage}`);

if (!fs.existsSync(envFile)) {
  console.error(`❌ File not found: ${envFile}`);
  process.exit(1);
}

console.log(`🔄 Syncing ${stage} environment variables to AWS Secrets Manager...\n`);

// Load .env file
const envContent = fs.readFileSync(envFile, 'utf-8');
const envVars: Record<string, string> = {};

envContent.split('\n').forEach((line) => {
  line = line.trim();
  
  // Skip comments and empty lines
  if (!line || line.startsWith('#')) return;
  
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

// Validate required environment variables
if (!envVars.PROJECT_NAME) {
  console.error('❌ PROJECT_NAME is required in .env file');
  process.exit(1);
}
if (!envVars.AWS_REGION) {
  console.error('❌ AWS_REGION is required in .env file');
  process.exit(1);
}
if (!envVars.STAGE) {
  console.error('❌ STAGE is required in .env file');
  process.exit(1);
}

const projectName = envVars.PROJECT_NAME;
const awsRegion = envVars.AWS_REGION;

// Define which secrets to sync
const secretMappings = [
  {
    name: 'WorkOS Credentials',
    secretId: `/${projectName}/${stage}/workos`,
    keys: ['WORKOS_CLIENT_ID', 'WORKOS_WEBHOOK_SECRET'],
    jsonKeys: {
      clientId: 'WORKOS_CLIENT_ID',
      webhookSecret: 'WORKOS_WEBHOOK_SECRET',
    },
  },
  {
    name: 'Database Credentials',
    secretId: `/${projectName}/${stage}/database`,
    keys: ['DATABASE_URL'],
    jsonKeys: {
      url: 'DATABASE_URL',
    },
  },
];

// Sync each secret
for (const mapping of secretMappings) {
  console.log(`📦 Syncing ${mapping.name}...`);
  
  // Build JSON object from env vars
  const secretValue: Record<string, string> = {};
  let hasValues = false;
  
  for (const [jsonKey, envKey] of Object.entries(mapping.jsonKeys)) {
    if (envVars[envKey]) {
      secretValue[jsonKey] = envVars[envKey];
      hasValues = true;
      console.log(`   ✓ ${envKey}`);
    } else {
      console.log(`   ⚠️  ${envKey} not found in .env.${stage}`);
    }
  }
  
  if (!hasValues) {
    console.log(`   ⏭️  Skipping (no values found)\n`);
    continue;
  }
  
  // Check if secret exists
  let secretExists = false;
  try {
    execSync(`aws secretsmanager describe-secret --secret-id "${mapping.secretId}" --region ${awsRegion}`, {
      stdio: 'pipe',
    });
    secretExists = true;
  } catch {
    // Secret doesn't exist
  }
  
  // Create or update secret — pipe via stdin so values never appear in `ps` output
  try {
    const secretString = JSON.stringify(secretValue);
    
    if (secretExists) {
      execSync(
        `aws secretsmanager put-secret-value --secret-id "${mapping.secretId}" --secret-string file:///dev/stdin --region ${awsRegion}`,
        { input: secretString, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.log(`   ✅ Updated secret: ${mapping.secretId}\n`);
    } else {
      execSync(
        `aws secretsmanager create-secret --name "${mapping.secretId}" --description "${mapping.name} for ${stage}" --secret-string file:///dev/stdin --region ${awsRegion}`,
        { input: secretString, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.log(`   ✅ Created secret: ${mapping.secretId}\n`);
    }
  } catch (error) {
    console.error(`   ❌ Failed to sync ${mapping.name}:`, error);
  }
}

// Sync SSM parameters (non-sensitive config)
console.log('📝 Syncing SSM Parameters...');

// Helper: put SSM parameter safely via --cli-input-json to avoid shell injection
function putSsmParameter(name: string, value: string, description: string) {
  const jsonInput = JSON.stringify({
    Name: name,
    Value: value,
    Type: 'String',
    Description: description,
    Overwrite: true,
  });
  execSync(
    `aws ssm put-parameter --cli-input-json file:///dev/stdin --region ${awsRegion}`,
    { input: jsonInput, stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

// First, sync PROJECT_NAME to a global parameter (used by CI/CD pipeline)
try {
  putSsmParameter('/github/project-name', projectName, 'Project name for CI/CD pipeline');
  console.log(`   ✓ Global PROJECT_NAME parameter`);
} catch (error) {
  console.error(`   ❌ Failed to sync global PROJECT_NAME:`, error);
}

const ssmMappings = [
  // Required infrastructure variables
  { name: 'Hosted Zone ID', key: 'HOSTED_ZONE_ID', paramName: `/${projectName}/${stage}/hosted-zone-id`, required: true },
  { name: 'Hosted Zone Name', key: 'HOSTED_ZONE_NAME', paramName: `/${projectName}/${stage}/hosted-zone-name`, required: true },
  
  // GitHub configuration (required for CI/CD)
  { name: 'GitHub Owner', key: 'GITHUB_OWNER', paramName: `/${projectName}/${stage}/github-owner`, required: true },
  { name: 'GitHub Repo', key: 'GITHUB_REPO', paramName: `/${projectName}/${stage}/github-repo`, required: true },
  { name: 'GitHub Branch', key: 'GITHUB_BRANCH', paramName: `/${projectName}/${stage}/github-branch`, required: true },
  
  // Optional infrastructure variables (have defaults in code)
  { name: 'Images Bucket', key: 'IMAGES_BUCKET', paramName: `/${projectName}/${stage}/images-bucket`, required: false },
  { name: 'Images Bucket Prefix', key: 'IMAGES_BUCKET_PREFIX', paramName: `/${projectName}/${stage}/images-bucket-prefix`, required: false },
  { name: 'Images CDN URL', key: 'IMAGES_CDN_URL', paramName: `/${projectName}/${stage}/images-cdn-url`, required: false },
  { name: 'API Domain', key: 'API_DOMAIN', paramName: `/${projectName}/${stage}/api-domain`, required: false },
  
  // CORS configuration (optional)
  { name: 'CORS Domain Patterns', key: 'CORS_DOMAIN_PATTERNS', paramName: `/${projectName}/${stage}/cors-domain-patterns`, required: false },
  { name: 'CORS Exact Origins', key: 'CORS_EXACT_ORIGINS', paramName: `/${projectName}/${stage}/cors-exact-origins`, required: false },
  { name: 'CORS Parent Domains', key: 'CORS_PARENT_DOMAINS', paramName: `/${projectName}/${stage}/cors-parent-domains`, required: false },
  
  // Monitoring (optional)
  { name: 'Alert Email', key: 'ALERT_EMAIL', paramName: `/${projectName}/${stage}/alert-email`, required: false },
];

for (const mapping of ssmMappings) {
  if (!envVars[mapping.key]) {
    if (mapping.required) {
      console.error(`   ❌ ${mapping.name} (${mapping.key}) is REQUIRED but not found in .env.${stage}`);
      process.exit(1);
    } else {
      console.log(`   ⏭️  ${mapping.name} (${mapping.key}) not found (optional)`);
      continue;
    }
  }
  
  try {
    putSsmParameter(mapping.paramName, envVars[mapping.key], `${mapping.name} for ${stage}`);
    console.log(`   ✓ ${mapping.name}`);
  } catch (error) {
    console.error(`   ❌ Failed to sync ${mapping.name}:`, error);
  }
}

console.log('\n✅ Sync complete!\n');
console.log('📋 Summary:');
console.log(`   Stage: ${stage}`);
console.log(`   Secrets Manager: /${projectName}/${stage}/*`);
console.log(`   SSM Parameters: /${projectName}/${stage}/*`);
console.log('\n🔍 Verify with:');
console.log(`   aws secretsmanager list-secrets --filters Key=name,Values=/${projectName}/${stage}`);
console.log(`   aws ssm get-parameters-by-path --path /${projectName}/${stage}`);
