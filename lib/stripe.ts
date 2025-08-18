import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing STRIPE_SECRET_KEY');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  // On caste car TS dépend de la version du package pour connaître la dernière apiVersion.
  apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
});
