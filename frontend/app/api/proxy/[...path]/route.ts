import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:8000';

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const backendUrl = `${BACKEND_URL}/api/${path.join('/')}`;

  const forwardHeaders: Record<string, string> = {};

  const cookie = request.headers.get('cookie');
  if (cookie) {
    forwardHeaders['cookie'] = cookie;
  }

  const authorization = request.headers.get('authorization');
  if (authorization) {
    forwardHeaders['authorization'] = authorization;
  }

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
      method: request.method,
      headers: forwardHeaders,
      body: body || undefined,
      redirect: 'follow',
    });

    const resContentType = backendRes.headers.get('content-type') || '';

    if (resContentType.includes('text/event-stream')) {
      const headers = new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
      const setCookie = backendRes.headers.get('set-cookie');
      if (setCookie) headers.set('set-cookie', setCookie);
      return new NextResponse(backendRes.body, {
        status: backendRes.status,
        headers,
      });
    }

    const responseHeaders = new Headers();
    if (resContentType) {
      responseHeaders.set('content-type', resContentType);
    }
    const setCookie = backendRes.headers.get('set-cookie');
    if (setCookie) {
      responseHeaders.set('set-cookie', setCookie);
    }
    return new NextResponse(backendRes.body, {
      status: backendRes.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error('[Proxy Error]', backendUrl, err);
    return new NextResponse(
      JSON.stringify({
        detail: 'Could not reach the backend server.',
      }),
      {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
export const PUT = proxyRequest;
