// app/api/upload/image/route.ts
import { NextResponse } from 'next/server'
import { put } from '@vercel/blob'

const ALLOW_ORIGIN = 'https://tqiccz-96.myshopify.com'
const ALLOW_HEADERS = 'Origin, Accept, Content-Type, Authorization'
const ALLOW_METHODS = 'POST, OPTIONS'
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_SIZE_BYTES = 15 * 1024 * 1024 // 15 MB (ajuste si besoin)

function withCORS(res: Response, origin?: string) {
  const o = origin && origin.trim() ? origin : ALLOW_ORIGIN
  const r = new Response(res.body, res)
  r.headers.set('Access-Control-Allow-Origin', o)
  r.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS)
  r.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS)
  // r.headers.set('Access-Control-Allow-Credentials', 'true') // si cookies cross-site un jour
  r.headers.set('Vary', 'Origin')
  return r
}

export async function OPTIONS(req: Request) {
  return withCORS(new Response(null, { status: 204 }), req.headers.get('origin') || undefined)
}

// Edge marche aussi, mais garde nodejs si tu veux être aligné avec pdf
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const origin = req.headers.get('origin') || undefined

  try {
    // 1) multipart requis
    const ctype = req.headers.get('content-type') || ''
    if (!ctype.includes('multipart/form-data')) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'multipart/form-data required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        }),
        origin
      )
    }

    // 2) récupérer le fichier
    const form = await req.formData()
    const file = form.get('image')
    if (!(file instanceof File)) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'image field missing' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        }),
        origin
      )
    }

    // 3) validations simples
    const mime = (file as any).type || ''
    const size = (file as any).size || 0
    if (mime && !ACCEPTED_TYPES.has(mime)) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'Only PNG, JPG or WEBP allowed' }), {
          status: 415, headers: { 'Content-Type': 'application/json' }
        }),
        origin
      )
    }
    if (size && size > MAX_SIZE_BYTES) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'File too large' }), {
          status: 413, headers: { 'Content-Type': 'application/json' }
        }),
        origin
      )
    }

    // 4) upload vers vercel/blob (nécessite BLOB_READ_WRITE_TOKEN en prod)
    const safeName = ((file as any).name || 'image').replace(/[^\w.\-]/g, '_')
    const filename = `mf/images/${Date.now()}-${safeName}`
    const putRes = await put(filename, file, { access: 'public', addRandomSuffix: true })

    // 5) réponse OK + CORS
    return withCORS(
      new Response(JSON.stringify({ ok: true, url: putRes.url }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      }),
      origin
    )
  } catch (e: any) {
    // 6) toutes les erreurs → CORS présent
    return withCORS(
      new Response(JSON.stringify({ ok: false, error: e?.message || 'upload_failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      }),
      origin
    )
  }
}
