/**
 * Example D-Shield Function - Anthropic API Proxy
 *
 * This function demonstrates a real-world use case:
 * - Receives a prompt from the user
 * - Calls the Anthropic API (logged by D-Shield)
 * - Returns the response
 *
 * All API calls are transparently logged, proving that
 * user data only goes to api.anthropic.com.
 */

export async function handler(request) {
  const { prompt, model = 'claude-3-haiku-20240307' } = request.body || {};

  if (!prompt) {
    return {
      statusCode: 400,
      body: { error: 'Missing required field: prompt' },
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: { error: 'ANTHROPIC_API_KEY not configured' },
    };
  }

  try {
    // This fetch call is logged by D-Shield
    // Users can verify this is the only external call made
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        statusCode: response.status,
        body: { error: `Anthropic API error: ${error}` },
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      body: {
        response: data.content[0]?.text,
        model: data.model,
        usage: data.usage,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: { error: error.message },
    };
  }
}
