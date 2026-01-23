import Stripe from "stripe";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const nameRaw = body?.name;

    if (!nameRaw || typeof nameRaw !== "string" || nameRaw.trim().length < 2) {
      return Response.json({ error: "Missing or invalid name" }, { status: 400 });
    }

    const priceId = process.env.STRIPE_PRICE_RICH_999;
    if (!priceId) {
      return Response.json({ error: "Missing STRIPE_PRICE_RICH_999 env" }, { status: 500 });
    }

    const origin = req.headers.get("origin");
    if (!origin) {
      return Response.json({ error: "Missing origin" }, { status: 400 });
    }

    const name = nameRaw.trim().slice(0, 24);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { type: "rich_proof", name },
      success_url: `${origin}/pages/imfuckingrich?success=1`,
      cancel_url: `${origin}/pages/imfuckingrich?cancel=1`,
    });

    return Response.json({ url: session.url }, { status: 200 });
  } catch (err) {
    console.error("RICH CHECKOUT ERROR:", err);
    return Response.json({ error: "Stripe error" }, { status: 500 });
  }
}
