import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function proxyRequest(request: NextRequest): Promise<Response> {
  try {
    const backendUrl = (
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'https://lissa-production.up.railway.app'
    ).replace(/\/$/, '');

    let subPath = request.nextUrl.pathname.replace(/^\/api\/proxy/, '');
    if (!subPath.startsWith('/api')) {
      subPath = `/api${subPath}`;
    }

    const targetUrl = `${backendUrl}${subPath}${request.nextUrl.search}`;

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');

    const cookie = request.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);

    const authHeader = request.headers.get('authorization');
    if (authHeader) headers.set('authorization', authHeader);

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(request.method);

    const fetchOptions: RequestInit & { duplex?: string } = {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      cache: 'no-store',
      redirect: 'follow',
    };

    if (hasBody) {
      fetchOptions.duplex = 'half';
    }

    const response = await fetch(targetUrl, fetchOptions);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Cache-Control', 'no-cache, no-transform');
    responseHeaders.set('X-Accel-Buffering', 'no');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error('Proxy Error:', err);
    return NextResponse.json(
      { error: 'Could not reach the backend server.', details: err.message },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
export const OPTIONS = proxyRequest;
