import type { Context } from 'aws-lambda';
import { withAuth, type AuthenticatedEvent, type HandlerResponse } from '../../lib/middleware';
import { invokePythonLambda } from '../../lib/invokePythonLambda';
import { createSuccessResponse } from '../../lib/response';

/**
 * TypeScript proxy handler that authenticates and delegates to Python.
 * 
 * Flow:
 * 1. withAuth validates JWT token
 * 2. This handler receives authenticated event with claims
 * 3. Invokes Python Lambda with validated claims
 * 4. Returns Python Lambda response
 */
const handlerFn = async (
  event: AuthenticatedEvent,
  _context: Context
): Promise<HandlerResponse> => {
  const { claims } = event;

  // Invoke Python Lambda with authenticated claims
  const result = await invokePythonLambda(
    process.env.PYTHON_PROFILE_FUNCTION_NAME || 'python-user-profile',
    {
      claims,
      queryStringParameters: event.queryStringParameters || {},
      pathParameters: event.pathParameters || {},
    }
  );

  // Python Lambda returns { success: true, data: {...} }
  return createSuccessResponse(result.data);
};

export const handler = withAuth(handlerFn);
