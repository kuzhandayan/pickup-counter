import type { Db } from '../db.js';

export interface LockedProduct {
  id: number;
  pricePaise: number;
  available: number;
}

/**
 * Locks the given product rows and returns how many units of each are free right now.
 *
 * Every code path that can change what is "available" (placing an order, paying late,
 * picking up) goes through this lock, so those changes run one after another per product.
 * Rows are always locked in id order, which keeps two transactions from deadlocking.
 */
export async function lockProducts(db: Db, productIds: number[]): Promise<Map<number, LockedProduct>> {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);

  await db.query('SELECT id FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids]);

  // Read availability in a SEPARATE statement, after the lock is held. In READ COMMITTED each
  // statement takes a fresh snapshot, so this sees reservations committed by whoever held the
  // lock before us. Doing it in the same statement as FOR UPDATE would use the older snapshot.
  const { rows } = await db.query<LockedProduct>(
    `SELECT p.id, p.price_paise AS "pricePaise", p.stock - COALESCE(r.units, 0) AS available
       FROM products p
       LEFT JOIN reserved_units r ON r.product_id = p.id
      WHERE p.id = ANY($1::int[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}
