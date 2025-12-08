// lib/authTrainer.ts
import type { NextRequest } from 'next/server'

/**
 * Contexte formateur injecté via les headers :
 *  - x-trainer-id    : l'id Shopify du customer (string)
 *  - x-trainer-email : l'email du formateur
 */
export type TrainerContext = {
  trainerId: string
  email: string | null
}

/**
 * Récupère le formateur à partir des headers de la requête.
 * Retourne null si rien n'est présent (non connecté / non formateur).
 */
export function getTrainerFromRequest(
  req: NextRequest | Request
): TrainerContext | null {
  const trainerId =
    req.headers.get('x-trainer-id') ||
    req.headers.get('x-shopify-customer-id') ||
    null

  if (!trainerId) return null

  const email = req.headers.get('x-trainer-email') || null

  return {
    trainerId,
    email,
  }
}

/**
 * Optionnel : helper si tu dois fabriquer les headers côté backend
 * (par ex. quand une route en appelle une autre).
 */
export function buildTrainerHeaders(ctx: TrainerContext | null): HeadersInit {
  if (!ctx) return {}
  const headers: HeadersInit = {}
  headers['x-trainer-id'] = ctx.trainerId
  if (ctx.email) headers['x-trainer-email'] = ctx.email
  return headers
}
