import { Tracer } from '@aws-lambda-powertools/tracer';

// Initialize tracer once and export
export const tracer = new Tracer({ serviceName: 'postway-api' });

/**
 * Trace a database query
 * 
 * @example
 * const segment = traceQuery('getUserById');
 * const user = await db.select()...
 * segment.close();
 */
export function traceQuery(queryName: string) {
  const segment = tracer.getSegment();
  if (!segment) return { close: () => {} };
  
  const subsegment = segment.addNewSubsegment(`db:${queryName}`);
  subsegment.addAnnotation('query', queryName);
  
  return {
    close: () => subsegment.close(),
    addMetadata: (key: string, value: unknown) => subsegment.addMetadata(key, value),
  };
}

/**
 * Trace an external API call
 * 
 * @example
 * const segment = traceExternalCall('WorkOS', 'getUser');
 * const user = await workos.users.getUser(userId);
 * segment.close();
 */
export function traceExternalCall(service: string, operation: string) {
  const segment = tracer.getSegment();
  if (!segment) return { close: () => {} };
  
  const subsegment = segment.addNewSubsegment(`${service}:${operation}`);
  subsegment.addAnnotation('service', service);
  subsegment.addAnnotation('operation', operation);
  
  return {
    close: () => subsegment.close(),
    addMetadata: (key: string, value: unknown) => subsegment.addMetadata(key, value),
  };
}

/**
 * Trace a Lambda invocation
 * 
 * @example
 * const segment = traceLambdaInvoke('python-user-profile');
 * const result = await lambda.invoke(...);
 * segment.close();
 */
export function traceLambdaInvoke(functionName: string) {
  const segment = tracer.getSegment();
  if (!segment) return { close: () => {} };
  
  const subsegment = segment.addNewSubsegment(`lambda:${functionName}`);
  subsegment.addAnnotation('function', functionName);
  
  return {
    close: () => subsegment.close(),
    addMetadata: (key: string, value: unknown) => subsegment.addMetadata(key, value),
  };
}
