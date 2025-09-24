// app/api/upload/pdf/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://tqiccz-96.myshopify.com",
  "https://marketformation.fr", // si tu as ton domaine
];

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  try {
    // ⚠️ on attend du multipart/form-data (FormData) côté front
    const form = await req.formData();
    const file = form.get("pdf") as File | null;
    if (!file) {
      return new Response(JSON.stringify({ ok:false, error:"Missing file 'pdf'" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(req) }
      });
    }

    // TODO: uploade le fichier vers ton stockage (S3/Blob/Cloudflare R2 etc.)
    // ⬇️ exemple fictif : crée une URL publique
    const publicUrl = `https://cdn.mf-assets.com/pdfs/${Date.now()}-${file.name}`;

    return new Response(JSON.stringify({ ok:true, url: publicUrl }), {
      status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(req) }
    });
  } catch (e:any) {
    return new Response(JSON.stringify({ ok:false, error: e?.message || "upload_failed" }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(req) }
    });
  }
}
