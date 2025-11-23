import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { withPublicCors } from '../../lib/withPublicCors';

const healthHandler = async (event: APIGatewayProxyEventV2, context: Context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.API_VERSION || 'v1',
      stage: process.env.STAGE || 'dev',
    }),
  };
};

export const handler = withPublicCors(healthHandler);
