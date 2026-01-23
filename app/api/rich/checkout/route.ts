import Stripe from "stripe";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

// ✅ Mets ici tes origines autorisées
const ALLOWED_ORIGINS = new Set([
  "https://iamrich.fr",
  // ajoute aussi ton domaine myshopify si tu testes dessus
  // "https://xxxxx.myshopify.com",
]);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  // si origin pas autorisée → on renvoie quand même 204 sans Allow-Origin (le navigateur bloquera)
  return new Response(null, { status: 204, headers });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  // ✅ Bloque côté serveur si origin pas autorisée (sécurité)
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return Response.json({ error: "Origin not allowed" }, { status: 403, headers });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const nameRaw = body?.name;

    if (!nameRaw || typeof nameRaw !== "string" || nameRaw.trim().length < 2) {
      return Response.json({ error: "Missing or invalid name" }, { status: 400, headers });
    }

    const priceId = process.env.STRIPE_PRICE_RICH_999;
    if (!priceId) {
      return Response.json({ error: "Missing STRIPE_PRICE_RICH_999 env" }, { status: 500, headers });
    }

    const name = nameRaw.trim().slice(0, 24);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { type: "rich_proof", name },
      success_url: `${origin}/pages/imfuckingrich?success=1`,
      cancel_url: `${origin}/pages/imfuckingrich?cancel=1`,
    });

    return Response.json({ url: session.url }, { status: 200, headers });
  } catch (err) {
    console.error("RICH CHECKOUT ERROR:", err);
    return Response.json({ error: "Stripe error" }, { status: 500, headers });
  }
}
