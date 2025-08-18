import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function GET(req: NextRequest) {
  // MVP : crée un compte Express ; plus tard on persistera cet ID
  const account = await stripe.accounts.create({ type: "express" });

  const base = process.env.FRONTEND_URL || "https://marketformation.fr";
  const refresh = `${base}/pages/creator?onboard=refresh`;
  const ret     = `${base}/pages/creator?onboard=return`;

  const link = await stripe.accountLinks.create({
    account: account.id,
    type: "account_onboarding",
    refresh_url: refresh,
    return_url: ret,
  });

  return NextResponse.json({ url: link.url });
}
