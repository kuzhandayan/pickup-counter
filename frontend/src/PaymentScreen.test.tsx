// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from './api';
import { PaymentScreen } from './PaymentScreen';

const order: Order = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'pending',
  totalPaise: 4500,
  expiresInSeconds: 120,
  reviewReason: null,
  items: [{ productId: 1, name: 'Chocolate Bar', quantity: 1, unitPricePaise: 4500 }],
};

// The "server" keeps its own deadline on the monotonic clock, like the real database does.
let serverDeadline = 0;
let serverStatus: Order['status'] = 'pending';

beforeEach(() => {
  // Fake both clocks so we can move them independently.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  serverDeadline = performance.now() + 120_000;
  serverStatus = 'pending';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({
          ...order,
          status: serverStatus,
          expiresInSeconds: Math.max(0, Math.floor((serverDeadline - performance.now()) / 1000)),
        }))),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('payment countdown', () => {
  it('counts down correctly even when the device clock is several minutes wrong', async () => {
    // The kiosk thinks it is 7 minutes later than it really is.
    vi.setSystemTime(Date.now() + 7 * 60 * 1000);

    render(<PaymentScreen initialOrder={order} requestSentAt={performance.now()} onDone={() => {}} />);
    expect(screen.getByText('2:00')).toBeTruthy();

    await advance(30_000);
    expect(screen.getByText('1:30')).toBeTruthy();

    // Someone changes the device clock mid-countdown. Nothing should jump.
    vi.setSystemTime(Date.now() - 20 * 60 * 1000);
    await advance(10_000);
    expect(screen.getByText('1:20')).toBeTruthy();
  });

  it('waits for the server instead of declaring expiry on its own, then shows the result', async () => {
    render(<PaymentScreen initialOrder={order} requestSentAt={performance.now()} onDone={() => {}} />);

    await advance(121_000);
    expect(screen.getByText('Checking payment status…')).toBeTruthy();

    serverStatus = 'expired';
    await advance(2_000);
    expect(screen.getByText('Time is up')).toBeTruthy();
  });

  it('shows the paid message when the poll sees the payment', async () => {
    render(<PaymentScreen initialOrder={order} requestSentAt={performance.now()} onDone={() => {}} />);
    serverStatus = 'paid';
    await advance(2_000);
    expect(screen.getByText('Payment received')).toBeTruthy();
  });
});
