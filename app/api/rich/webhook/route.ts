import Stripe from "stripe";
import { list, put } from "@vercel/blob";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

const KEY = "rich/hall.json";
type Entry = { name: string; createdAt: number; sessionId: string };

async function readHall(): Promise<Entry[]> {
  const found = await list({ prefix: KEY, limit: 1 });
  const item = found.blobs?.[0];
  if (!item?.url) return [];
  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

async function writeHall(entries: Entry[]) {
  await put(KEY, JSON.stringify(entries), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const whsec = process.env.STRIPE_WEBHOOK_SECRET_RICH;

  if (!sig || !whsec) {
    return new Response("Missing webhook config", { status: 400 });
  }

  const rawBody = await req.text(); // IMPORTANT: raw string for signature check

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, whsec);
  } catch (err: any) {
    return new Response("Invalid signature", { status: 400 });
  }

  // On ne traite que ce qui nous intéresse
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // double safety
    const paid = session.payment_status === "paid";
    const name = (session.metadata?.name || "").trim().slice(0, 24);
    const type = session.metadata?.type;

    if (paid && type === "rich_proof" && name) {
      const sessionId = session.id;

      const hall = await readHall();
      const exists = hall.some((x) => x.sessionId === sessionId);
      if (!exists) {
        const next: Entry[] = [{ name, createdAt: Date.now(), sessionId }, ...hall].slice(0, 500);
        await writeHall(next);
      }
    }
  }

  return new Response("ok", { status: 200 });
}
