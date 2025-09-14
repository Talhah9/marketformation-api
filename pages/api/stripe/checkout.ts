import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { setCors, handleOptions } from '../../lib/cors';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_LIVE as string, {
  apiVersion: '2024-06-20',
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (handleOptions(req, res)) return;          // CORS preflight

  setCors(req, res);                             // CORS sur TOUTES les réponses

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { priceId, email, returnUrl } = req.body || {};
    if (!priceId || !email) {
      res.status(400).json({ error: 'Missing priceId or email' });
      return;
    }

    // 1) Customer par email
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0] || await stripe.customers.create({ email });

    // 2) Session Checkout (SUBSCRIPTION)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}?checkout=cancelled`,
    });

    // ⛔ NE PAS faire res.redirect(session.url) (ça déclenche CORS)
    res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('checkout error', e);
    res.status(500).json({ error: e?.message || 'checkout_failed' });
  }
}
