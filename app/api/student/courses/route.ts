// app/api/student/courses/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const email = searchParams.get('email');
    const customerId = searchParams.get('shopifyCustomerId');

    // On exige au moins email ou customerId
    if (!email && !customerId) {
      return NextResponse.json(
        { ok: false, error: 'email_or_customerId_required' },
        { status: 400 }
      );
    }

    // ✅ Récupération DB
    const studentCourses: any[] = await (prisma as any).studentCourse.findMany({
      where: {
        OR: [
          email ? { studentEmail: email } : undefined,
          customerId ? { shopifyCustomerId: customerId } : undefined,
        ].filter(Boolean),
        archived: false,
      },
      include: {
        course: true,
      },
      orderBy: {
        purchaseDate: 'desc',
      },
    });

    // Helper: gid://shopify/Product/123 -> 123
    const gidToNumericProductId = (gid?: string | null) => {
      if (!gid) return null;
      const m = String(gid).match(/\/Product\/(\d+)$/);
      return m ? Number(m[1]) : null;
    };

    const items = studentCourses.map((sc: any) => {
      // 👉 IMPORTANT : il faut que ton modèle Prisma Course contienne
      // soit shopifyProductId (numérique / string),
      // soit shopifyProductGid (gid://shopify/Product/123).
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
        id: sc.course.id,          // id interne prisma (on garde)
        product_id: product_id,    // ✅ id Shopify (numérique) pour /apps/mf/download

        title: sc.course.title,
        subtitle: sc.course.subtitle ?? '',
        category_label: sc.course.categoryLabel ?? '',
        level_label: sc.course.levelLabel ?? '',
        estimated_hours: sc.course.estimatedHours ?? 0,

        // enum Prisma -> string front : "not_started" | "in_progress" | "completed"
        status: String(sc.status ?? 'IN_PROGRESS').toLowerCase(),

        image_url: sc.course.imageUrl ?? null,
        purchase_date: sc.purchaseDate,
        last_access_at: sc.lastAccessAt,

        // tu peux garder access_url si tu veux, mais le bouton n’utilise plus ça
        access_url: sc.course.accessUrl ?? null,

        cta_label: 'Télécharger ma formation',
      };
    });

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (err) {
    console.error('student/courses error:', err);
    return NextResponse.json(
      { ok: false, error: 'server_error' },
      { status: 500 }
    );
  }
}
