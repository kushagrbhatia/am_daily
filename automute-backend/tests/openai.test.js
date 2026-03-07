const openaiService = require('../services/openai');

// Mock the OpenAI client so tests don't make real API calls
jest.mock('openai', () => {
  const mockCreate = jest.fn();
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate
      }
    }
  }));
  MockOpenAI._mockCreate = mockCreate;
  return MockOpenAI;
});

describe('OpenAI Service - classifyImageDual', () => {
  let mockCreate;

  beforeEach(() => {
    const OpenAI = require('openai');
    mockCreate = OpenAI._mockCreate;
    jest.clearAllMocks();
  });

  test('returns mini result when confidence >= threshold', async () => {
    // Arrange: mini returns high confidence
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"classification":"ad","confidence":85,"reasoning":"clear ad"}' } }]
    });

    // Act
    const result = await openaiService.classifyImageDual('fakebase64', 75);

    // Assert: only one API call made (mini)
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe('ad');
    expect(result.confidence).toBe(85);
    expect(result.model_used).toBe('mini');
  });

  test('falls back to gpt-4o when mini confidence < threshold', async () => {
    // mini returns low confidence
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"classification":"ad","confidence":60,"reasoning":"uncertain"}' } }]
    });
    // gpt-4o returns high confidence
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"classification":"game","confidence":90,"reasoning":"definitely game"}' } }]
    });

    const result = await openaiService.classifyImageDual('fakebase64', 75);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.classification).toBe('game');
    expect(result.confidence).toBe(90);
    expect(result.model_used).toBe('gpt4o');
    expect(result.mini_result).toBeDefined();
    expect(result.mini_result.confidence).toBe(60);
  });

  test('returns mini result if gpt-4o call fails', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"classification":"ad","confidence":60,"reasoning":"uncertain"}' } }]
    });
    mockCreate.mockRejectedValueOnce(new Error('OpenAI error'));

    const result = await openaiService.classifyImageDual('fakebase64', 75);

    expect(result.model_used).toBe('mini');
    expect(result.confidence).toBe(60);
  });
});
