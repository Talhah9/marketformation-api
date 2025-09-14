import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { setCors, handleOptions } from '../../lib/cors';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_LIVE as string, {
  apiVersion: '2024-06-20',
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { email, returnUrl } = req.body || {};
    if (!email) { res.status(400).json({ error: 'Missing email' }); return; }

    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0];
    if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
    });

    res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('portal error', e);
    res.status(500).json({ error: e?.message || 'portal_failed' });
  }
}
