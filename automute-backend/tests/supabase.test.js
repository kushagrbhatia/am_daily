// Mock Supabase before requiring the service
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ data: { path: 'screenshots/test.jpg' }, error: null })
      }))
    },
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ error: null })
    }))
  }))
}));

const supabaseService = require('../services/supabase');

describe('Supabase Service', () => {
  test('saveClassification resolves without throwing', async () => {
    const payload = {
      label: 'ad',
      confidence: 85,
      model_used: 'mini',
      source: 'screenshot',
      site_category: 'youtube',
      hostname: 'youtube.com',
      reasoning: 'Skip ad button visible',
      flagged: false,
      screenshot_url: 'screenshots/abc.jpg'
    };

    await expect(supabaseService.saveClassification(payload)).resolves.not.toThrow();
  });

  test('saveScreenshot returns a storage path', async () => {
    const path = await supabaseService.saveScreenshot('fakebase64data', 'jpg');
    expect(typeof path).toBe('string');
    expect(path).toContain('screenshots/');
  });

  test('saveClassification does not throw if Supabase is unconfigured', async () => {
    // Should fail silently — never crash the classification flow
    const { createClient } = require('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      storage: { from: () => ({ upload: jest.fn().mockResolvedValue({ data: null, error: new Error('no config') }) }) },
      from: () => ({ insert: jest.fn().mockResolvedValue({ error: new Error('no config') }) })
    }));

    await expect(supabaseService.saveClassification({ label: 'ad' })).resolves.not.toThrow();
  });
});
