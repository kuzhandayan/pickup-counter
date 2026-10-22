import { defineConfig } from 'vitest/config';

// Tests use a separate "pickup_test" database on the same server as the app,
// so running them never touches the app's data. tests/setup.ts creates it.
const appDb = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/pickup';
const testDb = process.env.TEST_DATABASE_URL ?? appDb.replace(/\/[^/]*$/, '/pickup_test');
process.env.TEST_DATABASE_URL = testDb; // read by tests/setup.ts

export default defineConfig({
  test: {
    // All test files share one real database, so run them one file at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    globalSetup: './tests/setup.ts',
    env: {
      DATABASE_URL: testDb,
      WEBHOOK_SECRET: 'test-secret',
      HOLD_SECONDS: '120',
    },
  },
});
