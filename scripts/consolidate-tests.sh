#!/bin/bash

# Consolidate Test Scripts
# Moves test scripts from scripts/ to tests/integration/

set -e

echo "🔄 Consolidating test scripts..."
echo ""

# Move test scripts
echo "Moving test-health-checks.sh..."
mv scripts/test-health-checks.sh tests/integration/

echo "Moving test-image-upload.ts..."
mv scripts/test-image-upload.ts tests/integration/

echo "Moving test-throttling.sh..."
mv scripts/test-throttling.sh tests/integration/

echo ""
echo "✅ Test scripts consolidated!"
echo ""
echo "New structure:"
echo "tests/integration/"
echo "├── test-handlers.sh"
echo "├── test-api-auth.sh"
echo "├── test-api.sh"
echo "├── test-middleware.sh"
echo "├── test-health-checks.sh     ✅ MOVED"
echo "├── test-image-upload.ts      ✅ MOVED"
echo "└── test-throttling.sh        ✅ MOVED"
echo ""
echo "🎯 Next steps:"
echo "1. Update any documentation references"
echo "2. Run: pnpm test:integration"
echo "3. Add GraphQL tests"
