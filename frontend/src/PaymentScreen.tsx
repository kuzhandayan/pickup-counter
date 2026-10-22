import { useEffect, useState } from 'react';
import { api, formatRupees, type Order } from './api';
import { formatClock, useCountdown } from './useCountdown';

interface Props {
  initialOrder: Order;
  requestSentAt: number;
  onDone: () => void;
}

const POLL_MS = 2000;
const FINAL = new Set(['paid', 'expired', 'needs_review', 'picked_up']);

export function PaymentScreen({ initialOrder, requestSentAt, onDone }: Props) {
  const [order, setOrder] = useState(initialOrder);
  const { secondsLeft, sync } = useCountdown();

  useEffect(() => {
    sync(initialOrder.expiresInSeconds, requestSentAt);
  }, [initialOrder, requestSentAt, sync]);

  // Poll until the server says the order is settled. Each poll also re-syncs the countdown.
  // A failed poll is ignored; the next one tries again.
  useEffect(() => {
    if (FINAL.has(order.status)) return;
    const timer = setInterval(async () => {
      const sentAt = performance.now();
      const next = await api.order(order.id).catch(() => null);
      if (!next) return;
      if (next.status === 'pending') sync(next.expiresInSeconds, sentAt);
      setOrder(next);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [order.id, order.status, sync]);

  if (order.status === 'pending') {
    return (
      <div className="card">
        <h2>Pay {formatRupees(order.totalPaise)} by UPI</h2>
        <div className="qr">UPI QR</div>
        {secondsLeft !== null && secondsLeft > 0 ? (
          <p className="countdown">
            Time left: <strong>{formatClock(secondsLeft)}</strong>
          </p>
        ) : (
          // The server decides when the hold is over; we just wait for it to say so.
          <p className="countdown">Checking payment status…</p>
        )}
        <OrderSummary order={order} />
        <DevHint orderId={order.id} />
      </div>
    );
  }

  const messages: Record<string, { title: string; body: string; tone: string }> = {
    paid: { title: 'Payment received', body: 'Please collect your order from the locker.', tone: 'ok' },
    picked_up: { title: 'Order collected', body: 'Enjoy your snacks!', tone: 'ok' },
    expired: {
      title: 'Time is up',
      body: 'We did not receive the payment in time, so the items were released. If money was taken from your account, show this order ID to the staff.',
      tone: 'warn',
    },
    needs_review: {
      title: 'Payment needs a check',
      body: 'We received a payment but could not confirm it automatically. Please show this order ID to the staff.',
      tone: 'warn',
    },
  };
  const m = messages[order.status];

  return (
    <div className={`card ${m.tone}`}>
      <h2>{m.title}</h2>
      <p>{m.body}</p>
      <p className="muted">Order ID: {order.id}</p>
      <OrderSummary order={order} />
      <button className="primary" onClick={onDone}>
        Start a new order
      </button>
    </div>
  );
}

function OrderSummary({ order }: { order: Order }) {
  return (
    <ul className="summary">
      {order.items.map((i) => (
        <li key={i.productId}>
          {i.quantity} × {i.name} <span>{formatRupees(i.quantity * i.unitPricePaise)}</span>
        </li>
      ))}
    </ul>
  );
}

/** There is no real payment provider, so tell the tester how to fake one. */
function DevHint({ orderId }: { orderId: string }) {
  const command = `docker compose exec app npm run send-webhook -- ${orderId}`;
  return (
    <details className="dev">
      <summary>Testing: simulate the payment</summary>
      <p>Run this in the project folder:</p>
      <code>{command}</code>
      <button onClick={() => navigator.clipboard?.writeText(command)}>Copy</button>
    </details>
  );
}
