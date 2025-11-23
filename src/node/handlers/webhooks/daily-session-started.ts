import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { getDb } from '../../lib/db';
import { sessions, sessionParticipants } from '../../db/schema';
import { formatError, Errors } from '../../lib/errors';
import { eq, and, sql } from 'drizzle-orm';
import { withPublicCors } from '../../lib/withPublicCors';

const logger = new Logger({ serviceName: 'daily-session-started-webhook' });
const tracer = new Tracer({ serviceName: 'daily-session-started-webhook' });

/**
 * Daily.co Webhook - Session Started
 * 
 * Triggered when a Daily.co room session starts (first participant joins)
 * Updates session status and records actual start time
 * 
 * Expected payload from Daily.co:
 * {
 *   "event": "room.session-started",
 *   "room": "room-name",
 *   "session_id": "daily-session-id",
 *   "start_time": 1234567890
 * }
 */
const handlerFn = async (event: APIGatewayProxyEventV2, context: Context) => {
  const requestId = context.awsRequestId;
  logger.addContext(context);

  try {
    if (!event.body) {
      throw Errors.BadRequest('Request body is required');
    }

    const payload = JSON.parse(event.body);
    const { event: eventType, room, session_id, start_time } = payload;

    if (eventType !== 'room.session-started') {
      throw Errors.BadRequest(`Unexpected event type: ${eventType}`);
    }

    if (!session_id) {
      throw Errors.BadRequest('Missing session_id in webhook payload');
    }

    logger.info('Processing Daily.co session started webhook', {
      eventType,
      room,
      sessionId: session_id,
      startTime: start_time,
      requestId
    });

    const db = await getDb();

    // Find session by rtc_session_id (Daily.co session ID)
    const sessionResult = await db
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(eq(sessions.rtcSessionId, session_id))
      .limit(1);

    if (!sessionResult.length) {
      throw Errors.NotFound(`Session not found with rtc_session_id: ${session_id}`);
    }

    const session = sessionResult[0];
    const actualStartAt = start_time ? new Date(start_time * 1000).toISOString() : new Date().toISOString();

    // Update session status to indicate it's active (keep as provisioned until we determine completion)
    await db
      .update(sessions)
      .set({
        actualStartAt,
        updatedAt: new Date().toISOString()
      })
      .where(eq(sessions.id, session.id));

    logger.info('Session start time recorded', {
      sessionId: session.id,
      rtcSessionId: session_id,
      actualStartAt,
      previousStatus: session.status,
      requestId
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: {
          sessionId: session.id,
          rtcSessionId: session_id,
          actualStartAt,
          message: 'Session start recorded successfully'
        }
      })
    };

  } catch (error) {
    logger.error('Error processing Daily.co session started webhook', { error, requestId });
    return formatError(error, requestId);
  }
};

export const handler = withPublicCors(handlerFn);
