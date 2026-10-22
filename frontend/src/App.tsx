import { useState } from 'react';
import type { Order } from './api';
import { Catalog } from './Catalog';
import { PaymentScreen } from './PaymentScreen';

export function App() {
  const [placed, setPlaced] = useState<{ order: Order; sentAt: number } | null>(null);

  return (
    <main>
      {placed ? (
        <PaymentScreen
          key={placed.order.id}
          initialOrder={placed.order}
          requestSentAt={placed.sentAt}
          onDone={() => setPlaced(null)}
        />
      ) : (
        <Catalog onOrderPlaced={(order, sentAt) => setPlaced({ order, sentAt })} />
      )}
    </main>
  );
}
