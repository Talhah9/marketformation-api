import { NextResponse } from 'next/server';
import { optionsResponse, withCorsJSON } from '../../../../lib/cors';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) { return corsOptions(req); }
export async function POST(req: Request) {
  // ici tu plugs ton système (Shopify customer invite ou email provider)
  return withCORS(req, NextResponse.json({ ok:true }, { status:200 }));
}
