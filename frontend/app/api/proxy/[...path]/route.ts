export const runtime = 'edge';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:8000';

async function proxyRequest(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const path = (await params).path.join('/');
  const backendUrl = `${BACKEND_URL}/api/${path}`;

  const forwardHeaders: Record<string, string> = {};

  const cookie = request.headers.get('cookie');
  if (cookie) forwardHeaders['cookie'] = cookie;

  const contentType = request.headers.get('content-type');
  if (contentType && !contentType.includes('multipart/form-data')) {
    forwardHeaders['content-type'] = contentType;
  }

  let body: ArrayBuffer | null = null;
  if (!['GET', 'HEAD'].includes(request.method)) {
    body = await request.arrayBuffer();
  }

  try {
    const backendRes = await fetch(backendUrl, {
      method:   request.method,
      headers:  forwardHeaders,
      body:     body || undefined,
      redirect: 'follow',
    });

    const resContentType = backendRes.headers.get('content-type') || '';

    // ── SSE / streaming response — pipe through directly ──────────────────
    // Do NOT buffer SSE — return the ReadableStream body as-is.
    // This is what makes streaming work through the Next.js proxy.
    if (resContentType.includes('text/event-stream')) {
      const headers = new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'Connection': 'keep-alive',
      });
      const setCookie = backendRes.headers.get('set-cookie');
      if (setCookie) headers.set('set-cookie', setCookie);

      return new Response(backendRes.body, {
        status: backendRes.status,
        headers,
      });
    }

    const headers = new Headers();
    if (resContentType) headers.set('content-type', resContentType);

    const setCookie = backendRes.headers.get('set-cookie');
    if (setCookie) headers.set('set-cookie', setCookie);

    return new Response(backendRes.body, {
      status: backendRes.status,
      headers,
    });

  } catch (err) {
    console.error('[Proxy Error]', backendUrl, err);
    return new Response(
      JSON.stringify({ detail: 'Could not reach the backend server.' }),
      { status: 503, headers: { 'content-type': 'application/json' } }
    );
  }
}

export const GET    = proxyRequest;
export const POST   = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH  = proxyRequest;
export const PUT    = proxyRequest;
