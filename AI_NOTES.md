# AI notes

> **Draft — Kuzhandayan, rewrite this in your own words before submitting.** The parts marked TODO are things only you can write honestly.

## Tools I used

- **Claude (claude.ai, agent mode)** for most of the typing: it scaffolded the backend, wrote the SQL and the tests from the brief, built the React screen, and drafted the README.
- I chose the stack (Express over NestJS, raw SQL with `pg` instead of an ORM, so the locking is visible in the code), picked the late-payment policy, and reviewed the code.
- TODO: anything else you used (Cursor, Copilot, Claude Code) and for what.

## A prompt that worked well

TODO: paste one real prompt you used. A good one to try while reviewing: *"Remove the FOR UPDATE from lockProducts and run the order tests. Do they fail? If not, the test is not proving anything."* This is how the "tests can fail" check in the README was done.

## Something the AI got wrong, and how I noticed

- When writing the countdown test, its first fake server returned a "seconds left" value that only updated between test steps, not while time was passing. The polls during the test would have re-synced the countdown to stale values, so the "server says expired" test would have been checking the wrong thing. It was caught while reasoning through what each poll returns, before the test was trusted, and rewritten so the fake server keeps its own deadline on the same clock.
- TODO: add one thing **you** found while reviewing. Places worth checking yourself: the lock order in `payments.service.ts` (order row first, then products — is that the same everywhere?), whether `needs_review` should release units, and the 404 for unknown orders in the webhook (a real provider would keep retrying).

## How I checked the AI's work

I did not trust a green test run on its own. I broke the code on purpose (removed the row lock, removed the pickup status guard, switched the countdown to `Date.now()`) and confirmed the matching tests failed, then restored it.
