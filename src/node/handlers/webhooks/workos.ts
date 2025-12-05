import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createHmac } from 'crypto';
import { getDb } from '../../lib/db';
import { users, organizations, authIdentities, idempotencyKeys } from '../../db/schema';
import { validate, webhookSchemas } from '../../lib/validation';
import { createSuccessResponse } from '../../lib/response';
import { formatError, Errors } from '../../lib/errors';
import { withPublicCors } from '../../lib/withPublicCors';
import { eq, and } from 'drizzle-orm';

const logger = new Logger({ serviceName: 'workos-webhook' });
const tracer = new Tracer({ serviceName: 'workos-webhook' });

// WorkOS webhook data types
interface WorkOSUserData {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  [key: string]: unknown;
}

interface WorkOSOrgData {
  name: string;
  [key: string]: unknown;
}

let webhookSecret: string | null = null;

async function getWebhookSecret(): Promise<string> {
  if (webhookSecret) return webhookSecret;

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const command = new GetSecretValueCommand({ SecretId: process.env.WORKOS_SECRET_ARN });
  
  const response = await client.send(command);
  if (response.SecretString) {
    const secret = JSON.parse(response.SecretString);
    webhookSecret = secret.webhookSecret;
    if (!webhookSecret) {
      throw new Error('WORKOS_WEBHOOK_SECRET environment variable is required');
    }

    return webhookSecret;
  }
  
  throw new Error('Failed to retrieve webhook secret');
}

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return signature === expectedSignature;
}

const webhookHandler = async (event: APIGatewayProxyEventV2, context: Context) => {
  const requestId = context.awsRequestId;
  logger.addContext(context);

  try {
    // Get signature from headers
    const signature = event.headers['workos-signature'] || event.headers['WorkOS-Signature'];
    if (!signature) {
      throw Errors.Unauthorized();
    }

    // Verify signature
    const secret = await getWebhookSecret();
    const payload = event.body || '';
    
    if (!verifySignature(payload, signature, secret)) {
      logger.warn('Invalid webhook signature');
      throw Errors.Unauthorized();
    }

    // Parse and validate webhook event
    const webhookEvent = validate(webhookSchemas.workos, JSON.parse(payload));
    
    logger.info('Processing WorkOS webhook', { 
      eventId: webhookEvent.id, 
      eventType: webhookEvent.event 
    });

    const db = await getDb();

    // Check for duplicate event (idempotency) using WorkOS event ID
    const idempotencyKey = `workos-webhook-${webhookEvent.id}`;
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, idempotencyKey))
      .limit(1);

    if (existing) {
      logger.info('Webhook event already processed', { eventId: webhookEvent.id });
      return createSuccessResponse({ status: 'already_processed' });
    }

    // Store idempotency key
    await db.insert(idempotencyKeys).values({
      key: idempotencyKey,
      requestHash: webhookEvent.id,
      status: 'processing',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    });

    // Process based on event type
    switch (webhookEvent.event) {
      case 'user.created':
      case 'user.updated': {
        const userData = webhookEvent.data as WorkOSUserData;
        
        // First, check if user exists via auth_identities
        const [existingAuth] = await db
          .select({ userId: authIdentities.userId })
          .from(authIdentities)
          .where(and(
            eq(authIdentities.providerType, 'workos'),
            eq(authIdentities.providerSubject, userData.id)
          ))
          .limit(1);

        if (existingAuth && existingAuth.userId) {
          // Update existing user
          await db
            .update(users)
            .set({
              email: userData.email,
              firstName: userData.first_name,
              lastName: userData.last_name,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(users.id, existingAuth.userId));
        } else {
          // Create new user and auth identity
          const [newUser] = await db
            .insert(users)
            .values({
              email: userData.email,
              firstName: userData.first_name,
              lastName: userData.last_name,
              type: 'member', // Default user type for WorkOS users
            })
            .returning({ id: users.id });

          await db
            .insert(authIdentities)
            .values({
              userId: newUser.id,
              providerType: 'workos',
              providerSubject: userData.id,
              emailAtProvider: userData.email,
            });
        }
        break;
      }

      case 'user.deleted': {
        const userData = webhookEvent.data as WorkOSUserData;
        
        // Find user via auth_identities and delete
        const [authIdentity] = await db
          .select({ userId: authIdentities.userId })
          .from(authIdentities)
          .where(and(
            eq(authIdentities.providerType, 'workos'),
            eq(authIdentities.providerSubject, userData.id)
          ))
          .limit(1);

        if (authIdentity && authIdentity.userId) {
          // Delete user (auth_identities will cascade)
          await db
            .delete(users)
            .where(eq(users.id, authIdentity.userId));
        }
        break;
      }

      case 'organization.created':
      case 'organization.updated': {
        const orgData = webhookEvent.data as WorkOSOrgData;
        
        // For organizations, we'll use name as identifier since no workosId or slug column
        // Note: This may create duplicates if multiple orgs have same name
        await db
          .insert(organizations)
          .values({
            name: orgData.name,
          });
        break;
      }

      case 'organization.deleted': {
        const orgData = webhookEvent.data as WorkOSOrgData;
        
        // Delete organization by name (not ideal but no other identifier available)
        await db
          .delete(organizations)
          .where(eq(organizations.name, orgData.name));
        break;
      }
    }

    // Mark idempotency key as completed
    await db
      .update(idempotencyKeys)
      .set({
        status: 'completed',
        completedAt: new Date().toISOString(),
      })
      .where(eq(idempotencyKeys.key, idempotencyKey));

    logger.info('Webhook processed successfully', { eventId: webhookEvent.id });

    return createSuccessResponse({ status: 'processed' });
  } catch (error) {
    logger.error('Error processing webhook', { error });
    return formatError(error, requestId);
  }
};

export const handler = withPublicCors(webhookHandler);
