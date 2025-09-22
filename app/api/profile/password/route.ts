import { optionsResponse, withCorsJSON } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const { oldPassword, newPassword } = await req.json();
    if (!newPassword) {
      return withCorsJSON({ ok: false, error: "Missing newPassword" }, { status: 400 });
    }
    // TODO: logique de changement de mot de passe (si géré côté Shopify/App)
    return withCorsJSON({ ok: true }, { status: 200 });
  } catch (e: any) {
    return withCorsJSON({ ok: false, error: e?.message || "Password change failed" }, { status: 500 });
  }
}
