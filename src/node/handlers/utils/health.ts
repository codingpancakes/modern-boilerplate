import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { withPublicCors } from '../../lib/withPublicCors';
import { createSuccessResponse } from '../../lib/response';

const healthHandler = async (event: APIGatewayProxyEventV2, context: Context) => {
  return createSuccessResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || 'v1',
    stage: process.env.STAGE || 'dev',
  });
};

export const handler = withPublicCors(healthHandler);
