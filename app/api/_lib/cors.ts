// app/api/_lib/cors.ts
import { NextResponse } from "next/server";

// Supporte CORS_ORIGINS (liste) et CORS_ORIGIN (single)
const RAW = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "").trim();
const ALLOWED = RAW
  ? RAW.split(",").map(s => s.trim()).filter(Boolean)
  : []; // peut rester vide, on gère *.myshopify.com en fallback

function computeAllowOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return ALLOWED[0] || "*";
  // origine explicitement autorisée
  if (ALLOWED.includes(origin)) return origin;
  // autorise toutes les boutiques Shopify par défaut (utile en dev/preview)
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith(".myshopify.com")) return origin;
  } catch {}
  // fallback (pas de credentials côté front, donc "*" est OK)
  return ALLOWED[0] || "*";
}

function computeAllowHeaders(req: Request) {
  // Reflète les headers demandés par le préflight si présents
  return (
    req.headers.get("access-control-request-headers") ||
    "Content-Type, Authorization, Accept"
  );
}

export function handleOptions(req: Request) {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Access-Control-Allow-Origin", computeAllowOrigin(req));
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", computeAllowHeaders(req));
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Vary", "Origin, Access-Control-Request-Headers");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function jsonWithCors(req: Request, data: any, init?: ResponseInit) {
  const res = NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: init?.headers,
  });
  res.headers.set("Access-Control-Allow-Origin", computeAllowOrigin(req));
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", computeAllowHeaders(req));
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Vary", "Origin, Access-Control-Request-Headers");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
