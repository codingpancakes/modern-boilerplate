import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { getCorsHeaders } from '../../lib/cors';

/**
 * Handler for OPTIONS preflight requests
 * Returns proper CORS headers without requiring authentication
 */
const optionsHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const origin = event.headers.origin || event.headers.Origin;
  
  return {
    statusCode: 200,
    headers: getCorsHeaders(origin),
    body: '',
  };
};

export const handler = optionsHandler;
