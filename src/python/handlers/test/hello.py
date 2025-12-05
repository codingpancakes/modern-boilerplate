"""
Python Lambda Handler Example

This demonstrates how to create a Python Lambda handler alongside Node.js handlers.
Use this for Python-specific workloads like ML inference, data processing, etc.
"""

import json
import os
from datetime import datetime


def handler(event, context):
    """
    Simple Python Lambda handler
    
    Args:
        event: API Gateway event
        context: Lambda context
        
    Returns:
        API Gateway response
    """
    
    # Get stage from environment
    stage = os.environ.get('STAGE', 'unknown')
    
    # Parse request
    http_method = event.get('requestContext', {}).get('http', {}).get('method', 'UNKNOWN')
    path = event.get('rawPath', '/')
    
    # Build response
    response_body = {
        'success': True,
        'message': 'Hello from Python Lambda! 🐍',
        'data': {
            'runtime': 'Python 3.11',
            'stage': stage,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'method': http_method,
            'path': path,
            'handler': 'handlers.test.hello.handler'
        }
    }
    
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        },
        'body': json.dumps(response_body)
    }
