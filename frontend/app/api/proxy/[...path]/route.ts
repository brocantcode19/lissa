import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:8000';

async function proxyRequest(
  request: NextRequest,
  { params }: { params: { path: string[] } }
): Promise<NextResponse> {
  const path       = params.path.join('/');
  const backendPath = path === 'documents' ? `${path}/` : path;
  const backendUrl = `${BACKEND_URL}/api/${backendPath}`;

  const forwardHeaders: Record<string, string> = {};

  const cookie = request.headers.get('cookie');
  if (cookie) forwardHeaders['cookie'] = cookie;

  const contentType = request.headers.get('content-type');
  const isMultipart = contentType?.includes('multipart/form-data');
  if (contentType) {
    forwardHeaders['content-type'] = contentType;
  }

  let body: Buffer | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    body = Buffer.from(await request.arrayBuffer());
    if (isMultipart) {
      forwardHeaders['content-length'] = String(body.byteLength);
    }
  }

  try {
    const backendRes = await fetch(backendUrl, {
      method:   request.method,
      headers:  forwardHeaders,
      body:     body as unknown as BodyInit,
      redirect: 'follow',
    });

    const resContentType = backendRes.headers.get('content-type') || '';

    // ── SSE / streaming response — pipe through directly ──────────────────
    // Do NOT buffer SSE — return the ReadableStream body as-is.
    // This is what makes streaming work through the Next.js proxy.
    if (resContentType.includes('text/event-stream')) {
      return new NextResponse(backendRes.body, {
        status:  backendRes.status,
        headers: {
          'Content-Type':      'text/event-stream',
          'Cache-Control':     'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
          'Connection':        'keep-alive',
          // Forward Set-Cookie if present
          ...(backendRes.headers.get('set-cookie')
            ? { 'set-cookie': backendRes.headers.get('set-cookie')! }
            : {}),
        },
      });
    }

    // ── Normal JSON/binary response ───────────────────────────────────────
    const responseHeaders = new Headers();
    if (resContentType) responseHeaders.set('content-type', resContentType);

    const setCookie = backendRes.headers.get('set-cookie');
    if (setCookie) responseHeaders.set('set-cookie', setCookie);

    return new NextResponse(backendRes.body, {
      status:  backendRes.status,
      headers: responseHeaders,
    });

  } catch (err) {
    console.error('[Proxy Error]', backendUrl, err);
    return new NextResponse(
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
