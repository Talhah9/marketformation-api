// lib/authTrainer.ts
import { NextRequest } from 'next/server';

export type CurrentTrainer = {
  trainerId: string;
  email?: string;
};

export async function getCurrentTrainer(req: NextRequest): Promise<CurrentTrainer> {
  // 🧠 À brancher plus tard sur ton vrai système (App Proxy Shopify, JWT, etc.)
  // Pour l’instant, on lit les en-têtes envoyés par ta section Shopify.
  const trainerId = req.headers.get('x-mf-trainer-id');
  const email = req.headers.get('x-mf-trainer-email') || undefined;

  if (!trainerId) {
    throw new Error('Trainer not authenticated');
  }

  return { trainerId, email };
}
