# Pickup Counter

A small self-service counter: the customer picks snacks, pays by UPI, and collects from a locker.
Backend in Express + PostgreSQL, customer screen in React (Vite), all TypeScript.

## Run it

```bash
docker compose up --build
```

Open http://localhost:8080. The same server serves the customer screen and the API (e.g. http://localhost:8080/products).

Postgres is also on `localhost:5433` (database `pickup`, user and password `postgres`) if you want to look at the data.

There are two containers: `db` (Postgres) and `app` (the Express API, which also serves the built React screen). On start, the app waits for Postgres, runs migrations and seeds five products.

### Simulate a payment

There is no real provider, so after placing an order, send a signed webhook yourself. The payment screen shows this command with the order ID filled in.

```bash
docker compose exec app npm run send-webhook -- <orderId>                 # pays the exact total
docker compose exec app npm run send-webhook -- <orderId> --event evt_1   # run twice: second one is a no-op
docker compose exec app npm run send-webhook -- <orderId> 100             # wrong amount -> needs_review
docker compose exec app npm run send-webhook -- <orderId> --status failed # ignored, order stays pending
docker compose exec app npm run send-webhook -- <orderId> --bad-signature # rejected with 401
```

### Simulate the locker

```bash
curl -X POST http://localhost:8080/orders/<orderId>/pickup-claim
```

## Run the tests

With the app running, the backend tests run inside the app container against the real Postgres. They use a separate `pickup_test` database (created automatically), so the app's data is not touched.

```bash
docker compose exec app npm test
```

Without Docker, point them at any Postgres:

```bash
cd backend && npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/pickup npm test
```

Frontend tests (countdown and status messages, no database needed):

```bash
cd frontend && npm install && npm test
```

### Local development without Docker

```bash
cd backend && npm install && DATABASE_URL=postgres://postgres:postgres@localhost:5432/pickup npm run dev   # API on :3000
cd frontend && npm install && npm run dev                                                                  # screen on :5173
```

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/products` | Each product with `availableUnits` |
| POST | `/orders` | `{ items: [{ productId, quantity }] }` → 201 with `totalPaise`, `expiresInSeconds`. 409 `insufficient_stock` if anything is short |
| GET | `/orders/:id` | Current status and `expiresInSeconds` |
| POST | `/payments/webhook` | Needs `X-Signature` = hex HMAC-SHA256 of the raw body with `WEBHOOK_SECRET` |
| POST | `/orders/:id/pickup-claim` | 200 once; 409 `already_picked_up` or `order_not_paid` |

Order statuses: `pending`, `paid`, `expired`, `needs_review`, `picked_up`.

## How it works and why

### Stock and holds

There is no separate "held" counter. A hold is just an order row with an `expires_at`. Available units are worked out from the orders:

```
available = stock - (units in pending orders whose hold has not run out) - (units in paid orders not yet collected)
```

Paid orders keep their units reserved because stock only goes down at pickup (as the brief asks). This lives in one SQL view, `reserved_units`.

Because availability is calculated from `expires_at`, a hold frees its units the moment it runs out. No background job has to run first. There is a sweep every 5 seconds, but it only changes the status label to `expired`; correctness does not depend on it. `GET /orders/:id` also expires a stale order when it is read.

I chose this over keeping an "available" column and decrementing it, because then every expiry would need a job to add units back, and a missed or late job would leave stock stuck.

### Concurrency

Every action that can change availability (placing an order, accepting a late payment, pickup) first locks the affected product rows with `SELECT ... FOR UPDATE`, always in product-id order so two transactions cannot deadlock. Then it reads availability in a **separate statement**. This matters: in Postgres READ COMMITTED, each statement gets a fresh snapshot, so the second statement sees holds committed by whoever had the lock before. If you read availability in the same statement as the lock, you can get the old snapshot and oversell.

As a last guard, `products.stock` has `CHECK (stock >= 0)`.

### One clock

All time decisions use the database clock (`clock_timestamp()`): setting `expires_at`, checking whether a hold is still valid, and computing `expiresInSeconds`. The Node process clock is never used for this, so the API server and the DB cannot disagree.

### Payment webhook

- The route reads the **raw bytes** (`express.raw`) and checks the HMAC on them with a timing-safe compare. Parsing to JSON first and re-serialising would change the bytes and break the signature.
- **Idempotency**: `payment_events.event_id` is the primary key. Inserting the event and updating the order happen in one transaction, so an event is either fully processed or not at all. A repeated event inserts nothing and gets back the outcome from the first time (`duplicate: true`). The order row is locked first, so even copies that arrive at the same moment are handled one after another.
- **Wrong amount** → `needs_review` (reason `amount_mismatch`). The units are released. A later correct payment for the same order is recorded but does not flip it to paid; a person should look at it.
- **Status other than `captured`** (e.g. `failed`) → recorded, order unchanged. The customer can still pay within the hold.
- **Unknown order** → 404 and nothing is recorded.

### Decision: payment that arrives after the hold expired

The money has already left the customer's account, so I try to complete the sale, but never by overselling:

1. Lock the order and its products, and check the hold against the DB clock.
2. If the hold is over, mark the order expired (so it stops counting as its own reservation), then check whether its units are still free.
3. **Units still free** → mark it `paid` (outcome `paid_after_expiry`). The customer gets their snacks; nobody is affected.
4. **Units gone** → `needs_review` with reason `late_payment_no_stock`. Staff refund the customer. The person who bought the units in the meantime keeps them.

Why: refusing an order we can still fill makes a customer chase a refund for nothing. But stock correctness comes first, so when we can't fill it, a human handles the refund. Automatic refunds would need a provider refund API, which is out of scope here.

The "is the hold still valid?" check happens only after the product locks are held. Placing an order takes the same locks, so a late payment and a new order for the same units can never both win.

### Pickup

```sql
UPDATE orders SET status = 'picked_up' WHERE id = $1 AND status = 'paid' RETURNING id
```

If two lockers call at the same time, the second waits on the row lock. When the first commits, Postgres re-checks `status = 'paid'` for the second, finds `picked_up`, and updates nothing → 409. Stock is reduced in the same transaction, so a claim and its stock change commit together.

### Customer screen and the wrong clock

The kiosk clock can be minutes off, so the screen never compares against a timestamp. It takes `expiresInSeconds` from the server and counts down with `performance.now()`, a monotonic timer that only measures elapsed time and ignores the device's wall clock (even if someone changes it mid-countdown). Every poll (every 2 s) re-syncs the countdown.

The countdown is anchored to when the request was **sent**, not received, so it can only show slightly less time than the real hold, never more. When it reaches zero, the screen shows "Checking payment status…" and waits for the server to say `expired` or `paid`; the browser never decides that on its own.

## Assumptions

- `eventId` identifies an event. A repeat with the same id is the same event, even if the body differs.
- Amount must match the order total exactly; there is no tolerance.
- The price is copied onto the order line when the order is placed, so later price changes don't affect it.
- No authentication: the counter, lockers and API are on a private network. The webhook is the only route with a signature.
- A `needs_review` order holds no stock. Staff resolve it outside this app.
- An expired order can't be revived by the customer; they place a new one. Only a late payment can bring it back (see above).
- Max 100 units per line and 50 lines per order, just to stop silly input.

## How I checked it

- **Automated tests against real Postgres** (`backend/tests`, 20 tests), including the three required ones:
  - 10 customers ordering the last 2 units at once → exactly 2 orders succeed, the other 8 get 409, and the database shows exactly 2 units held. Run 5 rounds in a row to make a lucky pass less likely.
  - The same webhook event sent twice, and 5 copies at the same moment → processed once, one row in `payment_events`, `paid_at` unchanged.
  - 2 (and 10) simultaneous pickup claims → exactly one 200; stock drops once.
  - Also: wrong signature, wrong amount, non-captured status, late payment with and without stock, expiry freeing units, unpaid/expired pickup.
- **Checking the tests can fail**: I removed `FOR UPDATE` from the product lock and the two concurrent-order tests failed. I removed the `status = 'paid'` guard from pickup and both concurrent-pickup tests failed. Then I restored the code and all tests passed again.
- **Frontend tests** (`frontend/src/PaymentScreen.test.tsx`): device clock set 7 minutes ahead, then moved back 20 minutes mid-countdown; the countdown still reads 2:00 → 1:30 → 1:20. When I swapped the timer to `Date.now()`, this test failed.
- **Manually** with curl and the webhook script: order, duplicate webhook, bad signature, pickup twice, stock after pickup.

## What I would do next

- Operator screen for `needs_review` orders, and refunds through the provider's API.
- Reconciliation: periodically compare our paid orders with the provider's settlement report.
- Authenticate lockers (signed requests or mTLS) instead of trusting the network.
- OpenAPI spec and generated client types for the frontend.
- Push status to the screen (SSE or WebSocket) instead of polling.
- `reserved_units` scans all open orders; at real volume, archive old orders and add a partial index for open ones.
- Use a proper migration tool (Prisma or TypeORM) instead of the small runner here.
