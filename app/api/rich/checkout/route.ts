import Stripe from "stripe";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

function safeName(input: string) {
  return (input || "").trim().slice(0, 24);
}

function isAllowedReturnHost(host: string) {
  return host === "iamrich.fr" || host === "www.iamrich.fr";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const name = safeName(url.searchParams.get("name") || "");
    if (!name || name.length < 2) {
      return new Response("Missing name", { status: 400 });
    }

    const returnUrlRaw = url.searchParams.get("return_url") || "";
    let returnUrl: URL;

    try {
      returnUrl = new URL(returnUrlRaw);
    } catch {
      return new Response("Invalid return_url", { status: 400 });
    }

    if (!isAllowedReturnHost(returnUrl.host)) {
      return new Response("return_url not allowed", { status: 403 });
    }

    const priceId = process.env.STRIPE_PRICE_RICH_999;
    if (!priceId) {
      return new Response("Missing STRIPE_PRICE_RICH_999 env", { status: 500 });
    }

    const path = returnUrl.pathname && returnUrl.pathname !== "/" ? returnUrl.pathname : "/";
const baseReturn = `${returnUrl.origin}${path}`;
    const successUrl = `${baseReturn}?success=1`;
    const cancelUrl = `${baseReturn}?cancel=1`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { type: "rich_proof", name },
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return Response.redirect(session.url as string, 303);
  } catch (err) {
    console.error("RICH CHECKOUT ERROR:", err);
    return new Response("Stripe error", { status: 500 });
  }
}
