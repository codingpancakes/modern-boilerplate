# Python Lambda Handlers

This folder contains Python Lambda handlers for use cases where Python is more suitable than Node.js.

## When to Use Python Handlers

Use Python handlers for:
- **Machine Learning inference** - Using scikit-learn, TensorFlow, PyTorch
- **Data processing** - Using pandas, numpy
- **Scientific computing** - Complex calculations
- **Python-specific libraries** - When a library only exists in Python
- **Legacy Python code** - Reusing existing Python codebases

## Structure

```
src/python/
├── handlers/           # Lambda handlers
│   └── test/
│       └── hello.py   # Example handler
├── requirements.txt   # Python dependencies
└── README.md         # This file
```

## Creating a New Python Handler

### 1. Create Handler File

```python
# src/python/handlers/ml/predict.py

import json
import os

def handler(event, context):
    """
    ML prediction handler
    """
    # Your logic here
    
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({
            'success': True,
            'data': {'prediction': 'result'}
        })
    }
```

### 2. Add Dependencies

Add to `requirements.txt`:
```
scikit-learn>=1.3.0
pandas>=2.0.0
```

### 3. Register in CDK

Add to `infrastructure/lib/api-stack.ts`:

```typescript
const mlPredictHandler = new lambda.Function(this, "MLPredictHandler", {
  functionName: `${projectName}-${props.stage}-ml-predict`,
  runtime: lambda.Runtime.PYTHON_3_11,
  code: lambda.Code.fromAsset(path.join(__dirname, "../../src/python")),
  handler: "handlers.ml.predict.handler",
  architecture: lambda.Architecture.ARM_64,
  memorySize: 512,  // Increase for ML workloads
  timeout: cdk.Duration.seconds(30),
  environment: commonEnv,
});

this.httpApi.addRoutes({
  path: "/v1/ml/predict",
  methods: [apigwv2.HttpMethod.POST],
  integration: new apigwv2Integrations.HttpLambdaIntegration(
    "MLPredictIntegration",
    mlPredictHandler
  ),
  authorizer: customAuthorizer,  // Add auth if needed
});
```

### 4. Deploy

```bash
pnpm deploy:staging
```

## Example Handler

The included `handlers/test/hello.py` demonstrates:
- ✅ Basic Lambda handler structure
- ✅ API Gateway event parsing
- ✅ Environment variable access
- ✅ JSON response formatting
- ✅ CORS headers

Test it:
```bash
curl https://api-staging.postway.services/v1/test/python
```

## Best Practices

### 1. Keep Handlers Lightweight
```python
# ❌ Don't import heavy libraries at module level
import tensorflow as tf  # Slow cold start!

def handler(event, context):
    # ...

# ✅ Import inside handler or use lazy loading
def handler(event, context):
    import tensorflow as tf  # Only when needed
    # ...
```

### 2. Use Environment Variables
```python
import os

DATABASE_URL = os.environ.get('DATABASE_URL')
API_KEY = os.environ.get('API_KEY')
```

### 3. Handle Errors Properly
```python
def handler(event, context):
    try:
        # Your logic
        result = process_data(event)
        
        return {
            'statusCode': 200,
            'body': json.dumps({'success': True, 'data': result})
        }
    except ValueError as e:
        return {
            'statusCode': 400,
            'body': json.dumps({'success': False, 'error': str(e)})
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'success': False, 'error': 'Internal error'})
        }
```

### 4. Add Type Hints
```python
from typing import Dict, Any

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Handler with type hints"""
    # ...
```

## Testing Locally

### Option 1: Direct Python Execution
```bash
cd src/python
python -c "
from handlers.test.hello import handler
event = {'requestContext': {'http': {'method': 'GET'}}, 'rawPath': '/test'}
print(handler(event, None))
"
```

### Option 2: AWS SAM Local
```bash
sam local invoke PythonTestHandler -e event.json
```

## Dependencies

Python dependencies are installed during CDK deployment. Lambda includes these by default:
- `boto3` - AWS SDK
- `botocore` - AWS SDK core

Add custom dependencies to `requirements.txt`.

## Performance Tips

1. **Use ARM64** - 20% better price/performance
2. **Increase memory for ML** - More memory = more CPU
3. **Use Lambda layers** - For large dependencies
4. **Optimize cold starts** - Keep imports minimal
5. **Use provisioned concurrency** - For latency-sensitive workloads

## Common Use Cases

### Machine Learning
```python
# handlers/ml/inference.py
import pickle
import numpy as np

# Load model once (outside handler)
with open('model.pkl', 'rb') as f:
    model = pickle.load(f)

def handler(event, context):
    data = json.loads(event['body'])
    features = np.array(data['features'])
    prediction = model.predict([features])
    
    return {
        'statusCode': 200,
        'body': json.dumps({'prediction': prediction.tolist()})
    }
```

### Data Processing
```python
# handlers/data/process.py
import pandas as pd

def handler(event, context):
    # Process CSV data
    data = event['body']
    df = pd.read_csv(StringIO(data))
    
    # Transform
    result = df.groupby('category').sum()
    
    return {
        'statusCode': 200,
        'body': result.to_json()
    }
```

### Image Processing
```python
# handlers/images/resize.py
from PIL import Image
import base64
from io import BytesIO

def handler(event, context):
    # Decode base64 image
    image_data = base64.b64decode(event['body'])
    image = Image.open(BytesIO(image_data))
    
    # Resize
    image = image.resize((800, 600))
    
    # Encode back
    buffer = BytesIO()
    image.save(buffer, format='JPEG')
    encoded = base64.b64encode(buffer.getvalue()).decode()
    
    return {
        'statusCode': 200,
        'body': json.dumps({'image': encoded})
    }
```

## Resources

- [AWS Lambda Python](https://docs.aws.amazon.com/lambda/latest/dg/lambda-python.html)
- [Python on Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [Lambda Powertools Python](https://awslabs.github.io/aws-lambda-powertools-python/)

---

**Happy Python Lambda coding!** 🐍
