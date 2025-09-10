// CORS permissif + stub d'upload image
export const runtime = 'nodejs';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const file = fd.get('image') || fd.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: "field 'image' manquant" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    // 👉 Placeholder : on renvoie une URL d'image valide pour tester l'enchaînement
    const url = `https://picsum.photos/seed/${Date.now()}/1200/630`;
    return new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'upload_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}
