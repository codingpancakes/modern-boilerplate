import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { getDb } from '../../lib/db';
import { sessions } from '../../db/schema';
import { formatError, Errors } from '../../lib/errors';
import { eq } from 'drizzle-orm';
import { withPublicCors } from '../../lib/withPublicCors';

const logger = new Logger({ serviceName: 'daily-recording-ready-webhook' });

/**
 * Daily.co Webhook - Recording Ready
 * 
 * Triggered when a Daily.co recording is ready for download
 * Stores the recording URL in the session record
 * 
 * Expected payload from Daily.co:
 * {
 *   "event": "recording.ready",
 *   "room": "room-name",
 *   "session_id": "daily-session-id",
 *   "recording": {
 *     "id": "recording-id",
 *     "download_link": "https://...",
 *     "duration": 600,
 *     "start_time": 1234567890
 *   }
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
    const { event: eventType, room, session_id, recording } = payload;

    if (eventType !== 'recording.ready') {
      throw Errors.BadRequest(`Unexpected event type: ${eventType}`);
    }

    if (!session_id || !recording?.download_link) {
      throw Errors.BadRequest('Missing session_id or recording.download_link in webhook payload');
    }

    logger.info('Processing Daily.co recording ready webhook', {
      eventType,
      room,
      sessionId: session_id,
      recordingId: recording.id,
      duration: recording.duration,
      requestId
    });

    const db = await getDb();

    // Find session by rtc_session_id
    const sessionResult = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.rtcSessionId, session_id))
      .limit(1);

    if (!sessionResult.length) {
      throw Errors.NotFound(`Session not found with rtc_session_id: ${session_id}`);
    }

    const session = sessionResult[0];

    // Update session with recording URL
    await db
      .update(sessions)
      .set({
        recordingUrl: recording.download_link,
        updatedAt: new Date().toISOString()
      })
      .where(eq(sessions.id, session.id));

    logger.info('Session recording URL updated', {
      sessionId: session.id,
      rtcSessionId: session_id,
      recordingUrl: recording.download_link,
      recordingDuration: recording.duration,
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
          recordingUrl: recording.download_link,
          message: 'Recording URL saved successfully'
        }
      })
    };

  } catch (error) {
    logger.error('Error processing Daily.co recording ready webhook', { error, requestId });
    return formatError(error, requestId);
  }
};

export const handler = withPublicCors(handlerFn);
