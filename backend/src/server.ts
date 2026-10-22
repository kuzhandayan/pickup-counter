import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { seedIfEmpty } from './seed.js';
import { startExpirySweep } from './jobs/expire-holds.js';

// Postgres may still be starting when the app container comes up, so retry for a bit.
async function waitForDb(attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`waiting for database (${i}/${attempts})...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main() {
  await waitForDb();
  await migrate();
  await seedIfEmpty();
  startExpirySweep(config.expirySweepMs);

  createApp().listen(config.port, () => {
    console.log(`listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
