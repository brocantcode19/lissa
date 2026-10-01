export const runtime = 'edge';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:8000';

export async function POST(request: Request) {
  const backendUrl = `${BACKEND_URL}/api/query/stream`;

  const forwardHeaders: Record<string, string> = {
    'content-type': 'application/json',
  };

  const cookie = request.headers.get('cookie');
  if (cookie) forwardHeaders['cookie'] = cookie;

  let body: ArrayBuffer | null = null;
  try {
    body = await request.arrayBuffer();
  } catch {
    return new Response(
      JSON.stringify({ detail: 'Invalid request body.' }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }
    );
  }

  try {
    const backendRes = await fetch(backendUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: body,
    });

    if (!backendRes.ok) {
      const errorBody = await backendRes.text();
      return new Response(errorBody, {
        status: backendRes.status,
        headers: {
          'content-type':
            backendRes.headers.get('content-type') || 'application/json',
        },
      });
    }

    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    const setCookie = backendRes.headers.get('set-cookie');
    if (setCookie) headers.set('set-cookie', setCookie);

    return new Response(backendRes.body, {
      status: backendRes.status,
      headers,
    });
  } catch (err) {
    console.error('[Stream Proxy Error]', err);
    return new Response(
      JSON.stringify({
        detail: 'Streaming service temporarily unavailable.',
      }),
      {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}
