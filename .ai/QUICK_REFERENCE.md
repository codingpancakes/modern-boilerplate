# Quick Reference: What to Tell AI

Use this guide when asking AI to create new handlers.

---

## 🎯 For TypeScript Handlers

### User-Scoped Handler (No Org Required)
```
Create a new user-scoped handler for [FEATURE].
- Endpoint: [METHOD] /v1/[resource]/[action]
- Purpose: [What it does]
- Input: [What data it accepts]
- Output: [What it returns]
```

**Example:**
```
Create a new user-scoped handler for user preferences.
- Endpoint: PATCH /v1/users/preferences
- Purpose: Update user's app preferences
- Input: { theme: string, notifications: boolean }
- Output: Updated user preferences
```

---

### Organization-Scoped Handler (Requires Org Membership)
```
Create a new org-scoped handler for [FEATURE].
- Endpoint: [METHOD] /v1/orgs/{orgId}/[resource]/[action]
- Purpose: [What it does]
- Requires: Organization membership check
- Input: [What data it accepts]
- Output: [What it returns]
```

**Example:**
```
Create a new org-scoped handler for campaigns.
- Endpoint: POST /v1/orgs/{orgId}/campaigns
- Purpose: Create a new campaign for an organization
- Requires: Organization membership check
- Input: { name: string, description: string, startDate: string }
- Output: Created campaign object
```

---

### Public/Webhook Handler
```
Create a new public handler for [FEATURE].
- Endpoint: [METHOD] /v1/[resource]
- Purpose: [What it does]
- Auth: None (or webhook signature)
- Input: [What data it accepts]
- Output: [What it returns]
```

**Example:**
```
Create a new webhook handler for Stripe payments.
- Endpoint: POST /v1/webhooks/stripe
- Purpose: Handle Stripe payment events
- Auth: Webhook signature verification
- Input: Stripe event payload
- Output: 200 OK
```

---

## 🐍 For Python Lambda Handlers

### Python Proxy Handler (ML, Data Processing, etc.)
```
Create a new Python Lambda handler with TypeScript proxy for [FEATURE].
- Endpoint: [METHOD] /v1/[resource]/[action]
- Purpose: [What Python logic it performs]
- Python work: [ML model, data processing, etc.]
- Input: [What data it accepts]
- Output: [What it returns]
- Memory: [128/256/512/1024 MB - higher for ML]
- Timeout: [5/10/30 seconds - longer for ML]
```

**Example:**
```
Create a new Python Lambda handler with TypeScript proxy for ML predictions.
- Endpoint: POST /v1/ml/predict
- Purpose: Run ML inference on user data
- Python work: scikit-learn model prediction
- Input: { features: number[] }
- Output: { prediction: string, confidence: number }
- Memory: 512 MB
- Timeout: 30 seconds
```

---

## 📝 Complete Examples

### Example 1: Simple TypeScript Handler
```
Create a new user-scoped handler for updating user avatar.
- Endpoint: PATCH /v1/users/avatar
- Purpose: Update user's avatar URL
- Input: { avatarUrl: string }
- Output: Updated user object
- Validation: avatarUrl must be a valid URL
```

### Example 2: Organization Handler
```
Create a new org-scoped handler for listing contacts.
- Endpoint: GET /v1/orgs/{orgId}/contacts
- Purpose: List all contacts in an organization
- Requires: Organization membership check
- Query params: { page?: number, limit?: number, search?: string }
- Output: Paginated list of contacts
```

### Example 3: Python ML Handler
```
Create a new Python Lambda handler with TypeScript proxy for sentiment analysis.
- Endpoint: POST /v1/ml/sentiment
- Purpose: Analyze sentiment of text using Python NLP
- Python work: Use transformers library for sentiment analysis
- Input: { text: string }
- Output: { sentiment: 'positive'|'negative'|'neutral', score: number }
- Memory: 1024 MB (for transformer model)
- Timeout: 30 seconds
- Dependencies: transformers, torch
```

---

## ✅ What AI Should Do Automatically

When you ask AI to create a handler, it should:

### For TypeScript Handlers:
1. ✅ Choose the right template (user-scoped, org-scoped, or public)
2. ✅ Create handler file in correct location
3. ✅ Create Zod schema in appropriate domain file
4. ✅ Export schema in `validation/index.ts`
5. ✅ Add Swagger documentation
6. ✅ Use response helpers
7. ✅ Add persistent logging
8. ✅ Register route in CDK (if needed)
9. ✅ Add test to integration test script

### For Python Proxy Handlers:
1. ✅ Create TypeScript proxy handler
2. ✅ Create Python handler file
3. ✅ Add Python Lambda to CDK
4. ✅ Add TypeScript proxy to CDK
5. ✅ Set up environment variables
6. ✅ Add IAM permissions (already exists globally)
7. ✅ Add API Gateway route
8. ✅ Add test to integration test script
9. ✅ Add Python dependencies to requirements.txt (if needed)

---

## 🚫 Common Mistakes to Avoid

### Don't Say:
❌ "Create a Python handler for user authentication"  
✅ **Why**: Auth should ALWAYS be in TypeScript. Python receives pre-validated claims.

❌ "Make the Python Lambda publicly accessible"  
✅ **Why**: Python Lambdas should NEVER be public. Only TypeScript proxy is public.

❌ "Add try-catch to the handler"  
✅ **Why**: Middleware handles errors automatically.

❌ "Use raw SQL for the query"  
✅ **Why**: Always use Drizzle ORM.

---

## 📚 Reference Files

- **Patterns**: `.ai/PATTERNS.md` - All code patterns
- **Templates**: `.ai/TEMPLATES.md` - How to use templates
- **Context**: `.ai/CONTEXT.md` - Project overview
- **Python Guide**: `src/python/README.md` - Python-specific guide
- **Audit**: `PYTHON_PROXY_AUDIT.md` - Security & architecture

---

## 🎯 TL;DR

**For TypeScript:**
```
Create a [user-scoped/org-scoped/public] handler for [FEATURE].
Endpoint: [METHOD] /v1/[path]
Purpose: [description]
Input: [schema]
Output: [response]
```

**For Python:**
```
Create a Python Lambda with TypeScript proxy for [FEATURE].
Endpoint: [METHOD] /v1/[path]
Python work: [ML/data processing/etc]
Input: [schema]
Output: [response]
Memory: [size]
Timeout: [seconds]
```

**That's it!** AI will handle the rest following the patterns in `.ai/PATTERNS.md`.
