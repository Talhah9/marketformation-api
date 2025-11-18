// app/api/_lib/cors.ts

// Autoriser toutes les méthodes nécessaires (DELETE, PUT, PATCH…)
const DEFAULT_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

// Headers autorisés côté client
const DEFAULT_HEADERS = 'Origin, Accept, Content-Type, Authorization';

// Résout l'origine autorisée depuis l'env CORS_ORIGINS
function pickAllowedOrigin(reqOrigin: string | null): string | undefined {
  const raw = process.env.CORS_ORIGINS || '';
  if (!raw) return undefined;

  const list = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (!reqOrigin) return list[0];
  const clean = (s: string) => s.replace(/\/+$/, '');
  const found = list.find(o => clean(o) === clean(reqOrigin));

  return found || list[0];
}

export function withCORS(req: Request, res: Response, origin?: string) {
  const allowed = origin || pickAllowedOrigin(req.headers.get('origin'));

  const r = new Response(res.body, res);

  if (allowed) {
    r.headers.set('Access-Control-Allow-Origin', allowed);
    r.headers.set('Vary', 'Origin');
  }

  // *** Obligatoire pour credentials: 'include' ***
  r.headers.set('Access-Control-Allow-Credentials', 'true');

  r.headers.set('Access-Control-Allow-Methods', DEFAULT_METHODS);
  r.headers.set('Access-Control-Allow-Headers', DEFAULT_HEADERS);

  return r;
}

export function jsonWithCors<T>(req: Request, data: T, init?: ResponseInit) {
  const res = new Response(JSON.stringify(data), {
    status: init?.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  return withCORS(req, res);
}

export function handleOptions(req: Request) {
  const res = new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Max-Age': '86400',
    },
  });
  return withCORS(req, res);
}
