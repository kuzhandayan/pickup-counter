import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, formatRupees, type Order, type Product } from './api';

interface Props {
  onOrderPlaced: (order: Order, requestSentAt: number) => void;
}

export function Catalog({ onOrderPlaced }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      setProducts(await api.products());
    } catch {
      setError('Could not load products. Retrying…');
    }
  }, []);

  // Other customers change availability, so refresh it every few seconds.
  useEffect(() => {
    loadProducts();
    const timer = setInterval(loadProducts, 5000);
    return () => clearInterval(timer);
  }, [loadProducts]);

  const change = (product: Product, delta: number) => {
    setError(null);
    setCart((c) => {
      const next = Math.min(product.availableUnits, Math.max(0, (c[product.id] ?? 0) + delta));
      const copy = { ...c, [product.id]: next };
      if (next === 0) delete copy[product.id];
      return copy;
    });
  };

  const lines = Object.entries(cart).map(([id, quantity]) => ({ productId: Number(id), quantity }));
  const total = lines.reduce((sum, l) => {
    const p = products.find((x) => x.id === l.productId);
    return sum + (p ? p.pricePaise * l.quantity : 0);
  }, 0);

  const placeOrder = async () => {
    setPlacing(true);
    setError(null);
    const sentAt = performance.now();
    try {
      const order = await api.createOrder(lines);
      setCart({});
      onOrderPlaced(order, sentAt);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'insufficient_stock'
          ? 'Sorry, some items just sold out. Please check your cart.'
          : err instanceof Error
            ? err.message
            : 'Could not place the order',
      );
      loadProducts();
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div>
      <h1>Pickup Counter</h1>
      <ul className="products">
        {products.map((p) => {
          const inCart = cart[p.id] ?? 0;
          return (
            <li key={p.id} className="product">
              <div>
                <strong>{p.name}</strong>
                <div className="muted">
                  {formatRupees(p.pricePaise)} · {p.availableUnits > 0 ? `${p.availableUnits} available` : 'Sold out'}
                </div>
              </div>
              <div className="qty">
                <button onClick={() => change(p, -1)} disabled={inCart === 0} aria-label={`Remove one ${p.name}`}>
                  −
                </button>
                <span>{inCart}</span>
                <button
                  onClick={() => change(p, 1)}
                  disabled={inCart >= p.availableUnits}
                  aria-label={`Add one ${p.name}`}
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {error && <p className="error">{error}</p>}

      <div className="checkout">
        <span>Total: {formatRupees(total)}</span>
        <button className="primary" onClick={placeOrder} disabled={lines.length === 0 || placing}>
          {placing ? 'Placing…' : 'Place order'}
        </button>
      </div>
    </div>
  );
}
