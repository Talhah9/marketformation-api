import { optionsResponse, withCorsJSON } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

// GET: renvoyer le profil public (bio, avatar_url, expertise_url)
export async function GET() {
  // TODO: lire les metafields Shopify si nécessaire
  return withCorsJSON({ ok: true, bio: "", avatar_url: "", expertise_url: "" }, { status: 200 });
}

// POST: enregistrer les champs de profil public
export async function POST(req: Request) {
  try {
    const { bio, avatar_url, expertise_url } = await req.json();
    // TODO: sauvegarder en metafields Shopify (mf.bio, mf.avatar_url, mf.expertise_url)
    return withCorsJSON({ ok: true }, { status: 200 });
  } catch (e: any) {
    return withCorsJSON({ ok: false, error: e?.message || "Save failed" }, { status: 500 });
  }
}
