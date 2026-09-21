import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './lib/db.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`\n  ADISYS FieldOps API`);
  console.log(`  ▸ listening on http://localhost:${config.port}`);
  console.log(`  ▸ environment: ${config.env}\n`);
});

const shutdown = (signal: string) => {
  console.log(`\n${signal} received — closing gracefully …`);
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
