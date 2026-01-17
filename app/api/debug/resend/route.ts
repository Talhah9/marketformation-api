import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.RESEND_API_KEY || "";
  const from = process.env.EMAIL_FROM || "MarketFormation <onboarding@resend.dev>";
  const to = process.env.TEST_EMAIL_TO || "Talhahally974@gmail.com";

  if (!key) {
    return NextResponse.json({ ok: false, error: "missing_RESEND_API_KEY" }, { status: 500 });
  }

  const resend = new Resend(key);

  try {
    const resp = await resend.emails.send({
      from,
      to,
      subject: "MF Test Resend ✅",
      html: "<div>Test Resend OK</div>",
    });

    // IMPORTANT: on renvoie tout (id ou error)
    return NextResponse.json({ ok: true, from, to, resp }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, from, to, error: e?.message || String(e), raw: e },
      { status: 500 }
    );
  }
}
