import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'api' });

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function formatError(error: any, requestId?: string) {
  const timestamp = new Date().toISOString();
  
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: {
          code: error.code,
          details: error.details,
          requestId,
          timestamp,
        },
      }),
    };
  }

  // Log unexpected errors
  logger.error('Unexpected error', { error, requestId });

  return {
    statusCode: 500,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      success: false,
      error: 'Internal server error',
      details: {
        code: 'INTERNAL_ERROR',
        requestId,
        timestamp,
      },
    }),
  };
}

// Common error types
export const Errors = {
  Unauthorized: () => new ApiError(401, 'UNAUTHORIZED', 'Authentication required'),
  Forbidden: () => new ApiError(403, 'FORBIDDEN', 'Access denied'),
  NotFound: (resource: string) => new ApiError(404, 'NOT_FOUND', `${resource} not found`),
  BadRequest: (message: string, details?: any) => new ApiError(400, 'BAD_REQUEST', message, details),
  Conflict: (message: string) => new ApiError(409, 'CONFLICT', message),
  ValidationError: (details: any) => new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', details),
  RateLimited: () => new ApiError(429, 'RATE_LIMITED', 'Too many requests'),
  InternalServerError: (message?: string) => new ApiError(500, 'INTERNAL_ERROR', message || 'Internal server error'),
};
