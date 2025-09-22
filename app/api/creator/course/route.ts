﻿import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({}));
  // TODO: crÃ©er un produit Shopify via Admin API
  return NextResponse.json({ ok: true, received: payload });
}

