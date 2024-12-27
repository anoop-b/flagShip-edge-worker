import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { flagshipTable, performanceTable } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { requestId } from "hono/request-id";
import * as configcat from "configcat-js-ssr";

type Bindings = {
  DB: D1Database;
  LD_KV: KVNamespace;
  WORKER_SERVICE: Service;
  LD_URL: string;
  LD_KEY: string;
  CC_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(requestId());

app.get("/ping", async (c) => {
  const startTime = performance.now();
  const endTime = performance.now();
  const latency = endTime - startTime;

  return c.json({
    latency: latency,
    source: "PING",
  });
});

app.get("/configcat", async (c) => {
  const { latency, flagValue } = await fetchCC(c.env.CC_KEY);
  const name = c.req.query("name") || "cc";

  c.executionCtx.waitUntil(SendToDB(c.env.DB, latency, name));

  return c.json({
    latency: latency,
    source: "config cat SDK",
    flags: flagValue,
  });
});

app.get("/ldflag", async (c) => {
  const { latency, ldJson } = await fetchLD(c.env.LD_URL, c.env.LD_KEY);
  const name = c.req.query("name") || "ld";

  c.executionCtx.waitUntil(SendToDB(c.env.DB, latency, name));

  return c.json({
    latency: latency,
    source: "launch darkly API",
    flags: ldJson,
  });
});

app.get("/kv", async (c) => {
  const startTime = performance.now();
  const kv = await c.env.LD_KV.get("ld", "json");
  const endTime = performance.now();
  const latency = endTime - startTime;
  const name = c.req.query("name") || "kv";

  c.executionCtx.waitUntil(SendToDB(c.env.DB, latency, name));

  return c.json({
    latency: latency,
    source: "cloudflare kv",
    flags: kv,
  });
});

app.get("/db", async (c) => {
  const startTime = performance.now();
  const db = drizzle(c.env.DB);
  const flags = await db
    .select()
    .from(flagshipTable)
    .where(eq(flagshipTable.id, 1));
  const endTime = performance.now();
  const latency = endTime - startTime;
  const name = c.req.query("name") || "d1";

  c.executionCtx.waitUntil(SendToDB(c.env.DB, latency, name));
  return c.json({
    latency: latency,
    source: "cloudflare d1",
    flags: flags,
  });
});

app.get("/restapi-same-zone", async (c) => {
  const startTime = performance.now();
  const resp = await c.env.WORKER_SERVICE.fetch(c.req.raw);
  const endTime = performance.now();
  const latency = endTime - startTime;

  const worker_flags = await resp.json();
  console.log(worker_flags);

  return c.json({
    latency: latency,
    source: "cloudflare Worker Rest API same zone",
    flags: worker_flags,
  });
});

app.get("/restapi", async (c) => {
  const startTime = performance.now();
  const resp = await fetch(`https://internetfreedom.in/api/healthz`);
  const endTime = performance.now();
  const latency = endTime - startTime;

  const worker_flags = await resp.json();
  console.log(worker_flags);

  return c.json({
    latency: latency,
    source: "cloudflare Worker Rest API",
    flags: worker_flags,
  });
});

app.get("/rpc", async (c) => {
  const startTime = performance.now();
  const flags = await c.env.WORKER_SERVICE.getFlags();
  const endTime = performance.now();
  const latency = endTime - startTime;

  return c.json({
    latency: latency,
    source: "cloudflare Worker RPC",
    flags: flags,
  });
});

export default app;

async function fetchCC(KEY: string) {
  const startTime = performance.now();
  const configCatClient = configcat.getClient(KEY,
    configcat.PollingMode.LazyLoad,
  );
  const flagValue = await configCatClient.getValueAsync("iswinter", true);

  const endTime = performance.now();
  const latency = endTime - startTime;
  console.log("iswinter: " + flagValue);

  return { latency, flagValue }
}

async function fetchLD(URL: string, KEY: string) {
  const startTime = performance.now();
  const ldResponse = await fetch(URL, {
    headers: {
      Authorization: KEY,
    },
  });

  const endTime = performance.now();
  const latency = endTime - startTime;

  const ldJson = await ldResponse.json();
  return { latency, ldJson };
}

async function SendToDB(d1: D1Database, latency: number, name: string) {
  const db = drizzle(d1);
  await db
    .insert(performanceTable)
    .values({
      name: name,
      value: latency,
    })
    .execute();
}
