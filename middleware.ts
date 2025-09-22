// middleware.ts
import { NextResponse } from "next/server";

const ORIGIN = process.env.CORS_ORIGIN || "";

export function middleware(req: Request) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api")) return NextResponse.next();

  const res = NextResponse.next();
  res.headers.set("Access-Control-Allow-Origin", ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Shopify-Hmac-Sha256, X-Shopify-Shop-Domain"
  );
  res.headers.set("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: res.headers });
  }
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
