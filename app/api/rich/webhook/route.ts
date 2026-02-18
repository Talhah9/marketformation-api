import Stripe from "stripe";
import { list, put } from "@vercel/blob";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

const KEY = "rich/hall.json";

type Entry = {
  name: string;
  createdAt: number;
  sessionId: string;
  rank: number; // ✅ numéro définitif
};

type RawEntry = Partial<Entry> & { name?: string; createdAt?: number; sessionId?: string };

async function readHall(): Promise<Entry[]> {
  const found = await list({ prefix: KEY, limit: 1 });
  const item = found.blobs?.[0];
  if (!item?.url) return [];

  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return [];

  const data = (await res.json().catch(() => [])) as unknown;
  if (!Array.isArray(data)) return [];

  // Nettoyage + fallback
  const cleaned: RawEntry[] = data;

  // ✅ Migration auto si rank absent
  const needsRank = cleaned.some((x) => typeof x.rank !== "number");

  const withRank: Entry[] = cleaned
    .map((x, idx, arr) => {
      const name = String(x.name ?? "").slice(0, 24);
      const sessionId = String(x.sessionId ?? "");
      const createdAt = Number(x.createdAt ?? Date.now());

      if (!name || !sessionId) return null;

      const rank =
        typeof x.rank === "number" && Number.isFinite(x.rank)
          ? x.rank
          : (arr.length - idx); // ✅ important: nouveau en haut => rank inverse

      return { name, sessionId, createdAt, rank };
    })
    .filter(Boolean) as Entry[];

  // Si migration: on réécrit une fois pour figer les ranks
  if (needsRank && withRank.length) {
    await writeHall(withRank);
  }

  return withRank;
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

  if (!sig || !whsec) return new Response("Missing webhook config", { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, whsec);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const paid = session.payment_status === "paid";
    const name = (session.metadata?.name || "").trim().slice(0, 24);
    const type = session.metadata?.type;

    if (paid && type === "rich_proof" && name) {
      const sessionId = session.id;

      const hall = await readHall();

      // anti-doublon
      if (!hall.some((x) => x.sessionId === sessionId)) {
        const maxRank = hall.reduce((m, x) => (x.rank > m ? x.rank : m), 0);
        const rank = maxRank + 1;

        const next: Entry[] = [
          { name, createdAt: Date.now(), sessionId, rank },
          ...hall,
        ].slice(0, 500);

        await writeHall(next);
      }
    }
  }

  return new Response("ok", { status: 200 });
}
