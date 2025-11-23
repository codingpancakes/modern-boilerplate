#!/usr/bin/env tsx
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Universal deployment script for all environments
async function deploy() {
  // Load environment file if specified
  const envFile = process.env.ENV_FILE;
  if (envFile) {
    const envPath = path.join(__dirname, '..', envFile);
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      console.log(`📄 Loaded environment from ${envFile}`);
    } else {
      console.error(`❌ Environment file ${envFile} not found`);
      process.exit(1);
    }
  }
  
  // Get stage and region AFTER loading env file
  const stage = process.env.STAGE || 'staging';
  const region = process.env.AWS_REGION || 'us-east-1';
  
  console.log(`🚀 Deploying ${stage.toUpperCase()} to ${region}...`);
  console.log(`🔗 API Domain: ${process.env.API_DOMAIN || 'CloudFront default (no custom domain)'}`);
  console.log(`🌐 CORS Patterns: ${process.env.CORS_DOMAIN_PATTERNS || 'not set'}`);
  console.log('');
  
  // Validate environment variables
  const requiredEnvVars = [
    'WORKOS_CLIENT_ID',
    'DATABASE_URL',
    'IMAGES_BUCKET',
    'IMAGES_CDN_URL',
    'CORS_DOMAIN_PATTERNS'
  ];
  
  const missing = requiredEnvVars.filter(env => !process.env[env]);
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  try {
    // Build TypeScript
    console.log('📦 Building TypeScript...');
    execSync('npm run build', { stdio: 'inherit' });
    
    // Run database migrations
    console.log(`🗄️ Running ${stage} database migrations...`);
    execSync('npm run migrate', { stdio: 'inherit' });
    
    // Get AWS profile from environment or use stage-specific default
    let awsProfile = process.env.AWS_PROFILE;
    if (!awsProfile) {
      // Auto-select profile based on stage
      switch(stage) {
        case 'production':
        case 'staging':
          awsProfile = 'outdream';
          break;
        default:
          awsProfile = 'default';
      }
    }
    console.log(`🔑 Using AWS Profile: ${awsProfile}`);
    
    // Bootstrap CDK (if needed)
    console.log(`🏗️ Bootstrapping CDK for ${stage}...`);
    try {
      execSync(`npx cdk bootstrap --region ${region} --profile ${awsProfile}`, { 
        stdio: 'inherit',
        env: {
          ...process.env,
          AWS_PROFILE: awsProfile
        }
      });
    } catch (error) {
      console.log('CDK already bootstrapped or bootstrap failed (continuing...)');
    }
    
    // Deploy infrastructure
    const projectName = process.env.PROJECT_NAME || 'railbranch';
    console.log(`☁️ Deploying ${projectName}-${stage} infrastructure...`);
    execSync(`npx cdk deploy "${projectName}-${stage}-*" --require-approval never --profile ${awsProfile}`, { 
      stdio: 'inherit',
      env: {
        ...process.env,
        PROJECT_NAME: projectName,
        STAGE: stage,
        AWS_REGION: region,
        AWS_PROFILE: awsProfile
      }
    });
    
    console.log(`✅ ${stage.toUpperCase()} deployment completed successfully!`);
    console.log(`\n📋 ${stage.toUpperCase()} environment ready:`);
    console.log('1. Check AWS CloudFormation console for stack outputs');
    console.log('2. Test the deployed endpoints');
    console.log('3. Monitor CloudWatch logs for any issues');
    if (stage === 'staging') {
      console.log('4. Ready for production deployment');
    }
    
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  deploy();
}
