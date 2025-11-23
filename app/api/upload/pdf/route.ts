// app/api/upload/pdf/route.ts
import { put } from '@vercel/blob'
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors'

export const runtime = 'nodejs'

/**
 * Préflight CORS
 */
export async function OPTIONS(req: Request) {
  return handleOptions(req)
}

export async function POST(req: Request) {
  try {
    // 1) Vérifier le content-type
    const ctype = req.headers.get('content-type') || ''
    if (!ctype.includes('multipart/form-data')) {
      return jsonWithCors(
        req,
        { ok: false, error: 'multipart/form-data required' },
        { status: 400 }
      )
    }

    // 2) Récupérer le fichier
    const form = await req.formData()
    const file = form.get('pdf')

    if (!(file instanceof File)) {
      return jsonWithCors(
        req,
        { ok: false, error: 'pdf field missing' },
        { status: 400 }
      )
    }

    // 3) Vérifier le type (optionnel mais propre)
    if ((file as any).type && (file as any).type !== 'application/pdf') {
      return jsonWithCors(
        req,
        { ok: false, error: 'Only application/pdf allowed' },
        { status: 415 }
      )
    }

    // 4) Limite de taille (15 Mo)
    const size = (file as any).size || 0
    const MAX_SIZE_BYTES = 15 * 1024 * 1024
    if (size && size > MAX_SIZE_BYTES) {
      return jsonWithCors(
        req,
        { ok: false, error: 'File too large' },
        { status: 413 }
      )
    }

    // 5) Upload vers Vercel Blob
    const safeName = ((file as any).name || 'file.pdf').replace(/[^\w.\-]/g, '_')
    const filename = `mf/pdf/${Date.now()}-${safeName}`

    const putRes = await put(filename, file, {
      access: 'public',
      addRandomSuffix: true,
    })

    // 6) Réponse OK + CORS
    return jsonWithCors(
      req,
      { ok: true, url: putRes.url },
      { status: 200 }
    )
  } catch (e: any) {
    console.error('[MF] upload pdf failed', e)
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'upload_failed' },
      { status: 500 }
    )
  }
}
