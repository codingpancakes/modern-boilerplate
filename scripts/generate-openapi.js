const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

// Base OpenAPI specification
const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'postway API',
    version: '1.0.0',
    description: 'Auto-generated API documentation'
  },
  servers: [
    { url: 'http://localhost:3000/v1', description: 'Local' },
    { url: 'https://api-staging.postway.services/v1', description: 'Staging' },
    { url: 'https://api.postway.services/v1', description: 'Production' }
  ],
  paths: {},
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' }
        },
        required: ['success', 'data']
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string' },
          details: { type: 'object' }
        },
        required: ['success', 'error']
      },
      PaginatedResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'object' } },
              nextCursor: { type: 'string', nullable: true },
              hasMore: { type: 'boolean' }
            }
          }
        }
      }
    },
    responses: {
      Success: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/SuccessResponse' }
          }
        }
      },
      Unauthorized: {
        description: 'Authentication required',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { success: false, error: 'Authentication required' }
          }
        }
      },
      Forbidden: {
        description: 'Insufficient permissions',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { success: false, error: 'Insufficient permissions' }
          }
        }
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { success: false, error: 'Resource not found' }
          }
        }
      },
      ServerError: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { success: false, error: 'Internal server error' }
          }
        }
      }
    }
  },
  security: [{ BearerAuth: [] }]
};

// Extract Swagger documentation from JSDoc comments
function extractSwaggerDocumentation(content) {
  // Look for @swagger JSDoc blocks
  const swaggerBlockRegex = /\/\*\*[\s\S]*?@swagger[\s\S]*?\*\//g;
  const swaggerBlocks = content.match(swaggerBlockRegex);
  
  if (!swaggerBlocks || swaggerBlocks.length === 0) {
    return null;
  }
  
  const swaggerBlock = swaggerBlocks[0];
  
  // Extract method and path from the swagger block
  const pathMethodRegex = /\*\s*([\/\w\-{}]+):\s*\n\s*\*\s*(\w+):/;
  const pathMethodMatch = swaggerBlock.match(pathMethodRegex);
  
  if (!pathMethodMatch) {
    return null;
  }
  
  const [, path, method] = pathMethodMatch;
  
  // Extract summary
  const summaryRegex = /\*\s*summary:\s*(.+)/;
  const summaryMatch = swaggerBlock.match(summaryRegex);
  const summary = summaryMatch ? summaryMatch[1].trim() : null;
  
  // Extract description
  const descriptionRegex = /\*\s*description:\s*(.+)/;
  const descriptionMatch = swaggerBlock.match(descriptionRegex);
  const description = descriptionMatch ? descriptionMatch[1].trim() : null;
  
  // Extract tags
  const tagsRegex = /\*\s*tags:\s*\[([^\]]+)\]/;
  const tagsMatch = swaggerBlock.match(tagsRegex);
  const tags = tagsMatch ? tagsMatch[1].split(',').map(tag => tag.trim()) : null;
  
  // Extract request body schema
  let requestBodySchema = null;
  const requestBodyRegex = /\*\s*requestBody:[\s\S]*?\*\s*content:[\s\S]*?\*\s*application\/json:[\s\S]*?\*\s*schema:([\s\S]*?)(?=\*\s*responses:|$)/;
  const requestBodyMatch = swaggerBlock.match(requestBodyRegex);
  
  if (requestBodyMatch) {
    try {
      // Extract the schema portion and convert to JSON
      const schemaText = requestBodyMatch[1];
      const schemaLines = schemaText.split('\n')
        .map(line => line.replace(/^\s*\*\s*/, '').trim())
        .filter(line => line.length > 0);
      
      // Parse the YAML-like schema structure
      requestBodySchema = parseSwaggerSchema(schemaLines);
    } catch (error) {
      console.warn('Could not parse request body schema:', error.message);
    }
  }
  
  return {
    path: path.replace('/v1', ''), // Remove /v1 prefix as it's handled by servers
    method: method.toLowerCase(),
    summary,
    description,
    tags,
    requestBodySchema,
    fullBlock: swaggerBlock
  };
}

// Parse YAML-like schema from JSDoc comments
function parseSwaggerSchema(lines) {
  const schema = { type: 'object', properties: {} };
  let currentProperty = null;
  let indentLevel = 0;
  
  for (const line of lines) {
    if (line.startsWith('type:')) {
      const type = line.split(':')[1].trim();
      if (currentProperty) {
        schema.properties[currentProperty].type = type;
      } else {
        schema.type = type;
      }
    } else if (line.startsWith('properties:')) {
      // Start of properties section
      continue;
    } else if (line.match(/^\w+:$/)) {
      // Property name
      currentProperty = line.replace(':', '');
      schema.properties[currentProperty] = {};
    } else if (line.includes('type:') && currentProperty) {
      const type = line.split('type:')[1].trim();
      schema.properties[currentProperty].type = type;
    } else if (line.includes('nullable:') && currentProperty) {
      const nullable = line.split('nullable:')[1].trim() === 'true';
      schema.properties[currentProperty].nullable = nullable;
    } else if (line.includes('format:') && currentProperty) {
      const format = line.split('format:')[1].trim();
      schema.properties[currentProperty].format = format;
    }
  }
  
  return schema;
}

// Convert file path to API route and HTTP method
function parseHandlerPath(filePath) {
  const relativePath = path.relative(
    path.join(__dirname, '../src/node/handlers'),
    filePath
  );
  
  // Remove .ts/.js extension
  const pathWithoutExt = relativePath.replace(/\.(ts|js)$/, '');
  const parts = pathWithoutExt.split(path.sep);
  
  // Determine HTTP method and route
  let method = 'get';
  let routeParts = [...parts];
  
  // First, check file content for explicit swagger method annotation
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for JSDoc @swagger documentation first
    const swaggerDoc = extractSwaggerDocumentation(content);
    if (swaggerDoc && swaggerDoc.method) {
      method = swaggerDoc.method.toLowerCase();
      // Also use the path from swagger doc if available
      if (swaggerDoc.path) {
        const swaggerRoute = swaggerDoc.path;
        // Convert back to route parts for consistency
        routeParts = swaggerRoute.split('/').filter(Boolean);
      }
    } else {
      // Look for #swagger.method = 'POST' or similar
      const swaggerMethodMatch = content.match(/#swagger\.method\s*=\s*['"](\w+)['"]/i);
      if (swaggerMethodMatch) {
        method = swaggerMethodMatch[1].toLowerCase();
      } else {
        // Check if filename indicates HTTP method
        const lastPart = parts[parts.length - 1].toLowerCase();
        const httpMethods = ['get', 'post', 'put', 'delete', 'patch'];
        
        if (httpMethods.includes(lastPart)) {
          method = lastPart;
          routeParts = parts.slice(0, -1);
        } else if (lastPart === 'list') {
          method = 'get';
          routeParts = parts.slice(0, -1);
        } else if (lastPart === 'create') {
          method = 'post';
          routeParts = parts.slice(0, -1);
        } else if (lastPart === 'update') {
          method = 'put';
          routeParts = parts.slice(0, -1);
        } else if (lastPart === 'delete') {
          method = 'delete';
          routeParts = parts.slice(0, -1);
        }
      }
    }
  } catch (error) {
    // If we can't read the file, fall back to filename-based detection
    const lastPart = parts[parts.length - 1].toLowerCase();
    const httpMethods = ['get', 'post', 'put', 'delete', 'patch'];
    
    if (httpMethods.includes(lastPart)) {
      method = lastPart;
      routeParts = parts.slice(0, -1);
    } else if (lastPart === 'list') {
      method = 'get';
      routeParts = parts.slice(0, -1);
    } else if (lastPart === 'create') {
      method = 'post';
      routeParts = parts.slice(0, -1);
    } else if (lastPart === 'update') {
      method = 'put';
      routeParts = parts.slice(0, -1);
    } else if (lastPart === 'delete') {
      method = 'delete';
      routeParts = parts.slice(0, -1);
    }
  }
  
  // Build route path
  let route = '/' + routeParts.join('/');
  
  // Handle dynamic segments [id] -> {id}
  route = route.replace(/\[([^\]]+)\]/g, '{$1}');
  
  // Special handling for specific endpoints that need path parameters
  if (filePath.includes('professionals/availability')) {
    // This endpoint needs a professional ID parameter
    route = '/professionals/{id}/availability';
  }
  
  // Special cases - keep /me endpoints as they are
  // Don't convert /users/me, /members/me, etc. to use {id} parameters
  // These are "current user/member" endpoints, not parameterized endpoints
  
  return { method, route };
}

// Extract information from handler file content
function analyzeHandlerFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check if it uses withAuth (most endpoints do)
    const requiresAuth = content.includes('withAuth');
    
    // Check for pagination (indicates list endpoint)
    const isPaginated = content.includes('createPaginatedResponse') || 
                       content.includes('paginationQuery');
    
    // Extract validation schema usage
    const validationMatches = content.match(/validate\(schemas\.(\w+)/g) || [];
    const schemas = validationMatches.map(match => 
      match.replace('validate(schemas.', '').replace(')', '')
    );
    
    // Check for specific patterns
    const isHealthCheck = content.includes('health') || filePath.includes('health');
    const isWebhook = filePath.includes('webhook');
    
    // Extract JSDoc/Swagger parameters
    const parameters = extractJSDocParameters(content);
    
    // Extract JSDoc/Swagger documentation
    const swaggerDoc = extractSwaggerDocumentation(content);
    
    // Check if it needs path parameters (uses idParam schema or has path validation)
    const needsIdParam = schemas.includes('idParam') || content.includes('pathParameters');
    
    return {
      requiresAuth: requiresAuth && !isHealthCheck && !isWebhook,
      isPaginated,
      schemas,
      isHealthCheck,
      isWebhook,
      parameters,
      needsIdParam,
      swaggerDoc
    };
  } catch (error) {
    console.warn(`Could not analyze ${filePath}:`, error.message);
    return { requiresAuth: true, isPaginated: false, schemas: [], parameters: [], swaggerDoc: null };
  }
}

// Extract parameters from JSDoc/Swagger comments
function extractJSDocParameters(content) {
  const parameters = [];
  
  // Match swagger parameter definitions
  const paramRegex = /#swagger\.parameters\['([^']+)'\]\s*=\s*{([^}]+)}/g;
  let match;
  
  while ((match = paramRegex.exec(content)) !== null) {
    const paramName = match[1];
    const paramConfig = match[2];
    
    // Extract parameter details
    const inMatch = paramConfig.match(/in:\s*'([^']+)'/);
    const requiredMatch = paramConfig.match(/required:\s*(true|false)/);
    const typeMatch = paramConfig.match(/type:\s*'([^']+)'/);
    const descMatch = paramConfig.match(/description:\s*'([^']+)'/);
    const formatMatch = paramConfig.match(/format:\s*'([^']+)'/);
    
    if (inMatch) {
      const param = {
        name: paramName,
        in: inMatch[1],
        required: requiredMatch ? requiredMatch[1] === 'true' : false,
        schema: {
          type: typeMatch ? typeMatch[1] : 'string'
        }
      };
      
      if (descMatch) {
        param.description = descMatch[1];
      }
      
      if (formatMatch) {
        param.schema.format = formatMatch[1];
      }
      
      parameters.push(param);
    }
  }
  
  // Also check for required query parameters in code
  const queryRequiredRegex = /if\s*\(\s*!queryParams\.([^)]+)\)/g;
  while ((match = queryRequiredRegex.exec(content)) !== null) {
    const paramName = match[1].split(/\s*\|\||\s*&&/)[0].trim();
    if (!parameters.find(p => p.name === paramName)) {
      parameters.push({
        name: paramName,
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: `Required query parameter`
      });
    }
  }
  
  return parameters;
}

// Generate OpenAPI operation for a handler
function generateOperation(filePath) {
  const { method, route } = parseHandlerPath(filePath);
  const analysis = analyzeHandlerFile(filePath);
  
  // Use Swagger documentation if available, otherwise generate defaults
  let summary, description, tags;
  
  if (analysis.swaggerDoc) {
    summary = analysis.swaggerDoc.summary || `${method.toUpperCase()} ${route}`;
    description = analysis.swaggerDoc.description || `${method.toUpperCase()} operation for ${route}`;
    tags = analysis.swaggerDoc.tags || [route.split('/')[1] || 'default'];
  } else {
    // Generate summary and description
    const methodName = method.toUpperCase();
    summary = `${methodName} ${route}`;
    description = `${methodName} operation for ${route}`;
    
    // Determine tags
    const primaryResource = route.split('/')[1] || 'default';
    tags = [primaryResource];
  }
  
  // Build operation
  const operation = {
    summary,
    description,
    operationId: `${method}_${route.replace(/[{}\/]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`,
    tags,
    responses: {
      '200': analysis.isPaginated 
        ? {
            description: 'Paginated list response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaginatedResponse' }
              }
            }
          }
        : { $ref: '#/components/responses/Success' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '500': { $ref: '#/components/responses/ServerError' }
    }
  };
  
  // Add authentication if required
  if (analysis.requiresAuth) {
    operation.security = [{ BearerAuth: [] }];
  } else {
    operation.security = [];
  }
  
  // Add parameters for GET requests
  if (method === 'get') {
    operation.parameters = [];
    
    // Add path parameters
    const pathParams = route.match(/{([^}]+)}/g);
    if (pathParams) {
      pathParams.forEach(param => {
        const paramName = param.slice(1, -1);
        operation.parameters.push({
          name: paramName,
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: `${paramName} identifier`
        });
      });
    }
    
    // Add parameters from JSDoc/code analysis
    if (analysis.parameters && analysis.parameters.length > 0) {
      analysis.parameters.forEach(param => {
        // Skip path parameters already added
        if (param.in === 'path' && operation.parameters.find(p => p.name === param.name)) {
          return;
        }
        operation.parameters.push(param);
      });
    }
    
    // Add pagination parameters for list endpoints (if not already added from JSDoc)
    if (analysis.isPaginated && !operation.parameters.find(p => p.name === 'cursor')) {
      operation.parameters.push(
        {
          name: 'cursor',
          in: 'query',
          required: false,
          schema: { type: 'string' },
          description: 'Pagination cursor'
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          description: 'Number of items to return'
        }
      );
    }
  }
  
  // Add request body for POST/PUT/PATCH
  if (['post', 'put', 'patch'].includes(method)) {
    const requestBodySchema = analysis.swaggerDoc?.requestBodySchema || { type: 'object' };
    
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: requestBodySchema,
          example: {}
        }
      }
    };
    
    // Add 400 response for input validation
    operation.responses['400'] = {
      description: 'Bad Request - Invalid input',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          example: { success: false, error: 'Invalid input data' }
        }
      }
    };
  }
  
  // Add 404 for single resource endpoints
  if (route.includes('{') && method === 'get') {
    operation.responses['404'] = { $ref: '#/components/responses/NotFound' };
  }
  
  // Add 403 for authenticated endpoints
  if (analysis.requiresAuth) {
    operation.responses['403'] = { $ref: '#/components/responses/Forbidden' };
  }
  
  return { route, method, operation };
}

// Main generation function
async function generateOpenAPI() {
  try {
    console.log('🔍 Scanning handler files...');
    
    // Find all handler files
    const handlerFiles = await glob('src/node/handlers/**/*.{ts,js}', {
      ignore: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'],
      cwd: path.join(__dirname, '..')
    });
    
    console.log(`📁 Found ${handlerFiles.length} handler files`);
    
    // Process each handler
    const tags = new Set();
    
    handlerFiles.forEach(file => {
      const fullPath = path.join(__dirname, '..', file);
      const { route, method, operation } = generateOperation(fullPath);
      
      // Add to paths
      if (!openApiSpec.paths[route]) {
        openApiSpec.paths[route] = {};
      }
      
      openApiSpec.paths[route][method] = operation;
      
      // Collect tags
      operation.tags.forEach(tag => tags.add(tag));
      
      console.log(`✅ ${method.toUpperCase().padEnd(6)} ${route}`);
    });
    
    // Add tag descriptions
    openApiSpec.tags = Array.from(tags).map(tag => ({
      name: tag,
      description: `${tag.charAt(0).toUpperCase() + tag.slice(1)} related operations`
    }));
    
    // Write to file
    const outputPath = path.join(__dirname, '../docs/openapi.json');
    fs.writeFileSync(outputPath, JSON.stringify(openApiSpec, null, 2));
    
    console.log(`\n🎉 OpenAPI specification generated: ${outputPath}`);
    console.log(`📊 Generated ${Object.keys(openApiSpec.paths).length} paths with ${handlerFiles.length} operations`);
    
  } catch (error) {
    console.error('❌ Error generating OpenAPI spec:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  generateOpenAPI();
}

module.exports = { generateOpenAPI };
