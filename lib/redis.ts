import { createClient } from "redis";

let client: ReturnType<typeof createClient> | null = null;

export function getRedis() {
  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL,
    });

    client.on("error", (err) => {
      console.error("Redis Client Error", err);
    });

    client.connect();
  }

  return client;
}
