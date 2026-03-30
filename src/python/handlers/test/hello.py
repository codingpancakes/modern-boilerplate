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
    
    headers = event.get('headers') or {}
    origin = headers.get('origin', '')
    
    allowed_suffixes = os.environ.get('CORS_PARENT_DOMAINS', '').split(',')
    origin_allowed = False
    if origin:
        from urllib.parse import urlparse
        parsed = urlparse(origin)
        hostname = parsed.hostname or ''
        for suffix in allowed_suffixes:
            suffix = suffix.strip()
            if suffix and (hostname == suffix or hostname.endswith('.' + suffix)):
                origin_allowed = True
                break
    
    cors_origin = origin if origin_allowed else ''
    
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
            'Access-Control-Allow-Origin': cors_origin,
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Vary': 'Origin'
        },
        'body': json.dumps(response_body)
    }
