-- Money is always whole paise (integers). Stock can never go below zero.

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  price_paise INTEGER NOT NULL CHECK (price_paise > 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0)
);

CREATE TABLE orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'paid', 'expired', 'needs_review', 'picked_up')),
  total_paise  INTEGER NOT NULL CHECK (total_paise > 0),
  expires_at   TIMESTAMPTZ NOT NULL,
  review_reason TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ
);

CREATE INDEX orders_pending_expiry_idx ON orders (expires_at) WHERE status = 'pending';

CREATE TABLE order_items (
  order_id         UUID    NOT NULL REFERENCES orders(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX order_items_product_idx ON order_items (product_id);

-- One row per provider event. The primary key is what makes webhooks idempotent.
CREATE TABLE payment_events (
  event_id     TEXT PRIMARY KEY,
  order_id     UUID NOT NULL REFERENCES orders(id),
  amount_paise INTEGER NOT NULL,
  status       TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Units that are spoken for but not yet collected:
--   * pending orders whose hold has not run out, and
--   * paid orders waiting at the locker (stock only drops at pickup).
CREATE VIEW reserved_units AS
SELECT oi.product_id, SUM(oi.quantity)::int AS units
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE (o.status = 'pending' AND o.expires_at > now())
   OR o.status = 'paid'
GROUP BY oi.product_id;
