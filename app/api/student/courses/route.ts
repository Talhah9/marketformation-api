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

    // 👇 cast en any pour calmer TS sur "studentCourse"
    const studentCourses = await (prisma as any).studentCourse.findMany({
      where: {
        OR: [
          email ? { studentEmail: email } : {},
          customerId ? { shopifyCustomerId: customerId } : {},
        ],
        archived: false,
      },
      include: {
        course: true,
      },
      orderBy: {
        purchaseDate: 'desc',
      },
    });

    type StudentCourseWithCourse = (typeof studentCourses)[number];

    const items = studentCourses.map((sc: StudentCourseWithCourse) => ({
      id: sc.course.id,
      title: sc.course.title,
      subtitle: sc.course.subtitle ?? '',
      category_label: sc.course.categoryLabel ?? '',
      level_label: sc.course.levelLabel ?? '',
      estimated_hours: sc.course.estimatedHours ?? 0,

      // 👇 on transforme juste en string, pas besoin de l’enum TS
      status: String(sc.status ?? 'IN_PROGRESS').toLowerCase(),

      image_url: sc.course.imageUrl ?? null,
      purchase_date: sc.purchaseDate,
      last_access_at: sc.lastAccessAt,
      access_url: sc.course.accessUrl,
      cta_label: 'Accéder à la formation',
    }));

    return NextResponse.json(
      { ok: true, items },
      { status: 200 }
    );
  } catch (err) {
    console.error('student/courses error:', err);
    return NextResponse.json(
      { ok: false, error: 'server_error' },
      { status: 500 }
    );
  }
}
