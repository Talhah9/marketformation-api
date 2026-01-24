import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";



const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url, "https://mf-api-gold-topaz.vercel.app");

    const name = (url.searchParams.get("name") || "").trim().slice(0, 24);
    if (!name) return json(400, { ok: false, error: "missing_name" });

    const returnUrlRaw = url.searchParams.get("return_url") || "https://iamrich.fr/";
    let returnUrl: URL;
    try {
      returnUrl = new URL(returnUrlRaw);
    } catch {
      returnUrl = new URL("https://iamrich.fr/");
    }

    // ✅ Sécurise: on renvoie toujours vers le domaine iamrich
    const allowedHosts = new Set(["iamrich.fr", "www.iamrich.fr"]);
    const host = returnUrl.hostname.replace(/^www\./, "");
    const safeOrigin = allowedHosts.has(host) ? returnUrl.origin : "https://iamrich.fr";

    const success_url = `${safeOrigin}/?success=1`;
    const cancel_url = `${safeOrigin}/?cancel=1`;

    // ✅ Ton priceId LIVE (mets le bon ici)
    const priceId = process.env.STRIPE_PRICE_IAMRICH;
    if (!priceId) return json(500, { ok: false, error: "missing_price_env" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: false,
      metadata: { type: "rich_proof", name },
      success_url,
      cancel_url,
    });

    if (!session.url) return json(500, { ok: false, error: "missing_checkout_url" });

    // ✅ Redirection browser -> Stripe (GET flow)
    return Response.redirect(session.url, 303);
  } catch (e: any) {
    console.error("RICH CHECKOUT ERROR:", e);
    return json(500, { ok: false, error: "stripe_error" });
  }
}
