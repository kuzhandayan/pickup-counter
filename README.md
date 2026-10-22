# Pickup Counter

A small self-service snack counter. The customer picks items on a screen, pays by UPI, and collects the order from a locker.

- Backend: Node.js + Express + PostgreSQL (TypeScript)
- Customer screen: React + Vite (TypeScript)
- Tests: Vitest, against a real Postgres database

## How to run

You only need Docker.

```bash
docker compose up --build
```

Then open http://localhost:8080.

This starts two containers:

- `db` - Postgres. Also open on `localhost:5433` (database `pickup`, user `postgres`, password `postgres`) if you want to look at the data in DBeaver or psql.
- `app` - the Express API. It also serves the built React screen, so the screen and the API are on the same port.

On first start the app waits for Postgres, creates the tables and adds 5 products.

To stop: `docker compose down` (this also clears the data).

## How to try it

There is no real payment provider, so you send the payment webhook yourself with a script. The full list of commands is in [COMMANDS.md](COMMANDS.md). The short version:

1. Open http://localhost:8080, add some items and click **Place order**.
2. Copy the order ID. The payment screen shows the exact command under "Testing: simulate the payment".
3. Pay it (within 2 minutes):
   ```bash
   docker compose exec app npm run send-webhook -- <orderId>
   ```
   The screen changes to "Payment received".
4. Collect it, as the locker would:
   ```bash
   curl -X POST http://localhost:8080/orders/<orderId>/pickup-claim
   ```
   Run it again and you get `409 already_picked_up`.

The webhook script can also send a wrong amount, a failed payment, a bad signature, or the same event twice. See COMMANDS.md.

## How to run the tests

Backend (20 tests, real Postgres), with the app running:

```bash
docker compose exec app npm test
```

The tests use their own database, `pickup_test`, which is created automatically. They don't touch the app's data.

Frontend (3 tests for the countdown and status messages, no database needed):

```bash
cd frontend && npm install && npm test
```

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/products` | Products with `availableUnits` |
| POST | `/orders` | Body `{ "items": [{ "productId": 1, "quantity": 2 }] }`. Returns 201 with `totalPaise` and `expiresInSeconds`, or 409 `insufficient_stock` |
| GET | `/orders/:id` | Order status and `expiresInSeconds` |
| POST | `/payments/webhook` | Needs header `X-Signature` (hex HMAC-SHA256 of the raw body) |
| POST | `/orders/:id/pickup-claim` | 200 the first time, 409 after that or if the order isn't paid |

Order statuses: `pending`, `paid`, `expired`, `needs_review`, `picked_up`.

Money is always stored as whole paise (integers).

## Decisions

### Stock and holds

I don't keep a separate "held" counter. A hold is just an order with an `expires_at` time. Available units are calculated:

```
available = stock
          - units in pending orders that haven't expired yet
          - units in paid orders not collected yet
```

This is the `reserved_units` view in the migration.

Because of this, when a hold runs out, the units are free straight away. Nothing has to run first. There is a small job every 5 seconds that changes the label to `expired`, but stock is correct even if that job is late or stopped.

Paid orders keep holding their units until pickup, because stock only goes down at pickup.

### Two people buying the last units at the same time

Placing an order, accepting a late payment, and pickup all start by locking the product rows (`SELECT ... FOR UPDATE`), always in product id order so two requests can't deadlock.

After the lock, availability is read in a **separate** query. This matters in Postgres: each query sees data committed before it started, so the second query sees holds created by whoever had the lock before. If it were the same query as the lock, it could read old data and oversell.

There is also `CHECK (stock >= 0)` on the table as a last safety net.

### Time

All "has the hold expired?" checks use the database clock, not the Node server clock, so there is only one clock to trust.

### Payment webhook

- **Signature:** checked against the raw request bytes. If you parse the JSON and turn it back into a string, the bytes can change and the signature won't match.
- **Same event twice:** `eventId` is the primary key of `payment_events`. Saving the event and updating the order happen in one transaction. A repeat inserts nothing and gets back the first result with `duplicate: true`. The order row is locked first, so even copies that arrive at the same moment are handled one at a time.
- **Wrong amount:** the order becomes `needs_review` and is not marked paid. Its units are released. A later correct payment for the same order doesn't flip it to paid; someone should look at it.
- **Status other than `captured`** (like `failed`): saved, order not changed. The customer can still pay before the hold ends.

### Payment that arrives after the hold expired

The brief left this open. What I chose:

- **If the units are still free** - accept it and mark the order `paid`. The customer has already paid, and nobody else is affected.
- **If the units were sold to someone else** - mark it `needs_review` (reason `late_payment_no_stock`). Staff refund the customer. The person who bought the units in between keeps them.

Why: rejecting a payment for an order we can still fill just makes the customer chase a refund. But I never oversell to do it. Automatic refunds would need the provider's refund API, which isn't part of this task.

The "is the hold over?" check happens after the product rows are locked. Placing an order takes the same locks, so a late payment and a new order can never both get the same units.

### Pickup

```sql
UPDATE orders SET status = 'picked_up' WHERE id = $1 AND status = 'paid'
```

If two lockers call at the same time, the second one waits for the first. After the first commits, Postgres checks the condition again for the second, sees `picked_up`, updates nothing, and the API returns 409. The stock goes down in the same transaction.

### Countdown when the counter's clock is wrong

The screen never compares with a date or time from the server. It takes `expiresInSeconds` and counts down using `performance.now()`, which only measures time passed and ignores the device clock (even if someone changes the clock in between). Each poll (every 2 seconds) corrects it again.

The countdown starts from when the request was **sent**, so it can only show slightly less time than the real hold, never more. When it reaches zero, the screen shows "Checking payment status…" and waits for the server to say `expired` or `paid`. The screen never decides that on its own.

## Assumptions

- `eventId` identifies an event. A repeat with the same id is treated as the same event.
- The amount must match the total exactly.
- The price is copied onto the order when it is placed, so later price changes don't affect it.
- No login. The counter, lockers and API are on a private network. Only the webhook is signed.
- A `needs_review` order holds no stock. Staff handle it outside this app.
- An expired order can't be paid again by the customer from the screen; they place a new one. Only a late webhook can still complete it (see above).
- Limits: up to 100 units per item and 50 items per order.

## How I checked it

- **Automated tests against real Postgres** (`backend/tests`), including the three from the brief:
  - 10 customers ordering the last 2 units at once: exactly 2 orders succeed, 8 get 409, and the database shows exactly 2 units held. This runs 5 rounds so a lucky pass is less likely.
  - The same webhook sent twice, and 5 copies at the same moment: processed once.
  - 2 (and 10) pickup claims at the same moment: exactly one succeeds, stock goes down once.
  - Also: bad signature, wrong amount, failed status, late payment with and without stock, expiry freeing units, pickup of unpaid or expired orders.
- **Checking that the tests can actually fail:** I removed `FOR UPDATE` from the product lock and the concurrent order tests failed. I removed the `status = 'paid'` check from pickup and the concurrent pickup tests failed. I changed the countdown to use `Date.now()` and the wrong-clock test failed. Then I put the code back.
- **By hand on the running app:** placed orders on the screen, paid with the webhook script, sent duplicates, a wrong amount and a bad signature, claimed pickup twice, and checked the tables in DBeaver.

## What I would do next

- A staff screen for `needs_review` orders, with refunds through the provider's API.
- Reconciliation: compare our paid orders with the provider's settlement report every day.
- Authenticate the lockers instead of trusting the network.
- An OpenAPI spec and generated types for the frontend.
- Push status to the screen (SSE or WebSocket) instead of polling.
- At higher volume, archive old orders so `reserved_units` stays fast.
- Use Prisma or TypeORM migrations instead of the small runner here.
