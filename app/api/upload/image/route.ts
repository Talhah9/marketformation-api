// Upload image → Shopify Files CDN (REST)
// Prérequis env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_ACCESS_TOKEN
import { put } from '@vercel/blob';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('image') as File | null;
    if (!file) return new Response(JSON.stringify({ error: 'no_image' }), { status: 400 });

    const ext = (file.name?.split('.').pop() || 'png').toLowerCase();
    const key = `courses/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const blob = await put(key, Buffer.from(await file.arrayBuffer()), {
      access: 'public',
      contentType: file.type || 'image/png',
    });

    return new Response(JSON.stringify({ url: blob.url }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'upload_image_failed' }), { status: 500 });
  }
}

