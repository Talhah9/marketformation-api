// app/api/_lib/proxy.ts
import crypto from "crypto";
import type { NextRequest } from "next/server";

type VerifyResult =
  | { ok: true; shop?: string; loggedInCustomerId?: string }
  | { ok: false; reason: string };

function safeTimingEqual(a: string, b: string) {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");

  if (ba.length !== bb.length) return false;

  // ✅ Convertit Buffer -> Uint8Array neuf (ArrayBuffer), compatible TS
  const ua = Uint8Array.from(ba);
  const ub = Uint8Array.from(bb);

  return crypto.timingSafeEqual(ua, ub);
}


export function verifyShopifyAppProxy(
  req: NextRequest,
  sharedSecret: string | undefined
): VerifyResult {
  try {
    if (!sharedSecret) return { ok: false, reason: "MISSING_SHARED_SECRET" };

    const url = new URL(req.url);
    const params = new URLSearchParams(url.search);

    // Shopify App Proxy utilise `signature` (hex). On supporte aussi `hmac` au cas où.
    const signature = params.get("signature") ?? params.get("hmac");
    if (!signature) return { ok: false, reason: "MISSING_SIGNATURE" };

    // Conserver certains champs utiles
    const shop = params.get("shop") ?? undefined;
    const loggedInCustomerId = params.get("logged_in_customer_id") ?? undefined;

    // Construire un hash key -> valeurs[] (pour gérer extra=1&extra=2)
    const map = new Map<string, string[]>();
    for (const [k, v] of params.entries()) {
      if (k === "signature" || k === "hmac") continue;
      const arr = map.get(k) ?? [];
      arr.push(v);
      map.set(k, arr);
    }

    // Convertir en ["k=v1,v2", ...] puis trier lexicographiquement, puis join sans "&"
    const pieces = Array.from(map.entries()).map(([k, values]) => {
      return `${k}=${values.join(",")}`;
    });

    pieces.sort(); // tri lexicographique
    const message = pieces.join("");

    const computed = crypto
      .createHmac("sha256", sharedSecret)
      .update(message, "utf8")
      .digest("hex");

    if (!safeTimingEqual(signature, computed)) {
      return { ok: false, reason: "INVALID_SIGNATURE" };
    }

    return { ok: true, shop, loggedInCustomerId };
  } catch (e: any) {
    // IMPORTANT: ne jamais throw → sinon 500
    return { ok: false, reason: `VERIFY_EXCEPTION:${e?.message ?? "unknown"}` };
  }
}
