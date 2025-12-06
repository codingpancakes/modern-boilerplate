import type { Context } from 'aws-lambda';
import { withAuth, type AuthenticatedEvent, type HandlerResponse } from '../../lib/middleware';
import { invokePythonLambda } from '../../lib/invokePythonLambda';
import { createSuccessResponse } from '../../lib/response';

/**
 * @swagger
 * /v1/users/python-profile:
 *   get:
 *     tags: [Users]
 *     summary: Get user profile (Python example)
 *     description: |
 *       Example endpoint demonstrating TypeScript → Python Lambda proxy pattern.
 *       TypeScript handles authentication, Python handles business logic.
 *       
 *       **Architecture:**
 *       1. API Gateway validates JWT via WorkOS authorizer
 *       2. TypeScript proxy receives authenticated claims
 *       3. TypeScript invokes Python Lambda with claims
 *       4. Python processes request and returns data
 *       5. TypeScript returns response to client
 *       
 *       **Security:** Python Lambda is NOT publicly accessible.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data from Python Lambda
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                       example: "user_01KAYCTKV0Y8SDSABDMQNP60XB"
 *                     email:
 *                       type: string
 *                       example: "user@example.com"
 *                     processedAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-12-05T19:29:10.081867Z"
 *                     processedBy:
 *                       type: string
 *                       example: "Python Lambda"
 *                     claims:
 *                       type: object
 *                       description: Full JWT claims from WorkOS
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       500:
 *         description: Internal server error
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
