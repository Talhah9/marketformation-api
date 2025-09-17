// app/api/_lib/cors.ts
import { NextResponse } from "next/server";

/**
 * Canonical CORS helper for App Router routes.
 * - Reads allowed origins from CORS_ORIGINS (comma-separated) or CORS_ORIGIN.
 * - Falls back to allowing any *.myshopify.com origin.
 * - Adds Vary and Cache-Control for correctness.
 */

const RAW = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "").trim();
const ALLOWED = RAW
  ? RAW.split(",").map(s => s.trim()).filter(Boolean)
  : []; // can be empty; we still allow *.myshopify.com

function computeAllowOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!origin) return ALLOWED[0] || "*";
  if (ALLOWED.includes(origin)) return origin;

  // Safe default for Shopify stores (useful for preview/partners stores)
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith(".myshopify.com")) return origin;
  } catch {}

  return ALLOWED[0] || "*";
}

function computeAllowHeaders(req: Request) {
  // Reflect requested headers on preflight when provided
  return (
    req.headers.get("access-control-request-headers") ||
    "Content-Type, Authorization, Accept"
  );
}

/** Build a plain headers object you can spread anywhere */
export function corsHeaders(
  req: Request,
  methods = "GET,POST,OPTIONS",
  extra?: Record<string, string>
) {
  const h: Record<string, string> = {
    "Access-Control-Allow-Origin": computeAllowOrigin(req),
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": computeAllowHeaders(req),
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
    "Cache-Control": "no-store",
  };
  return extra ? { ...h, ...extra } : h;
}

/** Standard handler for OPTIONS preflight */
export function handleOptions(req: Request, methods = "GET,POST,OPTIONS") {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req, methods),
  });
}

/** JSON response with CORS (preferred in App Router) */
export function jsonWithCors(
  req: Request,
  data: any,
  init?: ResponseInit
): NextResponse {
  const res = NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: init?.headers,
  });
  const h = corsHeaders(req);
  Object.entries(h).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

/** Wrap an existing Response with CORS headers (rarely needed) */
export function withCors(
  req: Request,
  res: Response,
  methods = "GET,POST,OPTIONS"
): Response {
  const h = corsHeaders(req, methods);
  const out = new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
  Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

/** Produce a plain JSON Response with CORS (alternative to NextResponse.json) */
export function plainJsonWithCors(
  req: Request,
  data: any,
  status = 200,
  extra?: HeadersInit
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req),
      ...(extra || {}),
    },
  });
}
