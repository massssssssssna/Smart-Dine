import { NextRequest, NextResponse } from 'next/server';

const base = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: THIRTY_DAYS,
};

type SessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: unknown;
};

// Global in-flight refresh mutex to prevent Supabase token rotation race conditions
const inFlightRefresh = new Map<string, Promise<SessionPayload | null>>();

async function refreshSession(refreshToken: string): Promise<SessionPayload | null> {
  const existing = inFlightRefresh.get(refreshToken);
  if (existing) return existing;
  const pending = (async () => {
    try {
      const res = await fetch(`${base}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        return (await res.json()) as SessionPayload;
      }
      return null;
    } catch {
      return null;
    } finally {
      setTimeout(() => {
        inFlightRefresh.delete(refreshToken);
      }, 500);
    }
  })();
  inFlightRefresh.set(refreshToken, pending);
  return pending;
}

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  if (!/^[a-zA-Z0-9/_-]+$/.test(path)) {
    return NextResponse.json({ message: 'Invalid path.' }, { status: 400 });
  }

  const allowedOrigins = (process.env.APP_ORIGINS || 'http://127.0.0.1:3000,http://localhost:3000')
    .split(',')
    .map(x => x.trim());

  if (req.method !== 'GET' && !allowedOrigins.includes(req.headers.get('origin') || '')) {
    return NextResponse.json({ message: 'Request origin is not permitted.' }, { status: 403 });
  }

  const length = Number(req.headers.get('content-length') || 0);
  if (length > 2_000_000) return NextResponse.json({ message: 'Request too large.' }, { status: 413 });

  let body: string | undefined;
  if (req.method !== 'GET') {
    body = await req.text();
    if (Buffer.byteLength(body) > 2_000_000) return NextResponse.json({ message: 'Request too large.' }, { status: 413 });
  }

  let access = req.cookies.get('sd_access')?.value;
  const refresh = req.cookies.get('sd_refresh')?.value;
  let session: SessionPayload | undefined;
  let refreshAttempted = false;

  const send = (token?: string) =>
    fetch(`${base}/api/v1/${path}${req.nextUrl.search}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(req.headers.get('idempotency-key') ? { 'Idempotency-Key': req.headers.get('idempotency-key')! } : {}),
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });

  try {
    let upstream = await send(access);

    // If 401 and we have a refresh token, use concurrency mutex to renew transparently
    if (upstream.status === 401 && refresh && !path.startsWith('auth/login')) {
      refreshAttempted = true;
      const renewed = await refreshSession(refresh);
      if (renewed) {
        session = renewed;
        access = session.access_token;
        upstream = await send(access);
      }
    }

    let data = upstream.status === 204 ? null : await upstream.json();

    if (path === 'auth/login' && upstream.ok) {
      session = data as SessionPayload;
      data = { user: (data as SessionPayload).user };
    }

    const res = upstream.status === 204
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json(data, { status: upstream.status });

    res.headers.set('Cache-Control', 'no-store');

    // Update long-lived 30-day cookies whenever session or tokens are created/refreshed
    if (session) {
      res.cookies.set('sd_access', session.access_token, cookieOptions);
      res.cookies.set('sd_refresh', session.refresh_token, cookieOptions);
    }

    // Explicit logout or confirmed revoked session: clean up cookies
    const isExplicitLogout = path === 'auth/logout' && upstream.ok;
    const isPasswordReset = path === 'auth/password' && upstream.ok;
    const isSessionDead = upstream.status === 401 && (!refresh || (refreshAttempted && !session));

    if (isExplicitLogout || isPasswordReset || isSessionDead) {
      res.cookies.set('sd_access', '', { ...cookieOptions, maxAge: 0 });
      res.cookies.set('sd_refresh', '', { ...cookieOptions, maxAge: 0 });
    }

    return res;
  } catch {
    return NextResponse.json(
      { message: 'Restaurant service is unavailable. Check that the backend is running.' },
      { status: 503 }
    );
  }
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
