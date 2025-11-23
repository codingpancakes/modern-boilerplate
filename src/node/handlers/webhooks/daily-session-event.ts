import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { getDb } from '../../lib/db';
import { sessions, sessionParticipants, appointments } from '../../db/schema';
import { formatError, Errors } from '../../lib/errors';
import { eq, and } from 'drizzle-orm';
import { withPublicCors } from '../../lib/withPublicCors';

const logger = new Logger({ serviceName: 'daily-session-event-webhook' });

/**
 * Daily.co Unified Webhook Handler
 * 
 * Handles multiple Daily.co events in one endpoint:
 * - participant.joined
 * - participant.left
 * - recording.stopped (triggers session completion)
 * 
 * This is the PRODUCTION webhook - simpler and more reliable than separate endpoints
 */
const handlerFn = async (event: APIGatewayProxyEventV2, context: Context) => {
  const requestId = context.awsRequestId;
  logger.addContext(context);

  try {
    if (!event.body) {
      throw Errors.BadRequest('Request body is required');
    }

    const payload = JSON.parse(event.body);
    const { event: eventType, room, session_id, participant, recording } = payload;

    logger.info('Daily.co webhook received', {
      eventType,
      room,
      sessionId: session_id,
      requestId
    });

    const db = await getDb();

    // Find session by rtc_session_id
    const sessionResult = await db
      .select({ 
        id: sessions.id,
        status: sessions.status,
        appointmentId: sessions.appointmentId
      })
      .from(sessions)
      .where(eq(sessions.rtcSessionId, session_id))
      .limit(1);

    if (!sessionResult.length) {
      throw Errors.NotFound(`Session not found with rtc_session_id: ${session_id}`);
    }

    const session = sessionResult[0];

    // Handle different event types
    switch (eventType) {
      case 'participant.joined':
        return await handleParticipantJoined(db, session, participant, requestId);
      
      case 'participant.left':
        return await handleParticipantLeft(db, session, participant, requestId);
      
      case 'recording.stopped':
        return await handleRecordingStopped(db, session, recording, requestId);
      
      default:
        logger.warn('Unhandled event type', { eventType, requestId });
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            success: true,
            message: `Event type ${eventType} acknowledged but not processed`
          })
        };
    }

  } catch (error) {
    logger.error('Error processing Daily.co webhook', { error, requestId });
    return formatError(error, requestId);
  }
};

async function handleParticipantJoined(db: any, session: any, participant: any, requestId: string) {
  const joinedAt = participant.join_time 
    ? new Date(participant.join_time * 1000).toISOString() 
    : new Date().toISOString();

  // Find participant record
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
    logger.warn('Participant not pre-registered', {
      sessionId: session.id,
      userId: participant.user_id,
      requestId
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, message: 'Participant not pre-registered' })
    };
  }

  await db
    .update(sessionParticipants)
    .set({
      joinedAt,
      attendanceStatus: 'attended'
    })
    .where(eq(sessionParticipants.id, participantResult[0].id));

  logger.info('Participant join recorded', {
    sessionId: session.id,
    participantId: participantResult[0].id,
    joinedAt,
    requestId
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      success: true,
      data: { sessionId: session.id, participantId: participantResult[0].id, joinedAt }
    })
  };
}

async function handleParticipantLeft(db: any, session: any, participant: any, requestId: string) {
  const leftAt = participant.leave_time 
    ? new Date(participant.leave_time * 1000).toISOString() 
    : new Date().toISOString();

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
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, message: 'Participant not found' })
    };
  }

  const participantRecord = participantResult[0];
  let attendanceStatus: 'attended' | 'left_early' | 'partial' = 'attended';
  
  if (participantRecord.joinedAt) {
    const durationSeconds = (new Date(leftAt).getTime() - new Date(participantRecord.joinedAt).getTime()) / 1000;
    if (durationSeconds < 600) attendanceStatus = 'partial';
    if (durationSeconds < 300) attendanceStatus = 'left_early';
  }

  await db
    .update(sessionParticipants)
    .set({ leftAt, attendanceStatus })
    .where(eq(sessionParticipants.id, participantRecord.id));

  logger.info('Participant leave recorded', {
    sessionId: session.id,
    participantId: participantRecord.id,
    leftAt,
    attendanceStatus,
    requestId
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      success: true,
      data: { sessionId: session.id, participantId: participantRecord.id, leftAt, attendanceStatus }
    })
  };
}

async function handleRecordingStopped(db: any, session: any, recording: any, requestId: string) {
  // Recording stopped = session is truly over
  // Calculate final status based on participant attendance
  
  const MIN_DURATION_SECONDS = 600; // 10 minutes
  const actualEndAt = new Date().toISOString();

  const participantsResult = await db
    .select({
      id: sessionParticipants.id,
      userId: sessionParticipants.userId,
      role: sessionParticipants.role,
      joinedAt: sessionParticipants.joinedAt,
      leftAt: sessionParticipants.leftAt
    })
    .from(sessionParticipants)
    .where(eq(sessionParticipants.sessionId, session.id));

  const host = participantsResult.find((p: any) => p.role === 'host');
  const attendees = participantsResult.filter((p: any) => p.role === 'attendee');

  let sessionStatus: 'held' | 'no_show' | 'canceled' = 'canceled';
  let appointmentStatus: 'completed' | 'canceled' = 'canceled';

  if (host && attendees.length > 0) {
    const hostDuration = host.joinedAt && host.leftAt 
      ? (new Date(host.leftAt).getTime() - new Date(host.joinedAt).getTime()) / 1000
      : 0;

    const maxAttendeeDuration = Math.max(...attendees.map((a: any) => {
      if (a.joinedAt && a.leftAt) {
        return (new Date(a.leftAt).getTime() - new Date(a.joinedAt).getTime()) / 1000;
      }
      return 0;
    }), 0);

    if (hostDuration >= MIN_DURATION_SECONDS && maxAttendeeDuration >= MIN_DURATION_SECONDS) {
      sessionStatus = 'held';
      appointmentStatus = 'completed';
      
      // Update all participants
      for (const attendee of attendees) {
        const duration = attendee.joinedAt && attendee.leftAt
          ? (new Date(attendee.leftAt).getTime() - new Date(attendee.joinedAt).getTime()) / 1000
          : 0;
        const status = duration >= MIN_DURATION_SECONDS ? 'attended' : 'partial';
        await db.update(sessionParticipants).set({ attendanceStatus: status }).where(eq(sessionParticipants.id, attendee.id));
      }
      await db.update(sessionParticipants).set({ attendanceStatus: 'attended' }).where(eq(sessionParticipants.id, host.id));
    } else if (maxAttendeeDuration < MIN_DURATION_SECONDS) {
      sessionStatus = 'no_show';
      appointmentStatus = 'completed';
      for (const attendee of attendees) {
        await db.update(sessionParticipants).set({ attendanceStatus: 'no_show' }).where(eq(sessionParticipants.id, attendee.id));
      }
    }
  }

  // Update session
  await db.update(sessions).set({
    status: sessionStatus,
    actualEndAt,
    endedAt: actualEndAt,
    recordingUrl: recording?.download_link || null,
    updatedAt: new Date().toISOString()
  }).where(eq(sessions.id, session.id));

  // Update appointment
  await db.update(appointments).set({
    status: appointmentStatus,
    updatedAt: new Date().toISOString()
  }).where(eq(appointments.id, session.appointmentId));

  logger.info('Session completed via recording.stopped', {
    sessionId: session.id,
    sessionStatus,
    appointmentStatus,
    requestId
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      success: true,
      data: {
        sessionId: session.id,
        sessionStatus,
        appointmentStatus,
        message: 'Session completed successfully'
      }
    })
  };
}

export const handler = withPublicCors(handlerFn);
