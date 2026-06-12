const swaggerJsdoc = require('swagger-jsdoc');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.staging' }); // Load env vars for docs generation

// Get configuration from environment - fail fast if not set
if (!process.env.PROJECT_NAME) {
  console.error('❌ ERROR: PROJECT_NAME environment variable is required');
  console.error('   Set it in .env.staging or .env.production');
  process.exit(1);
}
if (!process.env.HOSTED_ZONE_NAME) {
  console.error('❌ ERROR: HOSTED_ZONE_NAME environment variable is required');
  console.error('   Set it in .env.staging or .env.production');
  process.exit(1);
}

const projectName = process.env.PROJECT_NAME;
const hostedZone = process.env.HOSTED_ZONE_NAME;

// OpenAPI configuration
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: `${projectName} API`,
      version: '1.0.0',
      description: 'Production-grade serverless REST API on Cloudflare Workers',
      contact: {
        name: 'API Support',
        email: `support@${hostedZone}`
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server'
      },
      {
        url: `https://api-staging.${hostedZone}`,
        description: 'Staging environment'
      },
      {
        url: `https://api.${hostedZone}`,
        description: 'Production environment'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'WorkOS JWT token obtained from authentication'
        }
      },
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              description: 'Response data'
            }
          },
          required: ['success', 'data']
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  example: 'Error message'
                },
                code: {
                  type: 'string',
                  example: 'ERROR_CODE'
                }
              }
            }
          },
          required: ['success', 'error']
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object'
                  }
                },
                nextCursor: {
                  type: 'string',
                  nullable: true,
                  description: 'Cursor for next page'
                },
                hasMore: {
                  type: 'boolean',
                  description: 'Whether more items exist'
                }
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
              schema: {
                $ref: '#/components/schemas/SuccessResponse'
              }
            }
          }
        },
        BadRequest: {
          description: 'Bad Request - Invalid input',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              },
              example: {
                success: false,
                error: {
                  message: 'Invalid input data',
                  code: 'BAD_REQUEST'
                }
              }
            }
          }
        },
        Unauthorized: {
          description: 'Unauthorized - Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              },
              example: {
                success: false,
                error: {
                  message: 'Authentication required',
                  code: 'UNAUTHORIZED'
                }
              }
            }
          }
        },
        Forbidden: {
          description: 'Forbidden - Insufficient permissions',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              },
              example: {
                success: false,
                error: {
                  message: 'Insufficient permissions',
                  code: 'FORBIDDEN'
                }
              }
            }
          }
        },
        NotFound: {
          description: 'Not Found - Resource does not exist',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              },
              example: {
                success: false,
                error: {
                  message: 'Resource not found',
                  code: 'NOT_FOUND'
                }
              }
            }
          }
        },
        ServerError: {
          description: 'Internal Server Error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              },
              example: {
                success: false,
                error: {
                  message: 'Internal server error',
                  code: 'INTERNAL_ERROR'
                }
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Users',
        description: 'User management and profile operations'
      },
      {
        name: 'Media',
        description: 'File upload and media management'
      },
      {
        name: 'Test',
        description: 'Test endpoints for development'
      },
      {
        name: 'Utils',
        description: 'Utility endpoints (health checks, etc.)'
      },
      {
        name: 'Webhooks',
        description: 'Webhook handlers for external services'
      }
    ]
  },
  // Scan the Hono route modules (the single source of every public path)
  apis: [
    './src/node/routes/**/*.ts'
  ]
};

// Generate OpenAPI specification
console.log('🔍 Generating OpenAPI specification...');
console.log('📁 Scanning route files in src/node/routes/');

try {
  const spec = swaggerJsdoc(options);
  
  // Count endpoints
  const pathCount = Object.keys(spec.paths || {}).length;
  const operationCount = Object.values(spec.paths || {}).reduce((count, path) => {
    return count + Object.keys(path).filter(key => 
      ['get', 'post', 'put', 'patch', 'delete'].includes(key)
    ).length;
  }, 0);
  
  // Write to file
  const outputPath = path.join(__dirname, '../docs/api/openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
  
  console.log('');
  console.log('✅ OpenAPI specification generated successfully!');
  console.log('');
  console.log(`📊 Statistics:`);
  console.log(`   - Paths: ${pathCount}`);
  console.log(`   - Operations: ${operationCount}`);
  console.log(`   - Tags: ${spec.tags?.length || 0}`);
  console.log('');
  console.log(`📄 Output: ${outputPath}`);
  console.log('');
  console.log('🚀 Next steps:');
  console.log('   - View docs: npm run docs:serve');
  console.log('   - Open browser: http://localhost:3111');
  console.log('');
  
} catch (error) {
  console.error('');
  console.error('❌ Error generating OpenAPI specification:');
  console.error('');
  console.error(error.message);
  console.error('');
  console.error('💡 Tips:');
  console.error('   - Check @swagger JSDoc comments in route files');
  console.error('   - Ensure YAML syntax is correct');
  console.error('   - Run with DEBUG=swagger-jsdoc:* for detailed logs');
  console.error('');
  process.exit(1);
}
