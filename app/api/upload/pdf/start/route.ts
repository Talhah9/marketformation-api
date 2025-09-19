// app/api/upload/pdf/start/route.ts
import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN =
  process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse, methods = 'POST,OPTIONS') {
  const origin = req.headers.get('origin') || ALLOWED_ORIGIN;
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', methods);
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  return res;
}

export async function OPTIONS(req: Request) {
  return withCORS(req, new NextResponse(null, { status: 204 }));
}

export async function POST(request: Request) {
  // Le body doit être JSON envoyé par le client uploader
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      request,
      body,
      // 1) Génère un token d’upload pour le navigateur
      onBeforeGenerateToken: async (
        pathname,
        /* clientPayload */
      ) => {
        return {
          allowedContentTypes: ['application/pdf'],
          addRandomSuffix: true,
          access: 'public', // URL publique
          tokenPayload: JSON.stringify({ scope: 'mf/pdf' }), // optionnel
          // callbackUrl: 'https://mf-api-gold.vercel.app/api/upload/pdf/start', // optionnel
        };
      },
      // 2) Callback quand l’upload direct est terminé (Vercel appelle ton endpoint)
      onUploadCompleted: async ({ blob /*, tokenPayload */ }) => {
        // Tu peux persister blob.url en BDD ici si tu veux
        console.log('Blob uploaded:', blob.url);
      },
    });

    return withCORS(
      request,
      NextResponse.json(jsonResponse, { status: 200 })
    );
  } catch (error: any) {
    return withCORS(
      request,
      NextResponse.json(
        { error: error?.message || 'handleUpload failed' },
        { status: 400 }
      )
    );
  }
}
