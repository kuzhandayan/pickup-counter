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

describe('placing orders', () => {
  let chips: number;
  let juice: number;

  beforeEach(async () => {
    [chips, juice] = await resetDb([
      { name: 'Chips', pricePaise: 2000, stock: 10 },
      { name: 'Juice', pricePaise: 3500, stock: 2 },
    ]);
  });

  it('ten customers ordering the last two units at once: exactly two units are held', async () => {
    // Repeat a few rounds so a lucky interleaving does not hide a race.
    for (let round = 0; round < 5; round++) {
      [chips, juice] = await resetDb([
        { name: 'Chips', pricePaise: 2000, stock: 10 },
        { name: 'Juice', pricePaise: 3500, stock: 2 },
      ]);

      const results = await Promise.all(
        Array.from({ length: 10 }, () => api.createOrder([{ productId: juice, quantity: 1 }])),
      );

      const created = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status !== 201);
      expect(created).toHaveLength(2);
      expect(rejected).toHaveLength(8);
      for (const r of rejected) {
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('insufficient_stock');
      }

      // Check the database directly, not just the responses.
      const held = await pool.query(
        `SELECT COALESCE(SUM(oi.quantity), 0)::int AS units, COUNT(DISTINCT o.id)::int AS orders
           FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE oi.product_id = $1`,
        [juice],
      );
      expect(held.rows[0]).toEqual({ units: 2, orders: 2 });
      expect(await availableUnits(server.baseUrl, juice)).toBe(0);
    }
  });

  it('customers asking for different quantities never over-hold', async () => {
    const results = await Promise.all(
      [2, 1, 2, 1, 1, 2, 1, 2, 1, 1].map((q) => api.createOrder([{ productId: juice, quantity: q }])),
    );
    const heldUnits = results
      .filter((r) => r.status === 201)
      .reduce((sum, r) => sum + r.body.items[0].quantity, 0);
    expect(heldUnits).toBeLessThanOrEqual(2);
    expect(await availableUnits(server.baseUrl, juice)).toBe(2 - heldUnits);
  });

  it('returns the total in paise and the seconds left on the hold', async () => {
    const res = await api.createOrder([
      { productId: chips, quantity: 3 },
      { productId: juice, quantity: 1 },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.totalPaise).toBe(3 * 2000 + 3500);
    expect(res.body.expiresInSeconds).toBeGreaterThanOrEqual(118);
    expect(res.body.expiresInSeconds).toBeLessThanOrEqual(120);
    expect(await availableUnits(server.baseUrl, chips)).toBe(7);
  });

  it('an order that cannot be filled holds nothing at all', async () => {
    const res = await api.createOrder([
      { productId: chips, quantity: 4 },
      { productId: juice, quantity: 3 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.details.shortages).toEqual([{ productId: juice, requested: 3, available: 2 }]);
    expect(await availableUnits(server.baseUrl, chips)).toBe(10);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM orders');
    expect(rows[0].n).toBe(0);
  });

  it('rejects bad input and unknown products', async () => {
    expect((await api.createOrder([])).status).toBe(400);
    expect((await api.createOrder([{ productId: chips, quantity: 0 }])).status).toBe(400);
    expect((await api.createOrder([{ productId: 9999, quantity: 1 }])).status).toBe(404);
  });

  it('when the hold runs out, the units come back and the order shows expired', async () => {
    const { body: order } = await api.createOrder([{ productId: juice, quantity: 2 }]);
    expect(await availableUnits(server.baseUrl, juice)).toBe(0);

    await expireHold(order.id);

    // Units are free straight away, before any background job runs.
    expect(await availableUnits(server.baseUrl, juice)).toBe(2);
    const { body } = await api.order(order.id);
    expect(body.status).toBe('expired');
    expect(body.expiresInSeconds).toBe(0);

    // And someone else can now buy them.
    expect((await api.createOrder([{ productId: juice, quantity: 2 }])).status).toBe(201);
  });
});
