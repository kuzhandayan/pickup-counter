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

describe('pickup claim', () => {
  let chips: number;

  beforeEach(async () => {
    [chips] = await resetDb([{ name: 'Chips', pricePaise: 2000, stock: 5 }]);
  });

  async function paidOrder(quantity: number) {
    const { body: order } = await api.createOrder([{ productId: chips, quantity }]);
    const paid = await api.webhook({ eventId: `evt_${order.id}`, orderId: order.id, amountPaise: order.totalPaise });
    expect(paid.body.outcome).toBe('paid');
    return order as { id: string };
  }

  async function stock() {
    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [chips]);
    return rows[0].stock as number;
  }

  it('two lockers claiming the same order at once: exactly one succeeds', async () => {
    const order = await paidOrder(2);

    const [a, b] = await Promise.all([api.pickup(order.id), api.pickup(order.id)]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('already_picked_up');
    expect((await api.order(order.id)).body.status).toBe('picked_up');

    // Stock went down once, permanently.
    expect(await stock()).toBe(3);
    expect(await availableUnits(server.baseUrl, chips)).toBe(3);
  });

  it('ten simultaneous claims still give exactly one success', async () => {
    const order = await paidOrder(1);
    const results = await Promise.all(Array.from({ length: 10 }, () => api.pickup(order.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await stock()).toBe(4);
  });

  it('an unpaid order cannot be claimed', async () => {
    const { body: order } = await api.createOrder([{ productId: chips, quantity: 1 }]);
    const res = await api.pickup(order.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('order_not_paid');
    expect(await stock()).toBe(5);
  });

  it('an expired order cannot be claimed', async () => {
    const { body: order } = await api.createOrder([{ productId: chips, quantity: 1 }]);
    await expireHold(order.id);
    const res = await api.pickup(order.id);
    expect(res.status).toBe(409);
    expect(await stock()).toBe(5);
  });

  it('claims for different paid orders of the same product all succeed and stock stays right', async () => {
    const orders = [await paidOrder(1), await paidOrder(2), await paidOrder(2)];
    expect(await availableUnits(server.baseUrl, chips)).toBe(0);

    const results = await Promise.all(orders.map((o) => api.pickup(o.id)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await stock()).toBe(0);
    expect(await availableUnits(server.baseUrl, chips)).toBe(0);
  });

  it('returns 404 for an unknown order', async () => {
    expect((await api.pickup('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});
