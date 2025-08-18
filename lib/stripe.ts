// lib/stripe.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  // Lis la version de l'API depuis l'env pour éviter les erreurs de typage.
  apiVersion: (process.env.STRIPE_API_VERSION as any) ?? '2024-06-20',
});

export default stripe;
