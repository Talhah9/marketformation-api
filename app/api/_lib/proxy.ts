// app/api/_lib/proxy.ts
import crypto from "crypto";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Shopify App Proxy signature verification
 * Shopify ajoute ?signature=...&timestamp=...&path_prefix=... etc.
 * On doit reconstruire la query string triée (sans "signature") puis HMAC-SHA256 hex.
 */
export function verifyShopifyAppProxy(req: NextRequest, sharedSecret: string): boolean {
  try {
    if (!sharedSecret) return false;

    const url = req.nextUrl;
    const sig = url.searchParams.get("signature") || "";
    if (!sig) return false;

    // construire message = key=value triés, sans signature
    const pairs: string[] = [];
    url.searchParams.forEach((value, key) => {
      if (key === "signature") return;
      pairs.push(`${key}=${value}`);
    });
    pairs.sort(); // important
    const message = pairs.join("");

    const digest = crypto.createHmac("sha256", sharedSecret).update(message).digest("hex");

    // comparaison safe
    const a = Buffer.from(digest, "utf8");
    const b = Buffer.from(sig, "utf8");
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
  } catch {
    return false;
  }
}

export function getProxyViewer(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return {
    email: sp.get("email") || "",
    shopifyCustomerId: sp.get("shopifyCustomerId") || "",
  };
}
