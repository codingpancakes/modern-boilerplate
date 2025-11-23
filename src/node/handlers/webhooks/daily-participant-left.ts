import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { getDb } from '../../lib/db';
import { sessions, sessionParticipants } from '../../db/schema';
import { formatError, Errors } from '../../lib/errors';
import { eq, and } from 'drizzle-orm';
import { withPublicCors } from '../../lib/withPublicCors';

const logger = new Logger({ serviceName: 'daily-participant-left-webhook' });

/**
 * Daily.co Webhook - Participant Left
 * 
 * Triggered when a participant leaves a Daily.co room
 * Records the leave time for attendance tracking
 * 
 * Expected payload from Daily.co:
 * {
 *   "event": "participant.left",
 *   "room": "room-name",
 *   "session_id": "daily-session-id",
 *   "participant": {
 *     "user_id": "user-123",
 *     "user_name": "John Doe",
 *     "leave_time": 1234567890,
 *     "duration": 600
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

    if (eventType !== 'participant.left') {
      throw Errors.BadRequest(`Unexpected event type: ${eventType}`);
    }

    if (!session_id || !participant?.user_id) {
      throw Errors.BadRequest('Missing session_id or participant.user_id in webhook payload');
    }

    logger.info('Processing Daily.co participant left webhook', {
      eventType,
      room,
      sessionId: session_id,
      participantUserId: participant.user_id,
      participantName: participant.user_name,
      leaveTime: participant.leave_time,
      duration: participant.duration,
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
    const leftAt = participant.leave_time 
      ? new Date(participant.leave_time * 1000).toISOString() 
      : new Date().toISOString();

    // Find participant record
    const participantResult = await db
      .select({
        id: sessionParticipants.id,
        userId: sessionParticipants.userId,
        role: sessionParticipants.role,
        joinedAt: sessionParticipants.joinedAt
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
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: true,
          message: 'Participant not pre-registered, leave time not recorded'
        })
      };
    }

    const participantRecord = participantResult[0];

    // Calculate attendance status based on duration
    let attendanceStatus: 'attended' | 'left_early' | 'partial' = 'attended';
    
    if (participantRecord.joinedAt) {
      const durationSeconds = (new Date(leftAt).getTime() - new Date(participantRecord.joinedAt).getTime()) / 1000;
      
      // Less than 10 minutes is considered partial attendance
      if (durationSeconds < 600) {
        attendanceStatus = 'partial';
      }
      // Less than 5 minutes is left early
      if (durationSeconds < 300) {
        attendanceStatus = 'left_early';
      }

      logger.info('Participant duration calculated', {
        sessionId: session.id,
        participantId: participantRecord.id,
        durationSeconds,
        attendanceStatus,
        requestId
      });
    }

    // Update participant with leave time and provisional attendance status
    await db
      .update(sessionParticipants)
      .set({
        leftAt,
        attendanceStatus // Provisional, final status determined when session ends
      })
      .where(eq(sessionParticipants.id, participantRecord.id));

    logger.info('Participant leave time recorded', {
      sessionId: session.id,
      participantId: participantRecord.id,
      userId: participantRecord.userId,
      role: participantRecord.role,
      leftAt,
      attendanceStatus,
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
          leftAt,
          attendanceStatus,
          message: 'Participant leave recorded successfully'
        }
      })
    };

  } catch (error) {
    logger.error('Error processing Daily.co participant left webhook', { error, requestId });
    return formatError(error, requestId);
  }
};

export const handler = withPublicCors(handlerFn);
