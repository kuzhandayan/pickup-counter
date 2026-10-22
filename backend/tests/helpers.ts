import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { signBody } from '../src/modules/payments/signature.js';

export const SECRET = 'test-secret';

/** Starts the real Express app on a random port, backed by the real test database. */
export async function startServer() {
  await migrate();
  const server: Server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Empties every table and inserts the given products. Returns their ids in order. */
export async function resetDb(products: { name: string; pricePaise: number; stock: number }[]) {
  await pool.query('TRUNCATE payment_events, order_items, orders, products RESTART IDENTITY CASCADE');
  const ids: number[] = [];
  for (const p of products) {
    const { rows } = await pool.query<{ id: number }>(
      'INSERT INTO products (name, price_paise, stock) VALUES ($1, $2, $3) RETURNING id',
      [p.name, p.pricePaise, p.stock],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

export function client(baseUrl: string) {
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  return {
    products: () => call('GET', '/products'),
    order: (id: string) => call('GET', `/orders/${id}`),
    createOrder: (items: { productId: number; quantity: number }[]) => call('POST', '/orders', { items }),
    pickup: (id: string) => call('POST', `/orders/${id}/pickup-claim`),
    webhook: (event: { eventId: string; orderId: string; amountPaise: number; status?: string }, secret = SECRET) => {
      const raw = JSON.stringify({ status: 'captured', ...event });
      return call('POST', '/payments/webhook', raw, { 'X-Signature': signBody(raw, secret) });
    },
  };
}

/** Moves an order's hold into the past, as if 120 seconds had gone by. */
export async function expireHold(orderId: string) {
  await pool.query(`UPDATE orders SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [orderId]);
}

export async function availableUnits(baseUrl: string, productId: number): Promise<number> {
  const { body } = await client(baseUrl).products();
  return body.find((p: { id: number }) => p.id === productId).availableUnits;
}

export { pool };
