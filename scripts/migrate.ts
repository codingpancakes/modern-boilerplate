// NOTE: This migration runner intentionally uses the `neon-http` driver.
// Unlike the application runtime (see src/node/lib/db.ts, which MUST use
// `neon-serverless` for interactive `db.transaction()` calls), drizzle's
// migrator runs each migration as its own statement batch and does not open an
// interactive transaction, so the lighter HTTP driver is correct here. Do NOT
// copy this import into application code.
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
      // sync-secrets.ts stores { url } format; support both url and RDS-style fields
      if (secret.url) return secret.url;
      return `postgresql://${secret.username}:${secret.password}@${secret.host}:${secret.port}/${secret.database || secret.dbname}?sslmode=require`;
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
