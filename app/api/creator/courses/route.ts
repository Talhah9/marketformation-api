import { NextResponse } from "next/server";

export async function GET() {
  // TODO: lire dans Shopify ; dÃ©mo statique :
  return NextResponse.json({
    items: [
      { id: "demo-1", title: "Pack Templates Facturation", price: "39â‚¬", status: "draft" },
      { id: "demo-2", title: "SEO Starter", price: "49â‚¬", status: "active" }
    ]
  });
}

