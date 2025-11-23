import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyEventV2,
  Context,
} from 'aws-lambda';
import { getClaims as localVerifyForDevOnly } from './auth';
import { formatError } from './errors';
import { getCorsHeaders, handleOptionsRequest } from './cors';

export interface AuthenticatedEvent extends APIGatewayProxyEventV2 {
  claims: {
    sub: string;
    sid?: string;
    iss?: string;
    org_id?: string;
    role?: string;
    permissions?: string;
    exp?: number;
    iat?: number;
    // WorkOS custom claims with URN format
    'urn:railbranch:email'?: string;
    'urn:railbranch:first_name'?: string;
    'urn:railbranch:last_name'?: string;
    'urn:railbranch:metadata'?: string;
    'urn:railbranch:external_id'?: string;
    'urn:railbranch:org_unit'?: string;
    // Allow any additional claims
    [key: string]: any;
  };
}

export type AuthenticatedHandler = (
  event: AuthenticatedEvent,
  context: Context
) => Promise<any>;

export const withAuth = (handlerFn: AuthenticatedHandler): APIGatewayProxyHandlerV2 => {
  return async (event, context) => {
    const origin = event.headers.origin || event.headers.Origin;

    // Preflight
    if (event.requestContext.http.method === 'OPTIONS') {
      return handleOptionsRequest(origin, event.headers as Record<string, string>);
    }

    try {
      // Require claims from API Gateway's authorizer (no local fallback)
      const requestContext = event.requestContext as any;
      const lambdaCtx = requestContext?.authorizer?.lambda;
      let claims = lambdaCtx as AuthenticatedEvent['claims'] | undefined;

      if (!claims?.sub) {
        return {
          statusCode: 401,
          headers: corsHeaders(origin),
          body: JSON.stringify({ error: 'unauthorized' }),
        };
      }

      const result = await handlerFn({ ...event, claims } as AuthenticatedEvent, context);

      return {
        ...result,
        headers: {
          ...(result.headers ?? {}),
          ...corsHeaders(origin),
        },
      };
    } catch (err) {
      const errorResponse = formatError(err, context.awsRequestId);
      return {
        ...errorResponse,
        headers: {
          ...(errorResponse.headers ?? {}),
          ...corsHeaders(origin),
        },
      };
    }
  };
};

function corsHeaders(origin?: string) {
  const base = getCorsHeaders(origin); // implement strict allow-list internally
  return {
    ...base,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-request-id,x-csrf-token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}
