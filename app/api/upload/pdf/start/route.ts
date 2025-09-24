// app/api/upload/pdf/start/route.ts
import { NextResponse } from 'next/server'
import { generateUploadURL } from '@vercel/blob'

const ALLOW_ORIGIN = (process.env.CORS_ORIGINS || '').split(',')[0] || 'https://tqiccz-96.myshopify.com'
function withCORS(res: Response, origin?: string) {
  const r = new Response(res.body, res)
  r.headers.set('Access-Control-Allow-Origin', origin || ALLOW_ORIGIN)
  r.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Origin, Accept, Content-Type, Authorization')
  r.headers.set('Vary', 'Origin')
  return r
}

export async function OPTIONS(req: Request) {
  return withCORS(new Response(null, { status: 204 }), req.headers.get('origin') || undefined)
}

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const origin = req.headers.get('origin') || undefined
  try {
    const { filename, contentType } = await req.json().catch(() => ({}))
    if (!filename) return withCORS(new Response(JSON.stringify({ ok:false, error:'filename required' }), { status:400, headers:{'Content-Type':'application/json'} }), origin)

    const { url } = await generateUploadURL({
      access: 'public',
      contentType: contentType || 'application/pdf',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname: `mf/pdf/${Date.now()}-${filename.replace(/[^\w.\-]/g,'_')}`
    })

    return withCORS(new Response(JSON.stringify({ ok:true, uploadUrl:url }), { status:200, headers:{'Content-Type':'application/json'} }), origin)
  } catch (e:any) {
    return withCORS(new Response(JSON.stringify({ ok:false, error:e?.message || 'start_failed' }), { status:500, headers:{'Content-Type':'application/json'} }), origin)
  }
}
