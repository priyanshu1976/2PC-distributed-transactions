// The 2PC coordinator. Drives the two phases across the three shards.
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import express from "express";

const PARTICIPANTS = ["products", "inventory", "orders"];
const PAUSE_MS = Number(process.env.PAUSE_BEFORE_PHASE2_MS ?? 0); // lets you peek at pg_prepared_xacts

async function call(participant: string, action: string, body: any) {
  const res = await fetch(`http://${participant}:8000/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<any>;
}

const app = express().use(express.json());

app.post("/order", async (req, res) => {
  const order = req.body; // { product_id, qty }
  const tx = { txid: randomUUID(), ...order };
  console.log(`\n=== TX ${tx.txid} ${JSON.stringify(order)}`);

  // Phase 1: ask everyone to prepare and vote
  const votes: Record<string, any> = {};
  for (const p of PARTICIPANTS) votes[p] = await call(p, "prepare", tx);
  console.log("phase 1 votes:", votes);
  await sleep(PAUSE_MS);

  // Phase 2: commit if unanimous yes, otherwise rollback everyone
  const decision = Object.values(votes).every((v) => v.vote === "yes") ? "commit" : "rollback";
  for (const p of PARTICIPANTS) await call(p, decision, tx);
  console.log(`phase 2: ${decision.toUpperCase()}`);
  res.json({ txid: tx.txid, decision, votes });
});

app.listen(8000);
