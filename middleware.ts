import { NextResponse, NextRequest } from 'next/server';

export const config = {
  matcher: ['/api/:path*'],
};

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const origin =
    req.headers.get('origin') ||
    'https://marketformation.fr';

  // Tous les headers doivent recevoir un string strict
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Trainer-Id'
  );
  res.headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS'
  );

  // Réponse préflight OPTIONS
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: res.headers,
    });
  }

  return res;
}
