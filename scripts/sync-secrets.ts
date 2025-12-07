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

const projectName = envVars.PROJECT_NAME || 'postway';
const awsRegion = envVars.AWS_REGION || 'us-east-1';

// Define which secrets to sync
const secretMappings = [
  {
    name: 'WorkOS Credentials',
    secretId: `/${projectName}/${stage}/workos`,
    keys: ['WORKOS_CLIENT_ID'],
    jsonKeys: {
      clientId: 'WORKOS_CLIENT_ID',
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
  
  // Create or update secret
  try {
    const secretString = JSON.stringify(secretValue);
    
    if (secretExists) {
      // Update existing secret
      execSync(
        `aws secretsmanager put-secret-value --secret-id "${mapping.secretId}" --secret-string '${secretString}' --region ${awsRegion}`,
        { stdio: 'pipe' }
      );
      console.log(`   ✅ Updated secret: ${mapping.secretId}\n`);
    } else {
      // Create new secret
      execSync(
        `aws secretsmanager create-secret --name "${mapping.secretId}" --description "${mapping.name} for ${stage}" --secret-string '${secretString}' --region ${awsRegion}`,
        { stdio: 'pipe' }
      );
      console.log(`   ✅ Created secret: ${mapping.secretId}\n`);
    }
  } catch (error) {
    console.error(`   ❌ Failed to sync ${mapping.name}:`, error);
  }
}

// Sync SSM parameters (non-sensitive config)
console.log('📝 Syncing SSM Parameters...');

const ssmMappings = [
  { name: 'Hosted Zone ID', key: 'HOSTED_ZONE_ID', paramName: `/${projectName}/${stage}/hosted-zone-id` },
  { name: 'Hosted Zone Name', key: 'HOSTED_ZONE_NAME', paramName: `/${projectName}/${stage}/hosted-zone-name` },
  { name: 'Images Bucket', key: 'IMAGES_BUCKET', paramName: `/${projectName}/${stage}/images-bucket` },
  { name: 'Images CDN URL', key: 'IMAGES_CDN_URL', paramName: `/${projectName}/${stage}/images-cdn-url` },
  { name: 'API Domain', key: 'API_DOMAIN', paramName: `/${projectName}/${stage}/api-domain` },
  { name: 'CORS Domain Patterns', key: 'CORS_DOMAIN_PATTERNS', paramName: `/${projectName}/${stage}/cors-domain-patterns` },
  { name: 'CORS Exact Origins', key: 'CORS_EXACT_ORIGINS', paramName: `/${projectName}/${stage}/cors-exact-origins` },
  { name: 'CORS Parent Domains', key: 'CORS_PARENT_DOMAINS', paramName: `/${projectName}/${stage}/cors-parent-domains` },
];

for (const mapping of ssmMappings) {
  if (!envVars[mapping.key]) {
    console.log(`   ⚠️  ${mapping.name} (${mapping.key}) not found in .env.${stage}`);
    continue;
  }
  
  try {
    // Always use --overwrite to update existing or create new
    execSync(
      `aws ssm put-parameter --name "${mapping.paramName}" --value "${envVars[mapping.key]}" --type String --description "${mapping.name} for ${stage}" --overwrite --region ${awsRegion}`,
      { stdio: 'pipe' }
    );
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
