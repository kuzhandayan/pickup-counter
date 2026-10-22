import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors.js';
import { claimPickup, createOrder, getOrder } from './orders.service.js';

export const ordersRouter = Router();

const createOrderBody = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive().max(100),
      }),
    )
    .min(1)
    .max(50),
});

const orderId = z.uuid();

function parseOrderId(raw: string): string {
  const parsed = orderId.safeParse(raw);
  if (!parsed.success) throw new AppError(404, 'order_not_found', 'Order not found');
  return parsed.data;
}

ordersRouter.post('/orders', async (req, res) => {
  const body = createOrderBody.parse(req.body);
  const order = await createOrder(body.items);
  res.status(201).json(order);
});

ordersRouter.get('/orders/:id', async (req, res) => {
  const order = await getOrder(parseOrderId(req.params.id));
  if (!order) throw new AppError(404, 'order_not_found', 'Order not found');
  res.json(order);
});

ordersRouter.post('/orders/:id/pickup-claim', async (req, res) => {
  const order = await claimPickup(parseOrderId(req.params.id));
  res.json(order);
});
