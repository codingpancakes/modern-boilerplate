import type { APIGatewayProxyHandlerV2, APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { getCorsHeaders, handleOptionsRequest, getExternalCorsHeaders, handleExternalOptionsRequest, getOpenCorsHeaders, handleOpenOptionsRequest } from './cors';
import { formatError, Errors } from './errors';

export interface CustomHeaderConfig {
  headerName: string;
  expectedValue?: string;
  validateFn?: (headerValue: string) => boolean;
}

/**
 * Middleware for open endpoints that require a custom header for security
 * Validates a specific header while providing CORS support
 * No JWT authentication required
 */
export const withCustomHeader = (
  config: CustomHeaderConfig,
  handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>
): APIGatewayProxyHandlerV2 => {
  return async (event: APIGatewayProxyEventV2, context: Context) => {
    const origin = event.headers.origin || event.headers.Origin;
    
    // Handle preflight OPTIONS requests
    if (event.requestContext.http.method === 'OPTIONS') {
      return handleOptionsRequest(origin);
    }
    
    try {
      // Check for required header (case-insensitive)
      const headerValue = event.headers[config.headerName] || 
                         event.headers[config.headerName.toLowerCase()] ||
                         event.headers[config.headerName.toUpperCase()];
      
      if (!headerValue) {
        throw Errors.BadRequest(`Missing required header: ${config.headerName}`);
      }
      
      // Validate header value
      let isValid = false;
      
      if (config.expectedValue) {
        // Simple string comparison
        isValid = headerValue === config.expectedValue;
      } else if (config.validateFn) {
        // Custom validation function
        isValid = config.validateFn(headerValue);
      } else {
        // Just check that header exists
        isValid = true;
      }
      
      if (!isValid) {
        throw Errors.BadRequest(`Invalid ${config.headerName} header value`);
      }
      
      const response = await handlerFn(event, context);
      const corsHeaders = getCorsHeaders(origin);
      
      // Ensure response has headers
      if (typeof response === 'object' && response !== null) {
        return {
          ...response,
          headers: {
            ...(response.headers || {}),
            ...corsHeaders,
          },
        };
      }
      
      // For simple responses
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    } catch (error: any) {
      const corsHeaders = getCorsHeaders(origin);
      const errorResponse = formatError(error, context.awsRequestId);
      
      return {
        ...errorResponse,
        headers: {
          ...(errorResponse.headers || {}),
          ...corsHeaders,
        },
      };
    }
  };
};

/**
 * Convenience function for API key validation
 */
export const withApiKey = (
  expectedApiKey: string,
  handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>
): APIGatewayProxyHandlerV2 => {
  return withCustomHeader(
    {
      headerName: 'X-API-Key',
      expectedValue: expectedApiKey,
    },
    handlerFn
  );
};

/**
 * Convenience function for secret token validation
 */
export const withSecretToken = (
  expectedToken: string,
  handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>
): APIGatewayProxyHandlerV2 => {
  return withCustomHeader(
    {
      headerName: 'X-Secret-Token',
      expectedValue: expectedToken,
    },
    handlerFn
  );
};

/**
 * Convenience function for webhook signature validation
 */
export const withWebhookSignature = (
  validateSignature: (signature: string) => boolean,
  handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>
): APIGatewayProxyHandlerV2 => {
  return withCustomHeader(
    {
      headerName: 'X-Webhook-Signature',
      validateFn: validateSignature,
    },
    handlerFn
  );
};

/**
 * Middleware for external service webhooks with relaxed CORS
 * Allows calls from known external services (Stripe, Twilio, etc.)
 */
export const withExternalHeader = (
  config: CustomHeaderConfig,
  handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>
): APIGatewayProxyHandlerV2 => {
  return async (event: APIGatewayProxyEventV2, context: Context) => {
    const origin = event.headers.origin || event.headers.Origin;
    
    // Handle preflight OPTIONS requests with external CORS
    if (event.requestContext.http.method === 'OPTIONS') {
      return handleExternalOptionsRequest(origin);
    }
    
    try {
      // Same header validation logic
      const headerValue = event.headers[config.headerName] || 
                         event.headers[config.headerName.toLowerCase()] ||
                         event.headers[config.headerName.toUpperCase()];
      
      if (!headerValue) {
        throw Errors.BadRequest(`Missing required header: ${config.headerName}`);
      }
      
      let isValid = false;
      if (config.expectedValue) {
        isValid = headerValue === config.expectedValue;
      } else if (config.validateFn) {
        isValid = config.validateFn(headerValue);
      } else {
        isValid = true;
      }
      
      if (!isValid) {
        throw Errors.BadRequest(`Invalid ${config.headerName} header value`);
      }
      
      const response = await handlerFn(event, context);
      const corsHeaders = getExternalCorsHeaders(origin); // Use external CORS
      
      if (typeof response === 'object' && response !== null) {
        return {
          ...response,
          headers: {
            ...(response.headers || {}),
            ...corsHeaders,
          },
        };
      }
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    } catch (error: any) {
      const corsHeaders = getExternalCorsHeaders(origin);
      const errorResponse = formatError(error, context.awsRequestId);
      
      return {
        ...errorResponse,
        headers: {
          ...(errorResponse.headers || {}),
          ...corsHeaders,
        },
      };
    }
  };
};

/**
 * Middleware for completely open webhooks (allows any origin)
 * Use only for public webhooks that don't expose sensitive data
 */
export const withOpenHeader = (
  config: CustomHeaderConfig,
  handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>
): APIGatewayProxyHandlerV2 => {
  return async (event: APIGatewayProxyEventV2, context: Context) => {
    // Handle preflight OPTIONS requests with open CORS
    if (event.requestContext.http.method === 'OPTIONS') {
      return handleOpenOptionsRequest();
    }
    
    try {
      // Same header validation logic
      const headerValue = event.headers[config.headerName] || 
                         event.headers[config.headerName.toLowerCase()] ||
                         event.headers[config.headerName.toUpperCase()];
      
      if (!headerValue) {
        throw Errors.BadRequest(`Missing required header: ${config.headerName}`);
      }
      
      let isValid = false;
      if (config.expectedValue) {
        isValid = headerValue === config.expectedValue;
      } else if (config.validateFn) {
        isValid = config.validateFn(headerValue);
      } else {
        isValid = true;
      }
      
      if (!isValid) {
        throw Errors.BadRequest(`Invalid ${config.headerName} header value`);
      }
      
      const response = await handlerFn(event, context);
      const corsHeaders = getOpenCorsHeaders(); // Allow any origin
      
      if (typeof response === 'object' && response !== null) {
        return {
          ...response,
          headers: {
            ...(response.headers || {}),
            ...corsHeaders,
          },
        };
      }
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    } catch (error: any) {
      const corsHeaders = getOpenCorsHeaders();
      const errorResponse = formatError(error, context.awsRequestId);
      
      return {
        ...errorResponse,
        headers: {
          ...(errorResponse.headers || {}),
          ...corsHeaders,
        },
      };
    }
  };
};

/**
 * Convenience functions for external webhooks
 */
export const withExternalApiKey = (
  expectedApiKey: string,
  handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>
): APIGatewayProxyHandlerV2 => {
  return withExternalHeader(
    {
      headerName: 'X-API-Key',
      expectedValue: expectedApiKey,
    },
    handlerFn
  );
};

export const withOpenApiKey = (
  expectedApiKey: string,
  handlerFn: (event: APIGatewayProxyEventV2, context: Context) => Promise<any>
): APIGatewayProxyHandlerV2 => {
  return withOpenHeader(
    {
      headerName: 'X-API-Key',
      expectedValue: expectedApiKey,
    },
    handlerFn
  );
};
