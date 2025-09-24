// app/api/upload/pdf/start/route.ts
// Cette route n'est plus utilisée car l'upload se fait maintenant en 1 étape via /api/upload/pdf.
// On garde un endpoint de compat pour éviter les 404 côté front.

const ALLOW_ORIGIN = (process.env.CORS_ORIGINS || '').split(',')[0] || 'https://tqiccz-96.myshopify.com';

function withCORS(res: Response, origin?: string) {
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', origin || ALLOW_ORIGIN);
  r.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Origin, Accept, Content-Type, Authorization');
  r.headers.set('Vary', 'Origin');
  return r;
}

export async function OPTIONS(req: Request) {
  return withCORS(new Response(null, { status: 204 }), req.headers.get('origin') || undefined);
}

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const origin = req.headers.get('origin') || undefined;

  // Compat: au lieu de renvoyer une URL présignée (generateUploadURL),
  // on indique d'utiliser l’endpoint direct en multipart/form-data.
  const payload = {
    ok: true,
    directUpload: false,
    endpoint: '/api/upload/pdf',
    method: 'POST',
    field: 'pdf',
    message: 'Cette route est dépréciée. Uploade le fichier PDF en POST multipart vers /api/upload/pdf (champ "pdf").',
  };

  return withCORS(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
    origin
  );
}
