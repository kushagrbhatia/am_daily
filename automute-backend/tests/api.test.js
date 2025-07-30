const request = require('supertest');
const app = require('../app');

describe('API Endpoints', () => {
  test('GET /health should return healthy status', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);
      
    expect(response.body.status).toBe('healthy');
    expect(response.body.version).toBe('1.0.0');
  });
  
  test('POST /api/classify should require image data', async () => {
    const response = await request(app)
      .post('/api/classify')
      .send({})
      .expect(400);
      
    expect(response.body.error).toBe('missing_image');
  });
  
  test('POST /api/classify should validate base64 format', async () => {
    const response = await request(app)
      .post('/api/classify')
      .send({ image: 'invalid_base64!' })
      .expect(400);
      
    expect(response.body.error).toBe('invalid_base64');
  });
});