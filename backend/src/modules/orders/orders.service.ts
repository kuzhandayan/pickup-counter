import { pool, withTransaction } from '../../db.js';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';
import { lockProducts } from '../stock.js';

export type OrderStatus = 'pending' | 'paid' | 'expired' | 'needs_review' | 'picked_up';

export interface OrderView {
  id: string;
  status: OrderStatus;
  totalPaise: number;
  expiresInSeconds: number;
  expiresAt: string;
  reviewReason: string | null;
  items: { productId: number; name: string; quantity: number; unitPricePaise: number }[];
}

export async function createOrder(lines: { productId: number; quantity: number }[]): Promise<OrderView> {
  // The same product listed twice counts as one line.
  const wanted = new Map<number, number>();
  for (const l of lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);

  const orderId = await withTransaction(async (db) => {
    const products = await lockProducts(db, [...wanted.keys()]);

    const unknown = [...wanted.keys()].filter((id) => !products.has(id));
    if (unknown.length) {
      throw new AppError(404, 'unknown_product', 'Some products do not exist', { productIds: unknown });
    }

    const shortages = [...wanted].flatMap(([productId, quantity]) => {
      const available = products.get(productId)!.available;
      return quantity > available ? [{ productId, requested: quantity, available }] : [];
    });
    if (shortages.length) {
      // Throwing rolls back the transaction, so nothing is held.
      throw new AppError(409, 'insufficient_stock', 'Not enough stock for some items', { shortages });
    }

    const total = [...wanted].reduce((sum, [id, qty]) => sum + products.get(id)!.pricePaise * qty, 0);

    // clock_timestamp() is the real time now (now() would be the transaction start,
    // which can be earlier if we waited for the lock).
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO orders (total_paise, expires_at)
       VALUES ($1, clock_timestamp() + make_interval(secs => $2))
       RETURNING id`,
      [total, config.holdSeconds],
    );
    const id = rows[0].id;

    for (const [productId, quantity] of wanted) {
      await db.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, $3, $4)',
        [id, productId, quantity, products.get(productId)!.pricePaise],
      );
    }
    return id;
  });

  return (await getOrder(orderId))!;
}

/**
 * Returns the order as the customer screen should see it. A pending order whose hold has
 * run out is flipped to expired here as well as by the background sweep.
 * expiresInSeconds is measured on the database clock at the moment of the read.
 */
export async function getOrder(id: string): Promise<OrderView | null> {
  await pool.query(
    `UPDATE orders SET status = 'expired'
      WHERE id = $1 AND status = 'pending' AND expires_at <= clock_timestamp()`,
    [id],
  );

  const { rows } = await pool.query(
    `SELECT id, status, total_paise AS "totalPaise", expires_at AS "expiresAt", review_reason AS "reviewReason",
            CASE WHEN status = 'pending'
                 THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM expires_at - clock_timestamp())))::int
                 ELSE 0 END AS "expiresInSeconds"
       FROM orders WHERE id = $1`,
    [id],
  );
  if (!rows.length) return null;

  const items = await pool.query(
    `SELECT oi.product_id AS "productId", p.name, oi.quantity, oi.unit_price_paise AS "unitPricePaise"
       FROM order_items oi JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1 ORDER BY oi.product_id`,
    [id],
  );
  return { ...rows[0], items: items.rows };
}

export async function claimPickup(id: string): Promise<OrderView> {
  await withTransaction(async (db) => {
    // Only one transaction can move the row from paid to picked_up. A second, concurrent
    // claim waits on the row lock, re-checks status = 'paid' after the first commits,
    // finds 'picked_up' and updates nothing.
    const claimed = await db.query(
      `UPDATE orders SET status = 'picked_up', picked_up_at = now()
        WHERE id = $1 AND status = 'paid' RETURNING id`,
      [id],
    );

    if (!claimed.rowCount) {
      const { rows } = await db.query<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = $1', [id]);
      if (!rows.length) throw new AppError(404, 'order_not_found', 'Order not found');
      if (rows[0].status === 'picked_up') {
        throw new AppError(409, 'already_picked_up', 'This order has already been collected');
      }
      throw new AppError(409, 'order_not_paid', `Order cannot be collected while it is ${rows[0].status}`);
    }

    // Lock the products in id order (same as order creation) before updating them,
    // so a pickup and a new order can never deadlock on each other.
    const items = await db.query<{ product_id: number }>('SELECT product_id FROM order_items WHERE order_id = $1', [id]);
    await lockProducts(db, items.rows.map((r) => r.product_id));

    // Stock drops permanently here. The paid order stops counting as reserved in the same
    // transaction, so available units do not change. CHECK (stock >= 0) is the last guard.
    await db.query(
      `UPDATE products p SET stock = p.stock - oi.quantity
         FROM order_items oi
        WHERE oi.order_id = $1 AND p.id = oi.product_id`,
      [id],
    );
  });

  return (await getOrder(id))!;
}

/** Marks every pending order whose hold has run out as expired. Returns how many. */
export async function expireStaleHolds(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE orders SET status = 'expired' WHERE status = 'pending' AND expires_at <= clock_timestamp()`,
  );
  return rowCount ?? 0;
}
