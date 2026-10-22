# AI notes

## Tools I used

I used **Claude** (the Claude desktop app, in agent mode) for most of the typing. It wrote the first version of the backend, the SQL, the tests, the React screen and the README from the brief. It also ran the tests in its own workspace and tested the app running on my Mac through the browser.

My part was choosing the approach, reviewing what it produced, running it on my machine, and pushing back when something was wrong or too complicated. Some choices I made:

- Express instead of NestJS, so the code stays small and easy to explain.
- Plain SQL with `pg` instead of an ORM, so the locking (`FOR UPDATE`) is visible in the code and not hidden.
- The late-payment rule: accept if the stock is still free, otherwise `needs_review`.
- A smaller Docker setup (see below).

## A prompt that worked well

After the first version was running on my Mac, I asked it roughly this:

> "Test whatever is done here, check if there is any unwanted code in this repo, and make it simpler."

This worked well because it didn't just say "looks fine". It tested the running app in my browser, including 10 orders at once for the last 2 units, duplicate webhooks and two pickups at the same time, and then removed code that nothing used (a `/health` endpoint, an unused parameter, unused fields in a query). It also kept the parts that look like duplication but are needed for correctness, and explained why.

Another thing I asked for was to break the code on purpose and check that the tests fail, for example by removing `FOR UPDATE`. A green test run alone doesn't prove the test is checking anything.

## What the AI got wrong, and how I noticed

**1. The first Docker setup was too big, and it didn't run on my machine.** The first version had three containers (Postgres, API, and nginx for the frontend) plus a separate test container, and it opened the API on port 3000 on my Mac. When I ran `docker compose up`, it failed with `Bind for 0.0.0.0:3000 failed: port is already allocated`, because something else on my Mac was already using port 3000. Its first fix was to make the ports configurable, which made the file even longer. I pushed back and asked for something simple. Now there are only two containers (`db` and `app`), the API serves the React screen itself, and nginx is gone.

**2. Its own test script assumed the wrong stock.** When it tested the app in my browser, it sent 10 orders for Mango Juice and expected 2 to succeed. Only 1 did, and the script crashed. The app was right: I had placed an order from the screen a few minutes earlier, and it was still holding one unit. The test script was wrong, not the code. It rewrote the check to first hold all but 2 units, and then race for the last 2.

**3. Auto-creating the test database didn't work the first time.** When the Docker setup was simplified, the tests were changed to create their own `pickup_test` database. The first version tried to create the wrong database, because Vitest's global setup runs in a different process and didn't see the test database URL. This showed up as a failed test run on a fresh database, and it was fixed before I pulled the change.

## How I checked the work

- Ran `docker compose up --build` on my Mac and used the app: placed orders, paid with the webhook script, claimed pickup with `curl`, and checked the result.
- Looked at the `orders`, `order_items` and `payment_events` tables in DBeaver.
- Read through the locking code in `stock.ts`, `orders.service.ts` and `payments.service.ts` until I could explain it.
