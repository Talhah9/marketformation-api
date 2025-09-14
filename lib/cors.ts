// lib/cors.ts
export function setCors(req: any, res: any) {
  const origin = req.headers.origin || '';
  const ALLOWED = [
    'https://tqiccz-96.myshopify.com',   // ton dev store
    // 'https://<ton-store-prod>.myshopify.com', // ajoute la prod quand prête
    // 'http://localhost:3000'             // si tu testes en local
  ];

  const isAllowed = ALLOWED.includes(origin);
  if (isAllowed) res.setHeader('Access-Control-Allow-Origin', origin);
  // si tu préfères en dev : res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function handleOptions(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    setCors(req, res);
    res.status(204).end();
    return true;
  }
  return false;
}
