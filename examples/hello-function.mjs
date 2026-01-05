/**
 * Example D-Shield Function - Hello World
 *
 * This is a simple example function that demonstrates:
 * 1. Receiving a request
 * 2. Making an external API call (logged by D-Shield)
 * 3. Returning a response
 */

export async function handler(request) {
  const name = request.body?.name || request.query?.name || 'World';

  // This fetch call will be logged by D-Shield
  // In production, this would go through the proxy
  // For testing without proxy, we'll just simulate

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      message: `Hello, ${name}!`,
      timestamp: new Date().toISOString(),
      request: {
        method: request.method,
        path: request.path,
      },
    },
  };
}
