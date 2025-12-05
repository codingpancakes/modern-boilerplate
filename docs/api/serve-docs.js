const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3111;

// Serve static files from docs directory
app.use(express.static(path.join(__dirname)));

// Main route - serve Swagger UI
app.get('/', (req, res) => {
  try {
    // Try to load OpenAPI spec
    const openApiPath = path.join(__dirname, 'openapi.json');
    
    if (!fs.existsSync(openApiPath)) {
      return res.status(404).send(`
        <h1>OpenAPI Spec Not Found</h1>
        <p>Run <code>node scripts/generate-openapi.js</code> to generate the OpenAPI specification.</p>
      `);
    }

    const openApiSpec = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
    console.log('✅ Auto-generated OpenAPI spec loaded successfully');

    // Serve Swagger UI HTML
    const swaggerHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>postway API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin:0; background: #fafafa; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const ui = SwaggerUIBundle({
        spec: ${JSON.stringify(openApiSpec)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;

    res.send(swaggerHtml);
  } catch (error) {
    console.error('❌ Error loading OpenAPI spec:', error.message);
    res.status(500).send(`
      <h1>Error Loading API Documentation</h1>
      <p>Error: ${error.message}</p>
      <p>Try running <code>node scripts/generate-openapi.js</code> to regenerate the OpenAPI specification.</p>
    `);
  }
});

// Serve raw OpenAPI JSON
app.get('/openapi.json', (req, res) => {
  try {
    const openApiPath = path.join(__dirname, 'openapi.json');
    if (fs.existsSync(openApiPath)) {
      res.sendFile(openApiPath);
    } else {
      res.status(404).json({ error: 'OpenAPI spec not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log('📚 API Documentation server running at http://localhost:3111');
  console.log('🔗 Swagger UI: http://localhost:3111');
  console.log('📄 OpenAPI JSON: http://localhost:3111/openapi.json');
  console.log('🤖 Using auto-generated documentation');
});
