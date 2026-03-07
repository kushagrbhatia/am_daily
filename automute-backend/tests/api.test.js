const request = require('supertest');

// Mock openaiService before requiring app
jest.mock('../services/openai', () => ({
  classifyImage: jest.fn().mockResolvedValue({
    classification: 'other',
    confidence: 80,
    reasoning: 'mock result',
    processing_time: 0.1,
    model_used: 'mini'
  }),
  classifyImageDual: jest.fn().mockResolvedValue({
    classification: 'other',
    confidence: 80,
    reasoning: 'mock dual result',
    processing_time: 0.1,
    model_used: 'mini'
  }),
  healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' })
}));

// Mock imageProcessor to pass through
jest.mock('../services/imageProcessor', () => ({
  optimizeImage: jest.fn().mockImplementation((img) => Promise.resolve(img))
}));

// Mock supabaseService to avoid real DB calls
jest.mock('../services/supabase', () => ({
  saveScreenshot: jest.fn().mockResolvedValue('screenshots/mock.jpg'),
  saveClassification: jest.fn().mockResolvedValue(undefined)
}));

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

  test('POST /api/classify response includes model_used field', async () => {
    const validBase64 = Buffer.from('fake image data').toString('base64');
    const response = await request(app)
      .post('/api/classify')
      .send({ image: validBase64 })
      .expect(200);

    expect(response.body.model_used).toBeDefined();
  });
});
