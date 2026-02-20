import { put } from '@vercel/blob'
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const file = form.get('video') as File | null
    const email = (form.get('email') as string) || ''
    const shopifyCustomerId = (form.get('shopifyCustomerId') as string) || ''

    if (!file) {
      return Response.json(
        { ok: false, error: 'missing_video' },
        { status: 400 }
      )
    }

    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 120)

    const path = `mf/videos/${shopifyCustomerId || 'guest'}/${Date.now()}-${safeName}`

    const blob = await put(path, file, {
      access: 'public',
      contentType: file.type || 'video/mp4',
      addRandomSuffix: false,
    })

    return Response.json({
      ok: true,
      url: blob.url,
      name: safeName,
      size: file.size,
      type: file.type,
      email,
    })
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        error: 'upload_video_failed',
        detail: err?.message || String(err),
      },
      { status: 500 }
    )
  }
}
