/**
 * Sends a correctly signed payment webhook, the way the provider would.
 *
 *   npm run send-webhook -- <orderId> [amountPaise] [--event evt_123] [--status captured] [--bad-signature]
 *
 * If amountPaise is left out, the script reads the order total from the API.
 * Re-run with the same --event to see that a repeated event changes nothing.
 */
import { randomUUID } from 'node:crypto';
import { signBody } from '../src/modules/payments/signature.js';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
const secret = process.env.WEBHOOK_SECRET ?? 'dev-secret-change-me';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const badSignature = args.includes('--bad-signature');
const eventId = flag('event') ?? `evt_${randomUUID().slice(0, 8)}`;
const status = flag('status') ?? 'captured';
const [orderId, amountArg] = args.filter((a) => !a.startsWith('--'));

if (!orderId) {
  console.error('usage: npm run send-webhook -- <orderId> [amountPaise] [--event evt_123] [--status captured] [--bad-signature]');
  process.exit(1);
}

async function main() {
  let amountPaise = amountArg !== undefined ? Number(amountArg) : undefined;
  if (amountPaise === undefined) {
    const res = await fetch(`${apiUrl}/orders/${orderId}`);
    if (!res.ok) throw new Error(`could not load order: ${res.status} ${await res.text()}`);
    amountPaise = ((await res.json()) as { totalPaise: number }).totalPaise;
  }

  const body = JSON.stringify({ eventId, orderId, amountPaise, status });
  const signature = badSignature ? 'f'.repeat(64) : signBody(body, secret);

  const res = await fetch(`${apiUrl}/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
    body,
  });
  console.log(`sent ${body}`);
  console.log(`-> ${res.status} ${await res.text()}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
