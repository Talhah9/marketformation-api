// app/api/student/courses/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gidToNumericProductId(gid?: string | null) {
  if (!gid) return null;
  const m = String(gid).match(/\/Product\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const email = searchParams.get("email");
    const customerId = searchParams.get("shopifyCustomerId");

    if (!email && !customerId) {
      return NextResponse.json(
        { ok: false, error: "email_or_customerId_required" },
        { status: 400 }
      );
    }

    const or: any[] = [];
    if (email) or.push({ studentEmail: email });
    if (customerId) or.push({ shopifyCustomerId: customerId });

    const rows: any[] = await (prisma as any).studentCourse.findMany({
      where: {
        OR: or,
        archived: false,
      },
      include: {
        course: true,
      },
      orderBy: {
        purchaseDate: "desc",
      },
    });

    const items = rows.map((sc: any) => {
      const directId =
        sc?.course?.shopifyProductId ??
        sc?.course?.productId ??
        sc?.course?.shopify_product_id ??
        null;

      const gidId = gidToNumericProductId(
        sc?.course?.shopifyProductGid ?? sc?.course?.productGid ?? null
      );

      const product_id = directId != null ? Number(directId) : gidId;

      return {
        id: sc?.course?.id,
        product_id, // ✅ IMPORTANT pour /apps/mf/download

        title: sc?.course?.title || "Formation",
        subtitle: sc?.course?.subtitle ?? "",
        category_label: sc?.course?.categoryLabel ?? "",
        level_label: sc?.course?.levelLabel ?? "",
        estimated_hours: sc?.course?.estimatedHours ?? 0,

        status: String(sc?.status ?? "IN_PROGRESS").toLowerCase(),

        image_url: sc?.course?.imageUrl ?? null,
        purchase_date: sc?.purchaseDate ?? null,
        last_access_at: sc?.lastAccessAt ?? null,

        access_url: sc?.course?.accessUrl ?? null,
        cta_label: "Telecharger ma formation",
      };
    });

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (err: any) {
    console.error("api/student/courses error:", err);
    return NextResponse.json(
      { ok: false, error: "server_error", message: err?.message || String(err) },
      { status: 500 }
    );
  }
}
