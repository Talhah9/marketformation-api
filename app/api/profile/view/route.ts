import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const trainerId = body?.trainerId;

  if (!trainerId) {
    return NextResponse.json(
      { ok: false, error: "trainer_id_required" },
      { status: 400 }
    );
  }

  const redis = getRedis();

  await redis.incr(`profile:views:30d:${trainerId}`);
  await redis.incr(`profile:views:total:${trainerId}`);

  return NextResponse.json({ ok: true });
}
