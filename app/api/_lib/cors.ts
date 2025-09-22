// lib/cors.ts
export const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Hmac-Sha256, X-Shopify-Shop-Domain",
  "Access-Control-Allow-Credentials": "true",
};

export function withCors(json: any, init: ResponseInit = {}) {
  return new Response(JSON.stringify(json), {
    ...init,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...(init.headers || {}) },
  });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
