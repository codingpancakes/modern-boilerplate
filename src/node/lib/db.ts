import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import * as schema from '../db/schema';

let dbInstance: ReturnType<typeof drizzle> | null = null;
let dbUrl: string | null = null;

async function getDbUrl(): Promise<string> {
  // Return cached URL if available
  if (dbUrl) return dbUrl;

  // Option 1: Use DATABASE_URL from environment
  if (process.env.DATABASE_URL) {
    dbUrl = process.env.DATABASE_URL;
    return dbUrl;
  }

  // Option 2: Build from Secrets Manager
  if (process.env.DB_SECRET_ARN) {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
    const command = new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN });
    
    try {
      const response = await client.send(command);
      if (response.SecretString) {
        const secret = JSON.parse(response.SecretString);
        // Build connection string from secret
        const sslmode = secret.sslmode || 'require';
        const channelBinding = secret.channel_binding ? `&channel_binding=${secret.channel_binding}` : '';
        dbUrl = `postgresql://${secret.username}:${secret.password}@${secret.host}:${secret.port || 5432}/${secret.database}?sslmode=${sslmode}${channelBinding}`;
        return dbUrl;
      }
    } catch (error) {
      console.error('Failed to retrieve database secret:', error);
      throw new Error('Failed to retrieve database credentials');
    }
  }

  throw new Error('DATABASE_URL or DB_SECRET_ARN must be configured');
}

export async function getDb() {
  if (!dbInstance) {
    const url = await getDbUrl();
    const sql = neon(url);
    dbInstance = drizzle(sql as any, { schema });
  }
  return dbInstance;
}

export { schema };
