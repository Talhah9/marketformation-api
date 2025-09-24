// app/api/upload/pdf/route.ts
import { NextResponse } from 'next/server'
import { put } from '@vercel/blob' // si tu utilises vercel blob côté serveur

const ALLOW_ORIGIN = 'https://tqiccz-96.myshopify.com'
const ALLOW_HEADERS = 'Origin, Accept, Content-Type, Authorization'
const ALLOW_METHODS = 'POST, OPTIONS'

function withCORS(res: Response, origin?: string) {
  const o = origin && origin.trim() ? origin : ALLOW_ORIGIN
  const r = new Response(res.body, res)
  r.headers.set('Access-Control-Allow-Origin', o)
  r.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS)
  r.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS)
  r.headers.set('Access-Control-Allow-Credentials', 'false')
  r.headers.set('Vary', 'Origin')
  return r
}

export async function OPTIONS(req: Request) {
  return withCORS(new Response(null, { status: 204 }), req.headers.get('origin') || undefined)
}

export const runtime = 'nodejs' // facultatif, mais utile si Edge posait souci

export async function POST(req: Request) {
  const origin = req.headers.get('origin') || undefined

  try {
    // 1) content-type doit être multipart/form-data
    const ctype = req.headers.get('content-type') || ''
    if (!ctype.includes('multipart/form-data')) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'multipart/form-data required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }),
        origin
      )
    }

    // 2) récupérer le fichier
    const form = await req.formData()
    const file = form.get('pdf')
    if (!(file instanceof File)) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'pdf field missing' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }),
        origin
      )
    }

    // 3) (optionnel) vérifier le type + taille
    if (file.type && file.type !== 'application/pdf') {
      // certains navigateurs ne mettent pas toujours file.type : on reste souple
      // ici on ne bloque que si le type est renseigné et ≠ pdf
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'Only application/pdf allowed' }), {
          status: 415,
          headers: { 'Content-Type': 'application/json' }
        }),
        origin
      )
    }

    // 4) upload — vercel/blob
    //    nécessite BLOB_READ_WRITE_TOKEN en prod (Vercel Project → Env)
    const filename = `mf/pdf/${Date.now()}-${(file as any).name || 'file.pdf'}`
    const putRes = await put(filename, file, {
      access: 'public', // ou 'private' si tu gères les tokens
      addRandomSuffix: true,
    })

    // 5) réponse OK + CORS
    return withCORS(
      new Response(JSON.stringify({ ok: true, url: putRes.url }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }),
      origin
    )
  } catch (e: any) {
    // 6) TOUTES LES ERREURS PASSENT ICI → on POSE CORS
    return withCORS(
      new Response(JSON.stringify({ ok: false, error: e?.message || 'upload_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }),
      origin
    )
  }
}
