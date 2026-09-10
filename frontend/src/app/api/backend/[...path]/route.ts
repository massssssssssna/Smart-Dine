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
