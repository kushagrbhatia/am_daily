const express = require('express');

const app = express();
const port = 8080;

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.listen(port, () => {
  console.log(`Test server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
});