import json
import os


def handler(event, context):
    """Simple Python Lambda handler for testing"""
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json'
        },
        'body': json.dumps({
            'ok': True,
            'message': '🐍 Python Lambda with clean naming - railbranch-{stage}-python-test-handler',
            'stage': os.environ.get('STAGE', 'dev'),
            'version': os.environ.get('API_VERSION', 'v1'),
            'runtime': 'python3.11',
            'deployed': '2025-11-22'
        })
    }
