/**
 * Tests for generate-prompt TEE function
 *
 * These tests define the expected behavior. The function must pass all tests
 * before being deployed to production.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the function handler - will be replaced with actual implementation
let handler: (request: any) => Promise<any>;
let mockFetch: ReturnType<typeof vi.fn>;

// Mock sessions storage
let sessions: Record<string, any>;

beforeEach(() => {
  sessions = {};
  mockFetch = vi.fn();

  // Reset mocks before each test
  vi.clearAllMocks();
});

describe('generate-prompt TEE function', () => {

  describe('basic functionality', () => {

    it('returns a prompt given valid input', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: { content: 'A serene mountain landscape at sunset' }
          }]
        })
      });

      const result = await handler({
        body: {
          session_id: 'test-session-1',
          transcript: 'I see beautiful mountains',
          style_tags: 'artist:monet',
          vj_instruction: null
        }
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.prompt).toBeDefined();
      expect(typeof result.body.prompt).toBe('string');
      expect(result.body.prompt.length).toBeGreaterThan(0);
    });

    it('returns provider_used and latency_ms', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: { content: 'A beautiful scene' }
          }]
        })
      });

      const result = await handler({
        body: {
          session_id: 'test-session-2',
          transcript: 'Hello world',
          style_tags: '',
          vj_instruction: null
        }
      });

      expect(result.body.provider_used).toMatch(/^(cerebras|claude-fallback)$/);
      expect(typeof result.body.latency_ms).toBe('number');
      expect(result.body.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('handles empty transcript gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: { content: 'Abstract flowing colors' }
          }]
        })
      });

      const result = await handler({
        body: {
          session_id: 'test-session-3',
          transcript: '',
          style_tags: 'genre:abstract',
          vj_instruction: null
        }
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.prompt).toBeDefined();
    });

    it('handles missing body gracefully', async () => {
      const result = await handler({});

      expect(result.statusCode).toBe(400);
      expect(result.body.error).toBeDefined();
    });
  });

  describe('session management', () => {

    it('creates new session if doesnt exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'First prompt' } }]
        })
      });

      await handler({
        body: {
          session_id: 'new-session',
          transcript: 'Hello',
          style_tags: '',
          vj_instruction: null
        }
      });

      // Session should exist now
      expect(sessions['new-session']).toBeDefined();
      expect(sessions['new-session'].recent_prompts).toHaveLength(5);
    });

    it('maintains recent prompts across calls', async () => {
      const sessionId = 'persistent-session';

      // First call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'First prompt' } }]
        })
      });
      await handler({
        body: { session_id: sessionId, transcript: 'First', style_tags: '', vj_instruction: null }
      });

      // Second call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Second prompt' } }]
        })
      });
      await handler({
        body: { session_id: sessionId, transcript: 'Second', style_tags: '', vj_instruction: null }
      });

      // Check prompts are stored
      expect(sessions[sessionId].recent_prompts[0]).toBe('Second prompt');
      expect(sessions[sessionId].recent_prompts[1]).toBe('First prompt');
    });

    it('rotates prompts correctly (newest at index 0, max 5)', async () => {
      const sessionId = 'rotation-session';

      // Make 6 calls
      for (let i = 1; i <= 6; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: `Prompt ${i}` } }]
          })
        });
        await handler({
          body: { session_id: sessionId, transcript: `Call ${i}`, style_tags: '', vj_instruction: null }
        });
      }

      // Should have last 5 prompts, newest first
      expect(sessions[sessionId].recent_prompts[0]).toBe('Prompt 6');
      expect(sessions[sessionId].recent_prompts[1]).toBe('Prompt 5');
      expect(sessions[sessionId].recent_prompts[4]).toBe('Prompt 2');
      // Prompt 1 should be pushed out
    });

    it('isolates sessions from each other', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'A prompt' } }]
        })
      });

      await handler({
        body: { session_id: 'session-a', transcript: 'For A', style_tags: '', vj_instruction: null }
      });
      await handler({
        body: { session_id: 'session-b', transcript: 'For B', style_tags: '', vj_instruction: null }
      });

      expect(sessions['session-a']).toBeDefined();
      expect(sessions['session-b']).toBeDefined();
      expect(sessions['session-a']).not.toBe(sessions['session-b']);
    });
  });

  describe('provider logic', () => {

    it('tries Cerebras (OpenRouter) first', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Cerebras response' } }]
        })
      });

      const result = await handler({
        body: { session_id: 'provider-test', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      expect(result.body.provider_used).toBe('cerebras');

      // Verify OpenRouter was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain('openrouter.ai');
    });

    it('falls back to Claude when Cerebras fails', async () => {
      // Cerebras fails (3 attempts)
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        // Claude succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ text: 'Claude fallback response' }]
          })
        });

      const result = await handler({
        body: { session_id: 'fallback-test', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.provider_used).toBe('claude-fallback');
      expect(result.body.prompt).toBe('Claude fallback response');
    });

    it('returns error when all providers fail', async () => {
      // All calls fail
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await handler({
        body: { session_id: 'all-fail', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      expect(result.statusCode).toBe(500);
      expect(result.body.error).toContain('failed');
    });

    it('retries Cerebras up to 3 times before fallback', async () => {
      // Cerebras fails 3 times, Claude succeeds
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429 }) // Rate limit
        .mockResolvedValueOnce({ ok: false, status: 500 }) // Server error
        .mockResolvedValueOnce({ ok: false, status: 503 }) // Unavailable
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ text: 'Claude response' }]
          })
        });

      await handler({
        body: { session_id: 'retry-test', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      // Should have called OpenRouter 3 times + Claude 1 time
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('prompt construction', () => {

    it('includes style tags in system prompt', async () => {
      let capturedBody: any;
      mockFetch.mockImplementationOnce(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'Response' } }]
          })
        };
      });

      await handler({
        body: {
          session_id: 'style-test',
          transcript: 'A forest',
          style_tags: 'artist:van_gogh, genre:impressionism, mood:dreamy',
          vj_instruction: null
        }
      });

      const systemMessage = capturedBody.messages.find((m: any) => m.role === 'system');
      expect(systemMessage.content).toContain('van_gogh');
      expect(systemMessage.content).toContain('impressionism');
      expect(systemMessage.content).toContain('dreamy');
    });

    it('includes recent prompts for context', async () => {
      const sessionId = 'context-test';

      // Set up session with existing prompts
      sessions[sessionId] = {
        recent_prompts: ['Previous prompt about mountains', 'Earlier prompt about ocean', '', '', ''],
        created_at: Date.now()
      };

      let capturedBody: any;
      mockFetch.mockImplementationOnce(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'New response' } }]
          })
        };
      });

      await handler({
        body: {
          session_id: sessionId,
          transcript: 'Now a desert',
          style_tags: '',
          vj_instruction: null
        }
      });

      const userMessage = capturedBody.messages.find((m: any) => m.role === 'user');
      expect(userMessage.content).toContain('mountains');
      expect(userMessage.content).toContain('ocean');
    });

    it('handles VJ instruction: evolve', async () => {
      let capturedBody: any;
      mockFetch.mockImplementationOnce(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'Evolved scene' } }]
          })
        };
      });

      await handler({
        body: {
          session_id: 'vj-evolve',
          transcript: 'Keep going',
          style_tags: '',
          vj_instruction: 'evolve'
        }
      });

      const systemMessage = capturedBody.messages.find((m: any) => m.role === 'system');
      expect(systemMessage.content.toLowerCase()).toContain('evolve');
      expect(systemMessage.content.toLowerCase()).toContain('subtle');
    });

    it('handles VJ instruction: jump', async () => {
      let capturedBody: any;
      mockFetch.mockImplementationOnce(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'New scene' } }]
          })
        };
      });

      await handler({
        body: {
          session_id: 'vj-jump',
          transcript: 'Something new',
          style_tags: '',
          vj_instruction: 'jump'
        }
      });

      const systemMessage = capturedBody.messages.find((m: any) => m.role === 'system');
      expect(systemMessage.content.toLowerCase()).toContain('jump');
      expect(systemMessage.content.toLowerCase()).toMatch(/shift|new scene/);
    });

    it('handles VJ instruction: remix', async () => {
      let capturedBody: any;
      mockFetch.mockImplementationOnce(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'Remixed scene' } }]
          })
        };
      });

      await handler({
        body: {
          session_id: 'vj-remix',
          transcript: 'Mix it up',
          style_tags: '',
          vj_instruction: 'remix'
        }
      });

      const systemMessage = capturedBody.messages.find((m: any) => m.role === 'system');
      expect(systemMessage.content.toLowerCase()).toContain('remix');
      expect(systemMessage.content.toLowerCase()).toMatch(/style|change/);
    });
  });

  describe('response parsing', () => {

    it('extracts content from <prompt> tags', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Here is the prompt: <prompt>A beautiful sunset over mountains</prompt> Hope that works!'
            }
          }]
        })
      });

      const result = await handler({
        body: { session_id: 'tag-test', transcript: 'Sunset', style_tags: '', vj_instruction: null }
      });

      expect(result.body.prompt).toBe('A beautiful sunset over mountains');
    });

    it('handles response without <prompt> tags', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: { content: 'A beautiful sunset over mountains' }
          }]
        })
      });

      const result = await handler({
        body: { session_id: 'no-tag-test', transcript: 'Sunset', style_tags: '', vj_instruction: null }
      });

      expect(result.body.prompt).toBe('A beautiful sunset over mountains');
    });

    it('parses Claude response format correctly', async () => {
      // Cerebras fails, Claude succeeds
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            content: [{
              type: 'text',
              text: 'Claude generated this prompt'
            }],
            stop_reason: 'end_turn'
          })
        });

      const result = await handler({
        body: { session_id: 'claude-format', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      expect(result.body.prompt).toBe('Claude generated this prompt');
    });

    it('trims whitespace from prompts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: { content: '  \n  A prompt with whitespace  \n  ' }
          }]
        })
      });

      const result = await handler({
        body: { session_id: 'trim-test', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      expect(result.body.prompt).toBe('A prompt with whitespace');
    });
  });

  describe('response format', () => {

    it('returns correct success response schema', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'A prompt' } }]
        })
      });

      const result = await handler({
        body: { session_id: 'schema-test', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      // Verify schema
      expect(result).toHaveProperty('statusCode');
      expect(result).toHaveProperty('body');
      expect(result.body).toHaveProperty('prompt');
      expect(result.body).toHaveProperty('provider_used');
      expect(result.body).toHaveProperty('latency_ms');

      // Verify types
      expect(typeof result.statusCode).toBe('number');
      expect(typeof result.body.prompt).toBe('string');
      expect(typeof result.body.provider_used).toBe('string');
      expect(typeof result.body.latency_ms).toBe('number');
    });

    it('returns correct error response schema', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await handler({
        body: { session_id: 'error-schema', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      expect(result.statusCode).toBe(500);
      expect(result.body).toHaveProperty('error');
      expect(typeof result.body.error).toBe('string');
    });
  });

  describe('security', () => {

    it('does not leak API keys in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'A prompt' } }]
        })
      });

      const result = await handler({
        body: { session_id: 'security-test', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      const responseStr = JSON.stringify(result);
      expect(responseStr).not.toContain('sk-ant');
      expect(responseStr).not.toContain('sk-or');
      expect(responseStr).not.toContain('API_KEY');
    });

    it('does not leak API keys in error responses', async () => {
      mockFetch.mockRejectedValue(new Error('Connection failed with key sk-ant-xxx'));

      const result = await handler({
        body: { session_id: 'security-error', transcript: 'Test', style_tags: '', vj_instruction: null }
      });

      const responseStr = JSON.stringify(result);
      expect(responseStr).not.toContain('sk-ant');
    });
  });

  describe('edge cases', () => {

    it('handles very long transcript', async () => {
      const longTranscript = 'word '.repeat(1000); // 5000+ chars

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Handled long input' } }]
        })
      });

      const result = await handler({
        body: { session_id: 'long-input', transcript: longTranscript, style_tags: '', vj_instruction: null }
      });

      expect(result.statusCode).toBe(200);
    });

    it('handles special characters in transcript', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Handled special chars' } }]
        })
      });

      const result = await handler({
        body: {
          session_id: 'special-chars',
          transcript: 'Test with "quotes" and <tags> and émojis 🎨',
          style_tags: '',
          vj_instruction: null
        }
      });

      expect(result.statusCode).toBe(200);
    });

    it('handles unicode in style tags', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Handled unicode' } }]
        })
      });

      const result = await handler({
        body: {
          session_id: 'unicode',
          transcript: 'Test',
          style_tags: 'artist:北斎, mood:禅',
          vj_instruction: null
        }
      });

      expect(result.statusCode).toBe(200);
    });

    it('handles concurrent requests to same session', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Concurrent response' } }]
        })
      });

      const sessionId = 'concurrent-session';

      // Fire 5 concurrent requests
      const promises = Array(5).fill(null).map((_, i) =>
        handler({
          body: {
            session_id: sessionId,
            transcript: `Request ${i}`,
            style_tags: '',
            vj_instruction: null
          }
        })
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach(result => {
        expect(result.statusCode).toBe(200);
      });
    });
  });
});
