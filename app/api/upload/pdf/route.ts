// CORS permissif + stub d'upload PDF
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
    const file = fd.get('pdf') || fd.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: "field 'pdf' manquant" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    // 👉 Placeholder : un PDF public pour valider le flux
    const url = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
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
