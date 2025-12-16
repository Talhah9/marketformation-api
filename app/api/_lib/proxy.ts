import crypto from "crypto";
import { NextRequest } from "next/server";

/**
 * Vérifie la signature Shopify App Proxy.
 * Nécessite APP_PROXY_SHARED_SECRET (le secret "App proxy" de Shopify).
 */
export function verifyShopifyAppProxy(req: NextRequest): boolean {
  const secret =
    process.env.APP_PROXY_SHARED_SECRET ||
    process.env.SHOPIFY_APP_PROXY_SECRET ||
    "";

  if (!secret) return false;

  const url = new URL(req.url);
  const signature = url.searchParams.get("signature");
  if (!signature) return false;

  // Shopify signe tous les params sauf "signature"
  const params: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    if (key === "signature") return;
    params.push([key, value]);
  });

  params.sort((a, b) => a[0].localeCompare(b[0]));

  const message = params.map(([k, v]) => `${k}=${v}`).join("");

  const generated = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  // TS-safe timing compare (évite ton erreur Buffer/ArrayBufferView)
  const a = new Uint8Array(Buffer.from(signature, "utf8"));
  const b = new Uint8Array(Buffer.from(generated, "utf8"));
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
