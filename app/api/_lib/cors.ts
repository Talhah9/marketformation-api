// app/api/_lib/cors.ts
export const ALLOWED_ORIGINS = [
  'https://tqiccz-96.myshopify.com',       // ton shop
  // ajoute d'autres origines si besoin (préprod, custom domain, etc.)
];

export function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '*';

  const h = new Headers();
  h.set('Access-Control-Allow-Origin', allowOrigin);
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  h.set('Access-Control-Max-Age', '86400');
  h.set('Vary', 'Origin');
  // Si un jour tu utilises des cookies (credentials:true côté fetch),
  // il faudra mettre Allow-Credentials à true ET ne pas utiliser '*'.
  // h.set('Access-Control-Allow-Credentials', 'true');
  return h;
}

// Réponse au préflight OPTIONS
export function handleOptions(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

// Wrap JSON avec CORS
export function jsonWithCors(req: Request, data: any, init?: ResponseInit) {
  const headers = corsHeaders(req);
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers,
  });
}
