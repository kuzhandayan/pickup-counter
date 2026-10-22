import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler } from './errors.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { productsRouter } from './modules/products/products.routes.js';

// The built customer screen (copied here by the Dockerfile).
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();

  // The webhook router reads the raw body itself, so it is mounted before express.json().
  app.use(paymentsRouter);

  app.use(express.json({ limit: '32kb' }));
  app.use(productsRouter);
  app.use(ordersRouter);
  app.use(express.static(publicDir));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
  });
  app.use(errorHandler);
  return app;
}
