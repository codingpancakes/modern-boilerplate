"""
Example authenticated Python handler.
This handler receives pre-validated claims from the TypeScript proxy.
"""

import json
from datetime import datetime


def handler(event, context):
    """
    Get user profile data.
    
    This handler is invoked by a TypeScript proxy that handles authentication.
    The event contains validated user claims.
    
    Args:
        event: Contains 'claims' with validated JWT data
        context: Lambda context
        
    Returns:
        User profile data
    """
    # Extract user claims (already validated by TypeScript proxy)
    claims = event.get('claims', {})
    user_id = claims.get('sub')
    
    # Log for debugging (optional - remove in production if not needed)
    print(f"Processing profile request for user: {user_id}")
    
    if not user_id:
        return {
            'statusCode': 400,
            'body': json.dumps({
                'success': False,
                'error': {'message': 'Missing user ID in claims'}
            })
        }
    
    # Do your Python-specific work here
    # For example: ML inference, data processing, etc.
    profile_data = {
        'userId': user_id,
        'email': claims.get('email'),
        'processedAt': datetime.utcnow().isoformat() + 'Z',
        'processedBy': 'Python Lambda',
        'claims': claims,  # Include all claims for debugging
    }
    
    return {
        'success': True,
        'data': profile_data
    }
