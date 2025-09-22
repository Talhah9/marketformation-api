import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { optionsResponse, withCorsJSON } from '../../../lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function keyOf(idOrMail:string) { return `mf/profiles/${encodeURIComponent(idOrMail)}.json`; }

export async function OPTIONS(req: Request) { return corsOptions(req); }

// GET ?shopifyCustomerId=... OR ?email=...
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const id = u.searchParams.get('shopifyCustomerId') || '';
    const email = u.searchParams.get('email') || '';
    const k = keyOf(id || email);
    const url = `https://${process.env.BLOB_PUBLIC_HOST || 'blob.vercel-storage.com'}/${k}`; // si tu as configuré un hostname public
    // on tente de lire
    const r = await fetch(url);
    if (!r.ok) return withCORS(req, NextResponse.json({ ok:true, profile:{} }, { status:200 }));
    const profile = await r.json().catch(()=> ({}));
    return withCORS(req, NextResponse.json({ ok:true, profile }, { status:200 }));
  } catch (e:any) {
    console.error('profile GET', e);
    return withCORS(req, NextResponse.json({ ok:false, error:e.message||'error' }, { status:500 }));
  }
}

// POST body: { shopifyCustomerId/email, bio, avatar_url, expertise_url }
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const id = b.shopifyCustomerId || b.email;
    if (!id) return withCORS(req, NextResponse.json({ ok:false, error:'Missing id/email' }, { status:400 }));

    const profile = {
      bio: b.bio || '',
      avatar_url: b.avatar_url || b.avatarUrl || '',
      expertise_url: b.expertise_url || b.expertiseUrl || ''
    };
    const k = keyOf(String(id));
    const blob = await put(k, new Blob([JSON.stringify(profile)], { type:'application/json' }), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json'
    });
    return withCORS(req, NextResponse.json({ ok:true, profile, url: blob.url }, { status:200 }));
  } catch (e:any) {
    console.error('profile POST', e);
    return withCORS(req, NextResponse.json({ ok:false, error:e.message||'error' }, { status:500 }));
  }
}
