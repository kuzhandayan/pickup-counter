export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/pickup',
  webhookSecret: process.env.WEBHOOK_SECRET ?? 'dev-secret-change-me',
  holdSeconds: Number(process.env.HOLD_SECONDS ?? 120),
  expirySweepMs: Number(process.env.EXPIRY_SWEEP_MS ?? 5000),
};
