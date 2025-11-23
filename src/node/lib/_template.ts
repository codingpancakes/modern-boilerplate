/**
 * API Handler Template
 * 
 * This template demonstrates the standardized pattern for all API handlers.
 * Copy this file and modify it for new endpoints.
 * 
 * REQUIREMENTS (All 5 criteria must be met):
 * 1. Claims Usage: Use `const claims = event.claims;` from withAuth middleware
 * 2. Error Handling: Use `throw error;` pattern (middleware handles formatting)
 * 3. Response Structure: Return `{success: true, data: {...}}` (CORS handled by middleware)
 * 4. TypeScript: No TS issues, no unused imports/definitions
 * 5. Architecture: Use `handlerFn + withAuth(handlerFn)` pattern
 * 
 * SWAGGER DOCUMENTATION:
 * Add JSDoc comments with #swagger annotations to auto-generate OpenAPI docs.
 * See examples below for proper documentation format.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { withAuth, AuthenticatedEvent } from '../lib/middleware';
import { getOrgId } from '../lib/auth';
import { getDb } from '../lib/db';
import { validate, schemas } from '../lib/validation';
import { Errors } from '../lib/errors';
import { withIdempotency } from '../lib/idempotency'; // Optional: for POST/PUT/PATCH operations
import type { Context } from 'aws-lambda';

// Update service name to match your handler
const logger = new Logger({ serviceName: 'TEMPLATE_NAME' });
const tracer = new Tracer({ serviceName: 'TEMPLATE_NAME' });

/**
 * Template API Handler
 * 
 * #swagger.tags = ['Template']
 * #swagger.summary = 'Template operation'
 * #swagger.description = 'Template handler demonstrating standardized API pattern'
 * #swagger.security = [{ "BearerAuth": [] }]
 * #swagger.parameters['id'] = {
 *   in: 'path',
 *   description: 'Resource ID',
 *   required: true,
 *   type: 'string',
 *   format: 'uuid'
 * }
 * #swagger.responses[200] = {
 *   description: 'Operation successful',
 *   schema: { $ref: '#/definitions/StandardSuccessResponse' }
 * }
 * #swagger.responses[400] = {
 *   description: 'Bad request',
 *   schema: { $ref: '#/definitions/StandardErrorResponse' }
 * }
 * #swagger.responses[401] = {
 *   description: 'Unauthorized',
 *   schema: { $ref: '#/definitions/StandardErrorResponse' }
 * }
 * #swagger.responses[404] = {
 *   description: 'Not found',
 *   schema: { $ref: '#/definitions/StandardErrorResponse' }
 * }
 */
const handlerFn = async (event: AuthenticatedEvent, context: Context) => {
  const requestId = context.awsRequestId;
  logger.addContext(context);

  // Optional: Wrap with idempotency for POST/PUT/PATCH operations
  // return withIdempotency(event, async () => {
  
  try {
    // 1. CLAIMS USAGE - Always use claims from middleware
    const claims = event.claims; // Claims provided by withAuth middleware
    
    // Optional: Get organization ID if needed
    const orgId = getOrgId(event);
    
    // 2. VALIDATION - Validate inputs as needed
    // Path parameters
    // const { id } = validate(schemas.idParam, event.pathParameters || {});
    
    // Query parameters  
    // const query = validate(schemas.paginationQuery, event.queryStringParameters || {});
    
    // Request body (for POST/PUT/PATCH)
    // const body = JSON.parse(event.body || '{}');
    // const input = validate(schemas.createSomething, body);

    // 3. LOGGING - Log the operation
    logger.info('Template operation started', { 
      userId: claims.sub,
      orgId,
      // Add relevant context
    });

    // 4. DATABASE OPERATIONS
    const db = await getDb();
    
    // Example: Check permissions/existence
    // const [existing] = await db
    //   .select()
    //   .from(someTable)
    //   .where(eq(someTable.id, id))
    //   .limit(1);
    
    // if (!existing) {
    //   throw Errors.NotFound('Resource');
    // }

    // Example: Perform main operation
    // const result = await db
    //   .select()
    //   .from(someTable)
    //   .where(conditions);

    // Placeholder result - replace with actual data
    const result = {
      message: 'Template handler executed successfully',
      userId: claims.sub,
      timestamp: new Date().toISOString()
    };

    // 5. SUCCESS LOGGING
    logger.info('Template operation completed successfully', { 
      userId: claims.sub,
      // Add relevant success metrics
    });

    // 3. RESPONSE STRUCTURE - Always return standardized format (CORS handled by middleware)
    return {
      statusCode: 200, // Use appropriate status: 200, 201, etc.
      body: JSON.stringify({
        success: true,
        data: result
      })
    };

  } catch (error) {
    // 6. ERROR LOGGING AND HANDLING
    logger.error('Error in template operation', { error });
    
    // 2. ERROR HANDLING - Always throw error for middleware to handle
    throw error; // Error handling done by withAuth middleware
  }
  
  // }); // Close idempotency wrapper if used
};

// 5. ARCHITECTURE - Always export with withAuth wrapper
export const handler = withAuth(handlerFn);

/**
 * COMMON PATTERNS AND EXAMPLES:
 * 
 * 1. GET with path parameter:
 *    const { id } = validate(schemas.idParam, event.pathParameters || {});
 * 
 * 2. GET with query parameters:
 *    const query = validate(schemas.paginationQuery, event.queryStringParameters || {});
 * 
 * 3. POST/PUT with body validation:
 *    const body = JSON.parse(event.body || '{}');
 *    const input = validate(schemas.createUser, body);
 * 
 * 4. Database query with organization filter:
 *    const results = await db
 *      .select()
 *      .from(users)
 *      .where(and(
 *        eq(users.organizationId, orgId),
 *        isNull(users.deletedAt)
 *      ));
 * 
 * 5. Error handling examples:
 *    if (!found) throw Errors.NotFound('User');
 *    if (forbidden) throw Errors.Forbidden();
 *    if (invalid) throw Errors.BadRequest('Invalid input');
 * 
 * 6. Response status codes:
 *    GET: 200
 *    POST: 201 
 *    PUT/PATCH: 200
 *    DELETE: 200
 * 
 * 7. With idempotency (for POST/PUT/PATCH):
 *    return withIdempotency(event, async () => {
 *      // ... handler logic
 *    });
 */
