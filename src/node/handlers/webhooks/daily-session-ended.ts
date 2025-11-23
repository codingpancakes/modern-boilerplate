import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { getDb } from '../../lib/db';
import { sessions, sessionParticipants, appointments } from '../../db/schema';
import { formatError, Errors } from '../../lib/errors';
import { eq, and, sql } from 'drizzle-orm';
import { withPublicCors } from '../../lib/withPublicCors';

const logger = new Logger({ serviceName: 'daily-session-ended-webhook' });

/**
 * Daily.co Webhook - Session Ended
 * 
 * Triggered when a Daily.co room session ends (all participants leave)
 * Determines session outcome based on participant attendance:
 * - "held" if both host and attendee were present for 10+ minutes
 * - "no_show" if attendee never joined or was present < 10 minutes
 * - "canceled" if session ended without proper attendance
 * 
 * Expected payload from Daily.co:
 * {
 *   "event": "room.session-ended",
 *   "room": "room-name",
 *   "session_id": "daily-session-id",
 *   "end_time": 1234567890,
 *   "duration": 600,
 *   "participants": [
 *     {
 *       "user_id": "user-123",
 *       "duration": 650
 *     }
 *   ]
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
    const { event: eventType, room, session_id, end_time, duration, participants } = payload;

    if (eventType !== 'room.session-ended') {
      throw Errors.BadRequest(`Unexpected event type: ${eventType}`);
    }

    if (!session_id) {
      throw Errors.BadRequest('Missing session_id in webhook payload');
    }

    logger.info('Processing Daily.co session ended webhook', {
      eventType,
      room,
      sessionId: session_id,
      endTime: end_time,
      duration,
      participantCount: participants?.length || 0,
      requestId
    });

    const db = await getDb();

    // Find session by rtc_session_id
    const sessionResult = await db
      .select({
        id: sessions.id,
        status: sessions.status,
        actualStartAt: sessions.actualStartAt,
        appointmentId: sessions.appointmentId
      })
      .from(sessions)
      .where(eq(sessions.rtcSessionId, session_id))
      .limit(1);

    if (!sessionResult.length) {
      throw Errors.NotFound(`Session not found with rtc_session_id: ${session_id}`);
    }

    const session = sessionResult[0];
    const actualEndAt = end_time ? new Date(end_time * 1000).toISOString() : new Date().toISOString();

    // Get all session participants to determine attendance
    const participantsResult = await db
      .select({
        id: sessionParticipants.id,
        userId: sessionParticipants.userId,
        role: sessionParticipants.role,
        joinedAt: sessionParticipants.joinedAt,
        leftAt: sessionParticipants.leftAt,
        attendanceStatus: sessionParticipants.attendanceStatus
      })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, session.id));

    logger.info('Session participants retrieved', {
      sessionId: session.id,
      participantCount: participantsResult.length,
      participants: participantsResult.map(p => ({
        role: p.role,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt
      })),
      requestId
    });

    // Determine session outcome based on attendance
    const MIN_DURATION_SECONDS = 600; // 10 minutes
    let sessionStatus: 'held' | 'no_show' | 'canceled' = 'canceled';
    let appointmentStatus: 'completed' | 'canceled' = 'canceled';

    // Check if we have host and attendee
    const host = participantsResult.find(p => p.role === 'host');
    const attendees = participantsResult.filter(p => p.role === 'attendee');

    if (host && attendees.length > 0) {
      // Calculate duration for each participant
      const hostDuration = host.joinedAt && host.leftAt 
        ? (new Date(host.leftAt).getTime() - new Date(host.joinedAt).getTime()) / 1000
        : 0;

      const attendeeDurations = attendees.map(attendee => {
        if (attendee.joinedAt && attendee.leftAt) {
          return (new Date(attendee.leftAt).getTime() - new Date(attendee.joinedAt).getTime()) / 1000;
        }
        return 0;
      });

      const maxAttendeeDuration = Math.max(...attendeeDurations, 0);

      logger.info('Participant durations calculated', {
        sessionId: session.id,
        hostDuration,
        attendeeDurations,
        maxAttendeeDuration,
        minRequired: MIN_DURATION_SECONDS,
        requestId
      });

      // Session is "held" if both host and at least one attendee were present for 10+ minutes
      if (hostDuration >= MIN_DURATION_SECONDS && maxAttendeeDuration >= MIN_DURATION_SECONDS) {
        sessionStatus = 'held';
        appointmentStatus = 'completed';
        
        // Update attendee attendance status
        for (const attendee of attendees) {
          const attendeeDuration = attendee.joinedAt && attendee.leftAt
            ? (new Date(attendee.leftAt).getTime() - new Date(attendee.joinedAt).getTime()) / 1000
            : 0;

          const attendanceStatus = attendeeDuration >= MIN_DURATION_SECONDS ? 'attended' : 'partial';
          
          await db
            .update(sessionParticipants)
            .set({
              attendanceStatus
            })
            .where(eq(sessionParticipants.id, attendee.id));
        }

        // Update host attendance
        await db
          .update(sessionParticipants)
          .set({
            attendanceStatus: 'attended'
          })
          .where(eq(sessionParticipants.id, host.id));

      } else if (maxAttendeeDuration < MIN_DURATION_SECONDS) {
        // Attendee didn't show up or left too early
        sessionStatus = 'no_show';
        appointmentStatus = 'completed'; // Still mark appointment as completed, but session as no-show

        // Update attendee as no-show
        for (const attendee of attendees) {
          await db
            .update(sessionParticipants)
            .set({
              attendanceStatus: 'no_show'
            })
            .where(eq(sessionParticipants.id, attendee.id));
        }
      }
    }

    // Update session with final status
    await db
      .update(sessions)
      .set({
        status: sessionStatus,
        actualEndAt,
        endedAt: actualEndAt,
        updatedAt: new Date().toISOString()
      })
      .where(eq(sessions.id, session.id));

    // Update appointment status
    await db
      .update(appointments)
      .set({
        status: appointmentStatus,
        updatedAt: new Date().toISOString()
      })
      .where(eq(appointments.id, session.appointmentId));

    logger.info('Session and appointment status updated', {
      sessionId: session.id,
      rtcSessionId: session_id,
      sessionStatus,
      appointmentStatus,
      actualEndAt,
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
          sessionStatus,
          appointmentStatus,
          actualEndAt,
          message: 'Session ended and status updated successfully'
        }
      })
    };

  } catch (error) {
    logger.error('Error processing Daily.co session ended webhook', { error, requestId });
    return formatError(error, requestId);
  }
};

export const handler = withPublicCors(handlerFn);
