import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const trainerId = searchParams.get("u");

  if (!trainerId) {
    return NextResponse.json(
      { ok: false, error: "trainer_id_required" },
      { status: 400 }
    );
  }

  const redis = getRedis();

  const profileViews30d = Number(
    (await redis.get(`profile:views:30d:${trainerId}`)) || 0
  );

  const salesCount30d = Number(
    (await redis.get(`sales:count:30d:${trainerId}`)) || 0
  );

  const revenueCents = Number(
    (await redis.get(`sales:revenue:30d:${trainerId}`)) || 0
  );

  const revenue30d = Math.round(revenueCents / 100);

  const conversionRate30d =
    profileViews30d > 0
      ? Number(((salesCount30d / profileViews30d) * 100).toFixed(2))
      : 0;

  return NextResponse.json({
    ok: true,
    revenue30d,
    profileViews30d,
    salesCount30d,
    conversionRate30d,
  });
}
