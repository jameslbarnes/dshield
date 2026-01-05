/**
 * Test function for D-Shield integration tests.
 *
 * This function simulates a real-world scenario where a function
 * makes external API calls that should be logged by D-Shield.
 */

export async function handler(event, context) {
  const mockApiPort = process.env.MOCK_API_PORT || '8888';
  const mockApiBase = `http://127.0.0.1:${mockApiPort}`;

  // Parse the event
  const action = event.action || 'default';

  const results = [];

  if (action === 'make_api_calls') {
    // Make multiple API calls to test logging
    try {
      const response1 = await fetch(`${mockApiBase}/api/v1/data`, {
        method: 'GET',
      });
      results.push({ call: 1, status: response1.status });
    } catch (e) {
      results.push({ call: 1, error: e.message });
    }

    try {
      const response2 = await fetch(`${mockApiBase}/api/v1/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test payload' }),
      });
      results.push({ call: 2, status: response2.status });
    } catch (e) {
      results.push({ call: 2, error: e.message });
    }
  } else {
    // Default action - just echo back the event
    results.push({ action: 'echo', event });
  }

  return {
    statusCode: 200,
    body: {
      message: 'Function executed successfully',
      results,
      timestamp: new Date().toISOString(),
    },
  };
}
