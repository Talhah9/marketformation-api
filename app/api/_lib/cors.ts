// app/api/_lib/cors.ts
import { NextResponse } from "next/server";

// Autorisations via ENV (optionnel) — exemple: CORS_ORIGINS="https://tqiccz-96.myshopify.com,https://xxx.myshopify.com"
const RAW = (process.env.CORS_ORIGINS || "").trim();
const ALLOWED = RAW ? RAW.split(",").map(s => s.trim()).filter(Boolean) : [];

function allowOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return ALLOWED[0] || "*";
  if (ALLOWED.includes(origin)) return origin;
  try {
    const { hostname } = new URL(origin);
    if (hostname.endsWith(".myshopify.com")) return origin; // fallback utile en dev/preview
  } catch {}
  return ALLOWED[0] || "*";
}

function allowHeaders(req: Request) {
  const reqHdrs = req.headers.get("access-control-request-headers");
  return reqHdrs || "Origin, Accept, Content-Type, Authorization";
}

export function handleOptions(req: Request) {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Access-Control-Allow-Origin", allowOrigin(req));
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", allowHeaders(req));
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Vary", "Origin, Access-Control-Request-Headers");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function jsonWithCors(req: Request, data: any, init?: ResponseInit) {
  const res = NextResponse.json(data, { status: init?.status ?? 200, headers: init?.headers });
  res.headers.set("Access-Control-Allow-Origin", allowOrigin(req));
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", allowHeaders(req));
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Vary", "Origin, Access-Control-Request-Headers");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
