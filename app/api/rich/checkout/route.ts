import Stripe from "stripe";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

function getOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) return origin;

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {}
  }
  return null;
}

// ✅ GET /api/rich/checkout?name=Gazou
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const nameRaw = url.searchParams.get("name") || "";

    const name = nameRaw.trim().slice(0, 24);
    if (!name || name.length < 2) {
      return new Response("Missing name", { status: 400 });
    }

    const priceId = process.env.STRIPE_PRICE_RICH_999;
    if (!priceId) {
      return new Response("Missing STRIPE_PRICE_RICH_999 env", { status: 500 });
    }

    const origin = getOrigin(req);
    if (!origin) {
      return new Response("Missing origin", { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { type: "rich_proof", name },
      success_url: `${origin}/pages/imfuckingrich?success=1`,
      cancel_url: `${origin}/pages/imfuckingrich?cancel=1`,
    });

    // ✅ redirect browser to Stripe (NO CORS)
    return Response.redirect(session.url as string, 303);
  } catch (err) {
    console.error("RICH CHECKOUT ERROR:", err);
    return new Response("Stripe error", { status: 500 });
  }
}
