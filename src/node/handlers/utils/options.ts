import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { createNoContentResponse } from '../../lib/response';

/**
 * Handler for OPTIONS preflight requests
 * Returns proper CORS headers without requiring authentication
 */
const optionsHandler: APIGatewayProxyHandlerV2 = async (_event) => {
  return createNoContentResponse();
};

export const handler = optionsHandler;
