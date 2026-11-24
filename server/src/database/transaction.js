import { pool } from "./db.js";

const activeTransactions = new WeakSet();

export function isActiveTransaction(client) {
  return Boolean(client && activeTransactions.has(client));
}

export async function withTransaction(operation) {
  if (typeof operation !== "function") throw new TypeError("withTransaction requires an operation callback.");
  const client = await pool.connect();
  let started = false;
  let released = false;
  const release = (error) => {
    if (released) return;
    released = true;
    client.release(error);
  };

  try {
    await client.query("BEGIN");
    started = true;
    activeTransactions.add(client);
    const result = await operation(client);
    await client.query("COMMIT");
    started = false;
    return result;
  } catch (error) {
    if (started) {
      try {
        await client.query("ROLLBACK");
        started = false;
      } catch (rollbackError) {
        release(rollbackError);
      }
    } else {
      // BEGIN failed; do not return a potentially broken connection to the pool.
      release(error);
    }
    throw error;
  } finally {
    activeTransactions.delete(client);
    release();
  }
}
