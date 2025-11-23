import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Errors } from './errors';

export type Claims = {
  sub: string;
  email?: string;
  org_id?: string;
  iss: string;
  aud?: string;
  exp: number;
  iat: number;
  [k: string]: unknown;
};

export function getClaims(evt: APIGatewayProxyEventV2): Claims {
  const rc = (evt.requestContext as any) || {};
  const authz = rc.authorizer || {};
  const jwtClaims = authz.jwt?.claims;
  const lambdaCtx = authz.lambda; // HTTP API SIMPLE Lambda authorizer context
  const claims = jwtClaims || lambdaCtx;
  if (!claims?.sub) {
    throw Errors.Unauthorized();
  }
  return claims as Claims;
}

export function getUserId(evt: APIGatewayProxyEventV2): string {
  const claims = getClaims(evt);
  return claims.sub;
}

export function getOrgId(evt: APIGatewayProxyEventV2): string | undefined {
  const claims = getClaims(evt);
  return claims.org_id;
}
