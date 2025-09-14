// app/api/stripe/checkout/route.ts (ou équivalent)
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function POST(req: Request) {
  try {
    const { priceId, email, returnUrl, couponCode } = await req.json();

    // (Optionnel) convertir un code lisible "TEST100" -> id promotion_code "promo_..."
    let promotionCodeId: string | undefined;
    if (couponCode) {
      const pcs = await stripe.promotionCodes.list({ code: couponCode, limit: 1 });
      promotionCodeId = pcs.data[0]?.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email || undefined,
      allow_promotion_codes: true,              // ← clé pour afficher le champ
      discounts: promotionCodeId ? [{ promotion_code: promotionCodeId }] : undefined, // pré-applique si fourni
      success_url: (returnUrl || 'https://tqiccz-96.myshopify.com/pages/mon-compte-formateur') + '?status=success',
      cancel_url:  (returnUrl || 'https://tqiccz-96.myshopify.com/pages/mon-compte-formateur') + '?status=cancel',
    });

    return new Response(JSON.stringify({ url: session.url }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'checkout_failed' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
}
