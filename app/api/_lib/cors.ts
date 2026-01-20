// app/api/_lib/cors.ts

// Autoriser toutes les méthodes nécessaires (DELETE, PUT, PATCH…)
const DEFAULT_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

// Headers autorisés côté client
// ✅ AJOUT: x-mf-admin-email + X-Requested-With (et laisser Authorization)
const DEFAULT_HEADERS =
  'Origin, Accept, Content-Type, Authorization, X-Requested-With, x-mf-admin-email';

// ✅ fallback safe (si env pas renseignée)
const FALLBACK_ORIGINS = [
  'https://marketformation.fr',
  'https://www.marketformation.fr',
];

// normalise une origin (supprime trailing slash)
const clean = (s: string) => String(s || '').trim().replace(/\/+$/, '');

// Résout l'origine autorisée depuis l'env CORS_ORIGINS
function pickAllowedOrigin(reqOrigin: string | null): string | undefined {
  const raw = (process.env.CORS_ORIGINS || '').trim();

  // build list = env + fallback, unique
  const envList = raw
    ? raw
        .split(',')
        .map((s) => clean(s))
        .filter(Boolean)
    : [];

  const list = Array.from(new Set([...envList, ...FALLBACK_ORIGINS.map(clean)]));

  // ⚠️ IMPORTANT: pour CORS, il faut renvoyer exactement l'Origin reçue
  // si elle est autorisée. Sinon, le navigateur bloque.
  if (reqOrigin) {
    const reqC = clean(reqOrigin);
    const found = list.find((o) => o === reqC);
    return found ? reqOrigin : undefined;
  }

  // si pas d'Origin (curl/server-side), on peut renvoyer la 1ère autorisée
  return list[0];
}

export function withCORS(req: Request, res: Response, origin?: string) {
  const reqOrigin = req.headers.get('origin');
  const allowed = origin || pickAllowedOrigin(reqOrigin);

  const r = new Response(res.body, res);

  if (allowed) {
    r.headers.set('Access-Control-Allow-Origin', allowed);
    r.headers.set('Vary', 'Origin');

    // *** Obligatoire pour credentials: 'include' ***
    // ✅ On ne met Credentials que si ACAO est présent (sinon certains navigateurs râlent)
    r.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  r.headers.set('Access-Control-Allow-Methods', DEFAULT_METHODS);
  r.headers.set('Access-Control-Allow-Headers', DEFAULT_HEADERS);

  // ✅ bonus safe: cache preflight
  if (!r.headers.get('Access-Control-Max-Age')) {
    r.headers.set('Access-Control-Max-Age', '86400');
  }

  return r;
}

export function jsonWithCors<T>(req: Request, data: T, init?: ResponseInit) {
  const res = new Response(JSON.stringify(data), {
    status: init?.status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
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
