import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

async function getDbUrl(): Promise<string> {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  if (process.env.DB_SECRET_ARN) {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const command = new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN });
    
    const response = await client.send(command);
    if (response.SecretString) {
      const secret = JSON.parse(response.SecretString);
      return `postgresql://${secret.username}:${secret.password}@${secret.host}:${secret.port}/${secret.dbname}?sslmode=require`;
    }
  }

  throw new Error('DATABASE_URL or DB_SECRET_ARN must be configured');
}

async function runMigrations() {
  console.log('Starting database migrations...');
  
  try {
    const dbUrl = await getDbUrl();
    const sql = neon(dbUrl);
    const db = drizzle(sql as any);

    await migrate(db, {
      migrationsFolder: path.join(__dirname, '../src/node/db/migrations'),
    });

    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runMigrations();
}

// Export for Lambda handler
export const handler = async () => {
  await runMigrations();
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Migrations completed' }),
  };
};
