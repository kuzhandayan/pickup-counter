import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { availableUnits, client, expireHold, pool, resetDb, startServer } from './helpers.js';

let server: Awaited<ReturnType<typeof startServer>>;
let api: ReturnType<typeof client>;

beforeAll(async () => {
  server = await startServer();
  api = client(server.baseUrl);
});
afterAll(async () => {
  await server.close();
  await pool.end();
});

describe('payment webhook', () => {
  let juice: number;

  beforeEach(async () => {
    [juice] = await resetDb([{ name: 'Juice', pricePaise: 3500, stock: 2 }]);
  });

  async function newOrder(quantity = 1) {
    const res = await api.createOrder([{ productId: juice, quantity }]);
    expect(res.status).toBe(201);
    return res.body as { id: string; totalPaise: number };
  }

  async function eventsFor(orderId: string) {
    const { rows } = await pool.query('SELECT event_id, outcome FROM payment_events WHERE order_id = $1', [orderId]);
    return rows;
  }

  it('the same event sent twice is processed once', async () => {
    const order = await newOrder();
    const event = { eventId: 'evt_dup', orderId: order.id, amountPaise: order.totalPaise };

    const first = await api.webhook(event);
    const second = await api.webhook(event);

    expect(first.body).toEqual({ duplicate: false, outcome: 'paid' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ duplicate: true, outcome: 'paid' });
    expect(await eventsFor(order.id)).toHaveLength(1);

    const { rows } = await pool.query('SELECT status, paid_at FROM orders WHERE id = $1', [order.id]);
    expect(rows[0].status).toBe('paid');
    const paidAt = rows[0].paid_at;

    // A third copy later still changes nothing, not even the timestamp.
    await api.webhook(event);
    const again = await pool.query('SELECT paid_at FROM orders WHERE id = $1', [order.id]);
    expect(again.rows[0].paid_at).toEqual(paidAt);
  });

  it('the same event arriving several times at the same moment is processed once', async () => {
    const order = await newOrder();
    const event = { eventId: 'evt_burst', orderId: order.id, amountPaise: order.totalPaise };

    const results = await Promise.all(Array.from({ length: 5 }, () => api.webhook(event)));

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect(await eventsFor(order.id)).toHaveLength(1);
    expect((await api.order(order.id)).body.status).toBe('paid');
  });

  it('rejects a request whose signature does not match', async () => {
    const order = await newOrder();
    const res = await api.webhook({ eventId: 'evt_x', orderId: order.id, amountPaise: order.totalPaise }, 'wrong-secret');
    expect(res.status).toBe(401);
    expect((await api.order(order.id)).body.status).toBe('pending');
    expect(await eventsFor(order.id)).toHaveLength(0);
  });

  it('a wrong amount marks the order needs_review, not paid', async () => {
    const order = await newOrder();
    const res = await api.webhook({ eventId: 'evt_short', orderId: order.id, amountPaise: order.totalPaise - 100 });
    expect(res.body.outcome).toBe('needs_review_amount_mismatch');

    const { body } = await api.order(order.id);
    expect(body.status).toBe('needs_review');
    expect(body.reviewReason).toBe('amount_mismatch');
    // A correct payment afterwards does not silently flip it to paid; a person looks at it.
    const later = await api.webhook({ eventId: 'evt_full', orderId: order.id, amountPaise: order.totalPaise });
    expect(later.body.outcome).toBe('ignored_order_in_review');
  });

  it('a non-captured status does not change the order', async () => {
    const order = await newOrder();
    const res = await api.webhook({ eventId: 'evt_f', orderId: order.id, amountPaise: order.totalPaise, status: 'failed' });
    expect(res.body.outcome).toBe('ignored_not_captured');
    expect((await api.order(order.id)).body.status).toBe('pending');
  });

  it('late payment is accepted when the units are still free', async () => {
    const order = await newOrder(2);
    await expireHold(order.id);

    const res = await api.webhook({ eventId: 'evt_late', orderId: order.id, amountPaise: order.totalPaise });
    expect(res.body.outcome).toBe('paid_after_expiry');
    expect((await api.order(order.id)).body.status).toBe('paid');
    // The paid order holds its units again until pickup.
    expect(await availableUnits(server.baseUrl, juice)).toBe(0);
  });

  it('late payment goes to needs_review when the units were sold to someone else', async () => {
    const order = await newOrder(2);
    await expireHold(order.id);
    expect((await api.createOrder([{ productId: juice, quantity: 2 }])).status).toBe(201);

    const res = await api.webhook({ eventId: 'evt_late2', orderId: order.id, amountPaise: order.totalPaise });
    expect(res.body.outcome).toBe('needs_review_late_no_stock');

    const { body } = await api.order(order.id);
    expect(body.status).toBe('needs_review');
    expect(body.reviewReason).toBe('late_payment_no_stock');
    expect(await availableUnits(server.baseUrl, juice)).toBe(0);
  });

  it('returns 404 for an unknown order', async () => {
    const res = await api.webhook({ eventId: 'evt_u', orderId: '00000000-0000-4000-8000-000000000000', amountPaise: 100 });
    expect(res.status).toBe(404);
  });
});
