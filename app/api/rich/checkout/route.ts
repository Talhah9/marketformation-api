import Stripe from "stripe";
import { list as blobList, put } from "@vercel/blob";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

const KEY = "rich/hall.json";
const ALLOW_ORIGINS = new Set(["https://iamrich.fr", "https://www.iamrich.fr"]);

type HallItem = {
  name: string;
  createdAt: number;
  sessionId: string;
};

async function readHall(): Promise<HallItem[]> {
  const found = await blobList({ prefix: KEY, limit: 1 });
  const item = found.blobs?.[0];
  if (!item?.url) return [];
  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? (data as HallItem[]) : [];
}

async function writeHall(items: HallItem[]) {
  await put(KEY, JSON.stringify(items), {
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

  // IMPORTANT: body raw pour vérifier la signature Stripe
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, whsec);
  } catch (err) {
    console.error("WEBHOOK SIGNATURE ERROR:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const paid = session.payment_status === "paid";
    const name = (session.metadata?.name || "").trim().slice(0, 24);
    const type = session.metadata?.type || "";
    const sessionId = session.id;

    if (paid && type === "rich_proof" && name) {
      const hall = await readHall();
      const exists = hall.some((x) => x.sessionId === sessionId);

      if (!exists) {
        const next: HallItem[] = [{ name, createdAt: Date.now(), sessionId }, ...hall].slice(0, 500);
        await writeHall(next);
      }
    }
  }

  return new Response("ok", { status: 200 });
}
