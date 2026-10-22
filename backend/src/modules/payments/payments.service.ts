import { withTransaction, type Db } from '../../db.js';
import { AppError } from '../../errors.js';
import { lockProducts } from '../stock.js';
import type { OrderStatus } from '../orders/orders.service.js';

export interface PaymentEvent {
  eventId: string;
  orderId: string;
  amountPaise: number;
  status: string;
}

export type PaymentOutcome =
  | 'paid'
  | 'paid_after_expiry'
  | 'needs_review_amount_mismatch'
  | 'needs_review_late_no_stock'
  | 'ignored_not_captured'
  | 'ignored_already_paid'
  | 'ignored_order_in_review';

export interface WebhookResult {
  duplicate: boolean;
  outcome: PaymentOutcome;
}

interface LockedOrder {
  id: string;
  status: OrderStatus;
  total_paise: number;
}

export async function handlePaymentEvent(event: PaymentEvent): Promise<WebhookResult> {
  return withTransaction(async (db) => {
    // Lock the order row first. Every event for the same order now runs one at a time.
    const { rows } = await db.query<LockedOrder>(
      'SELECT id, status, total_paise FROM orders WHERE id = $1 FOR UPDATE',
      [event.orderId],
    );
    if (!rows.length) throw new AppError(404, 'order_not_found', 'Order not found');
    const order = rows[0];

    // Record the event. event_id is the primary key, so a repeat of the same event inserts
    // nothing and we return what happened the first time. Because the insert and the order
    // update commit together, an event is never half-processed.
    const inserted = await db.query(
      `INSERT INTO payment_events (event_id, order_id, amount_paise, status, outcome)
       VALUES ($1, $2, $3, $4, 'processing')
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.orderId, event.amountPaise, event.status],
    );
    if (!inserted.rowCount) {
      const prev = await db.query<{ outcome: PaymentOutcome }>(
        'SELECT outcome FROM payment_events WHERE event_id = $1',
        [event.eventId],
      );
      return { duplicate: true, outcome: prev.rows[0].outcome };
    }

    const outcome = await applyEvent(db, order, event);
    await db.query('UPDATE payment_events SET outcome = $2 WHERE event_id = $1', [event.eventId, outcome]);
    return { duplicate: false, outcome };
  });
}

async function applyEvent(db: Db, order: LockedOrder, event: PaymentEvent): Promise<PaymentOutcome> {
  if (event.status !== 'captured') return 'ignored_not_captured';
  if (order.status === 'paid' || order.status === 'picked_up') return 'ignored_already_paid';
  if (order.status === 'needs_review') return 'ignored_order_in_review';

  if (event.amountPaise !== order.total_paise) {
    await markNeedsReview(db, order.id, 'amount_mismatch');
    return 'needs_review_amount_mismatch';
  }

  // From here the order is pending or expired and the amount is right.
  // Lock its products before deciding whether we are inside the hold. Order creation takes
  // the same locks, so "is the hold still valid?" and "can someone else take these units?"
  // are never answered at the same time with different clocks.
  const items = await orderItems(db, order.id);
  await lockProducts(db, items.map((i) => i.productId));

  const { rows } = await db.query<{ within_hold: boolean }>(
    'SELECT clock_timestamp() < expires_at AS within_hold FROM orders WHERE id = $1',
    [order.id],
  );

  if (order.status === 'pending' && rows[0].within_hold) {
    await markPaid(db, order.id);
    return 'paid';
  }

  // Late payment: the hold ran out before the money arrived. Make sure the order no longer
  // counts as a reservation, then see whether its units are still free.
  await db.query(`UPDATE orders SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [order.id]);
  // We already hold these locks; calling again just re-reads availability now that this
  // order is no longer counted as a hold.
  const products = await lockProducts(db, items.map((i) => i.productId));
  const stillAvailable = items.every((i) => (products.get(i.productId)?.available ?? 0) >= i.quantity);

  if (stillAvailable) {
    await markPaid(db, order.id);
    return 'paid_after_expiry';
  }
  await markNeedsReview(db, order.id, 'late_payment_no_stock');
  return 'needs_review_late_no_stock';
}

async function orderItems(db: Db, orderId: string) {
  const { rows } = await db.query<{ productId: number; quantity: number }>(
    'SELECT product_id AS "productId", quantity FROM order_items WHERE order_id = $1',
    [orderId],
  );
  return rows;
}

async function markPaid(db: Db, orderId: string) {
  await db.query(`UPDATE orders SET status = 'paid', paid_at = now(), review_reason = NULL WHERE id = $1`, [orderId]);
}

async function markNeedsReview(db: Db, orderId: string, reason: string) {
  await db.query(`UPDATE orders SET status = 'needs_review', review_reason = $2 WHERE id = $1`, [orderId, reason]);
}
