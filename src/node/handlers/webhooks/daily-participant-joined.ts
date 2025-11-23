import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { getDb } from '../../lib/db';
import { sessions, sessionParticipants } from '../../db/schema';
import { formatError, Errors } from '../../lib/errors';
import { eq, and } from 'drizzle-orm';
import { withPublicCors } from '../../lib/withPublicCors';

const logger = new Logger({ serviceName: 'daily-participant-joined-webhook' });

/**
 * Daily.co Webhook - Participant Joined
 * 
 * Triggered when a participant joins a Daily.co room
 * Records the join time for attendance tracking
 * 
 * Expected payload from Daily.co:
 * {
 *   "event": "participant.joined",
 *   "room": "room-name",
 *   "session_id": "daily-session-id",
 *   "participant": {
 *     "user_id": "user-123",
 *     "user_name": "John Doe",
 *     "join_time": 1234567890
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
    const { event: eventType, room, session_id, participant } = payload;

    if (eventType !== 'participant.joined') {
      throw Errors.BadRequest(`Unexpected event type: ${eventType}`);
    }

    if (!session_id || !participant?.user_id) {
      throw Errors.BadRequest('Missing session_id or participant.user_id in webhook payload');
    }

    logger.info('Processing Daily.co participant joined webhook', {
      eventType,
      room,
      sessionId: session_id,
      participantUserId: participant.user_id,
      participantName: participant.user_name,
      joinTime: participant.join_time,
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
    const joinedAt = participant.join_time 
      ? new Date(participant.join_time * 1000).toISOString() 
      : new Date().toISOString();

    // Find participant record by session and user_id
    // Note: participant.user_id from Daily should match our userId
    const participantResult = await db
      .select({
        id: sessionParticipants.id,
        userId: sessionParticipants.userId,
        role: sessionParticipants.role
      })
      .from(sessionParticipants)
      .where(and(
        eq(sessionParticipants.sessionId, session.id),
        eq(sessionParticipants.userId, participant.user_id)
      ))
      .limit(1);

    if (!participantResult.length) {
      logger.warn('Participant not found in session_participants table', {
        sessionId: session.id,
        dailyUserId: participant.user_id,
        requestId
      });
      
      // Optionally create a participant record if they're not pre-registered
      // For now, we'll just log and return success
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: true,
          message: 'Participant not pre-registered, join time not recorded'
        })
      };
    }

    const participantRecord = participantResult[0];

    // Update participant with join time
    await db
      .update(sessionParticipants)
      .set({
        joinedAt,
        attendanceStatus: 'attended' // Provisional status, will be updated on session end
      })
      .where(eq(sessionParticipants.id, participantRecord.id));

    logger.info('Participant join time recorded', {
      sessionId: session.id,
      participantId: participantRecord.id,
      userId: participantRecord.userId,
      role: participantRecord.role,
      joinedAt,
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
          participantId: participantRecord.id,
          joinedAt,
          message: 'Participant join recorded successfully'
        }
      })
    };

  } catch (error) {
    logger.error('Error processing Daily.co participant joined webhook', { error, requestId });
    return formatError(error, requestId);
  }
};

export const handler = withPublicCors(handlerFn);
