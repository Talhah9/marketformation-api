export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Shopify-Hmac-Sha256, X-Shopify-Shop-Domain",
  "Access-Control-Allow-Credentials": "true",
};

export function withCorsJSON(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...corsHeaders,
    ...(init.headers || {}),
  });
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
