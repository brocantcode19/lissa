import { NextRequest, NextResponse } from 'next/server';

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
  headers.delete('connection');

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

  try {
    const backendRes = await fetch(targetUrl, fetchOptions);

    return new Response(backendRes.body, {
      status: backendRes.status,
      headers: backendRes.headers,
    });

  } catch (err: unknown) {
    console.error('[Proxy Error]', targetUrl, err);
    return NextResponse.json(
      {
        error: 'Could not reach the backend server.',
        details: err instanceof Error ? err.message : 'Unknown proxy error',
      },
      { status: 502 }
    );
  }
}

export const GET    = proxyRequest;
export const POST   = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH  = proxyRequest;
export const PUT    = proxyRequest;
export const OPTIONS = proxyRequest;
