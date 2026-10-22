# Commands to try the app

# start db in local

docker compose up -d

Run these in a terminal inside the project folder, with the app running (`docker compose up --build`).

## 1. Set your order ID

Place an order at http://localhost:8080, copy the order ID from the payment screen, and set it here.
Change only this line each time you place a new order:

```bash
ORDER_ID=d6cc534c-050d-4e45-bfff-d25ee70cbbe8
```

## 2. Pay the order (within 2 minutes)

```bash
docker compose exec app npm run send-webhook -- $ORDER_ID
```

Expected: `-> 200 {"duplicate":false,"outcome":"paid"}`. The screen changes to "Payment received".

### Other payment cases

```bash
# Same event twice: the second one changes nothing ("duplicate": true)
docker compose exec app npm run send-webhook -- $ORDER_ID --event evt_test_1
docker compose exec app npm run send-webhook -- $ORDER_ID --event evt_test_1

# Wrong amount: order becomes needs_review
docker compose exec app npm run send-webhook -- $ORDER_ID 100

# Failed payment: ignored, order stays pending
docker compose exec app npm run send-webhook -- $ORDER_ID --status failed

# Bad signature: rejected with 401
docker compose exec app npm run send-webhook -- $ORDER_ID --bad-signature
```

## 3. Collect from the locker

```bash
curl -X POST http://localhost:8080/orders/$ORDER_ID/pickup-claim
```

Expected: `"status":"picked_up"`. Run it again and you get `already_picked_up` (409).

## 4. Check the order and stock

```bash
curl http://localhost:8080/orders/$ORDER_ID
curl http://localhost:8080/products
```

## 5. Run the automated tests

```bash
docker compose exec app npm test
```

Expected: `Tests  20 passed (20)`.

## 6. Look at the database

```bash
docker compose exec db psql -U postgres -d pickup -c "SELECT id, status, total_paise, created_at FROM orders ORDER BY created_at DESC LIMIT 10;"
```

Or connect DBeaver to `localhost:5433`, database `pickup`, user and password `postgres`.

## 7. Start fresh

```bash
docker compose down -v
docker compose up --build
```
