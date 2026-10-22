import express, { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';
import { isValidSignature } from './signature.js';
import { handlePaymentEvent } from './payments.service.js';

export const paymentsRouter = Router();

const webhookBody = z.object({
  eventId: z.string().min(1).max(200),
  orderId: z.uuid(),
  amountPaise: z.number().int(),
  status: z.string().min(1),
});

// express.raw keeps the body as the exact bytes the provider signed. Parsing to JSON and
// re-serialising would change spacing/key order and break the HMAC check.
paymentsRouter.post('/payments/webhook', express.raw({ type: '*/*', limit: '64kb' }), async (req, res) => {
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  if (!isValidSignature(raw, req.header('x-signature'), config.webhookSecret)) {
    throw new AppError(401, 'invalid_signature', 'Signature does not match');
  }

  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new AppError(400, 'invalid_json', 'Body is not valid JSON');
  }

  const event = webhookBody.parse(json);
  const result = await handlePaymentEvent(event);
  res.json(result);
});
