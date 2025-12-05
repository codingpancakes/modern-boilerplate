import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { AuthenticatedEvent } from './middleware';

const lambda = new LambdaClient({});

interface PythonLambdaPayload {
  claims: AuthenticatedEvent['claims'];
  body?: unknown;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
}

/**
 * Invoke a Python Lambda function with authenticated user claims.
 * This allows TypeScript handlers to handle auth and delegate to Python.
 */
export async function invokePythonLambda(
  functionName: string,
  payload: PythonLambdaPayload
): Promise<{ success: boolean; data: unknown }> {
  const command = new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload),
  });

  const response = await lambda.send(command);

  if (!response.Payload) {
    throw new Error('No response from Python Lambda');
  }

  const result = JSON.parse(new TextDecoder().decode(response.Payload));

  if (response.FunctionError) {
    throw new Error(`Python Lambda error: ${JSON.stringify(result)}`);
  }

  return result;
}
