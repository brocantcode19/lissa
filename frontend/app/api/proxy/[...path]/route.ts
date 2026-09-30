import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://backend:8000';

async function proxyRequest(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname.replace('/api/proxy', '');
  const backendBase = BACKEND_URL.replace(/\/$/, '');
  const apiPath = backendBase.endsWith('/api') ? path : `/api${path}`;
  const targetUrl = `${backendBase}${apiPath}${request.nextUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete('host');

  try {
    const backendRes = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      // @ts-ignore - duplex is required for streaming request bodies.
      duplex: 'half',
      redirect: 'follow',
    });

    return new Response(backendRes.body, {
      status: backendRes.status,
      headers: backendRes.headers,
    });

  } catch (err) {
    console.error('[Proxy Error]', targetUrl, err);
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
