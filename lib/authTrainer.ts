// lib/authTrainer.ts
import type { NextRequest } from "next/server";

export type TrainerContext = {
  trainerId: string;
  email: string | null;
  isAdmin: boolean;
};

function parseAdminEmails() {
  const raw = process.env.MF_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email: string | null) {
  if (!email) return false;
  const list = parseAdminEmails();
  if (!list.length) return false;
  return list.includes(String(email).trim().toLowerCase());
}

export function getTrainerFromRequest(req: NextRequest | Request): TrainerContext | null {
  const trainerId =
    req.headers.get("x-trainer-id") ||
    req.headers.get("x-shopify-customer-id") ||
    null;

  if (!trainerId) return null;

  const email =
    req.headers.get("x-trainer-email") ||
    req.headers.get("x-mf-admin-email") || // ✅ support
    null;

  return {
    trainerId,
    email,
    isAdmin: isAdminEmail(email),
  };
}

export function buildTrainerHeaders(ctx: TrainerContext | null): HeadersInit {
  if (!ctx) return {};
  const headers: HeadersInit = {};
  headers["x-trainer-id"] = ctx.trainerId;
  if (ctx.email) headers["x-trainer-email"] = ctx.email;
  if (ctx.isAdmin && ctx.email) headers["x-mf-admin-email"] = ctx.email; // ✅ optionnel
  return headers;
}
