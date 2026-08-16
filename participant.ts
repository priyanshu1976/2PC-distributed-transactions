// A 2PC participant. One shard per instance, picked by ROLE env (products | inventory | orders).
import pg from "pg";
import express from "express";

const ROLE = process.env.ROLE!;

// The single piece of work each shard does inside the transaction.
const WORK: Record<string, (o: any) => [string, any[]]> = {
  products:  (o) => ["SELECT id FROM products WHERE id = $1 FOR UPDATE", [o.product_id]],
  inventory: (o) => ["UPDATE inventory SET qty = qty - $2 WHERE product_id = $1 AND qty >= $2", [o.product_id, o.qty]],
  orders:    (o) => ["INSERT INTO orders (id, product_id, qty) VALUES ($1, $2, $3)", [o.txid, o.product_id, o.qty]],
};

const db = new pg.Pool({ host: `${ROLE}-db`, user: "postgres", password: "postgres" });
const log = (msg: string) => console.log(`[${ROLE}] ${msg}`);

// Phase 1: do the work, then PREPARE TRANSACTION so Postgres persists it and promises it can commit.
async function prepare(order: any) {
  const { txid } = order;
  const conn = await db.connect();
  try {
    await conn.query("BEGIN");
    const { rowCount } = await conn.query(...WORK[ROLE](order));
    if (!rowCount) throw new Error("no rows affected"); // product missing / not enough stock
    await conn.query(`PREPARE TRANSACTION '${txid}'`);
    log(`PREPARED ${txid}`);
    return { vote: "yes" };
  } catch (e: any) {
    await conn.query("ROLLBACK");
    log(`VOTE NO ${txid}: ${e.message}`);
    return { vote: "no", reason: e.message };
  } finally {
    conn.release();
  }
}

// Phase 2: COMMIT PREPARED (all voted yes) or ROLLBACK PREPARED (someone voted no).
async function finish(stmt: "COMMIT PREPARED" | "ROLLBACK PREPARED", txid: string) {
  const { rowCount } = await db.query("SELECT 1 FROM pg_prepared_xacts WHERE gid = $1", [txid]);
  if (rowCount) {
    await db.query(`${stmt} '${txid}'`);
    log(`${stmt} ${txid}`);
  }
  return { ok: true };
}

const app = express().use(express.json());
app.post("/prepare", async (req, res) => res.json(await prepare(req.body)));
app.post("/commit", async (req, res) => res.json(await finish("COMMIT PREPARED", req.body.txid)));
app.post("/rollback", async (req, res) => res.json(await finish("ROLLBACK PREPARED", req.body.txid)));
app.listen(8000);
