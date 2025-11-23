import { createHash } from 'crypto';
import { getDb } from './db';
import { idempotencyKeys } from '../db/schema';
import { eq, and, lt } from 'drizzle-orm';
import { ApiError } from './errors';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export interface IdempotencyOptions {
  ttlSeconds?: number;
}

export async function withIdempotency(
  event: APIGatewayProxyEventV2,
  handler: () => Promise<APIGatewayProxyResultV2>,
  options: IdempotencyOptions = {}
): Promise<APIGatewayProxyResultV2> {
  const idempotencyKey = event.headers['idempotency-key'] || event.headers['Idempotency-Key'];
  
  // If no idempotency key, just execute the handler
  if (!idempotencyKey) {
    return handler();
  }

  const db = await getDb();
  const requestHash = hashRequest(event);
  const ttl = options.ttlSeconds || 86400; // 24 hours default
  const expiresAt = new Date(Date.now() + ttl * 1000);

  // Check for existing idempotency key
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, idempotencyKey))
    .limit(1);

  if (existing) {
    // If request hash doesn't match, it's a different request with same key
    if (existing.requestHash !== requestHash) {
      throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key already used for different request');
    }

    // If still processing, return conflict
    if (existing.status === 'processing') {
      throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'Request is still being processed');
    }

    // Return cached response
    if (existing.status === 'completed' && existing.response) {
      return JSON.parse(existing.response);
    }
  }

  // Insert or update to processing status
  await db
    .insert(idempotencyKeys)
    .values({
      key: idempotencyKey,
      requestHash,
      status: 'processing',
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .onConflictDoUpdate({
      target: idempotencyKeys.key,
      set: {
        status: 'processing',
        updatedAt: new Date().toISOString(),
      },
    });

  try {
    // Execute the handler
    const response = await handler();

    // Store successful response
    await db
      .update(idempotencyKeys)
      .set({
        status: 'completed',
        response: JSON.stringify(response),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(idempotencyKeys.key, idempotencyKey));

    return response;
  } catch (error) {
    // Mark as failed
    await db
      .update(idempotencyKeys)
      .set({
        status: 'failed',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(idempotencyKeys.key, idempotencyKey));

    throw error;
  }
}

function hashRequest(event: APIGatewayProxyEventV2): string {
  const data = {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    body: event.body,
    queryParams: event.queryStringParameters,
  };
  
  return createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
}

// Janitor function to clean up expired keys
export async function cleanupExpiredKeys(): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  
  const result = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, now));

  return result.rowCount || 0;
}
