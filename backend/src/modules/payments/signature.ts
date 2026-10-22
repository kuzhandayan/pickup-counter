import { createHmac, timingSafeEqual } from 'node:crypto';

export function signBody(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Compares the X-Signature header with the HMAC of the exact bytes we received. */
export function isValidSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !/^[0-9a-f]{64}$/i.test(header)) return false;
  const expected = Buffer.from(signBody(rawBody, secret), 'hex');
  const received = Buffer.from(header, 'hex');
  return timingSafeEqual(expected, received);
}
