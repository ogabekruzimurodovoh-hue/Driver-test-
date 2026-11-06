import http from 'node:http';
import { config } from './config.js';
import { openDb } from './db.js';
import { createService } from './service.js';
import { createTmsClient } from './tms.js';
import { createTelegram } from './telegram.js';
import { createApp } from './app.js';
import { seedDemo } from './seed.js';

if (process.env.NODE_ENV === 'production' && !config.dashboardPassword) {
  console.error('DASHBOARD_PASSWORD must be set in production.');
  process.exit(1);
}
if (!config.dashboardPassword) console.warn('WARNING: DASHBOARD_PASSWORD is empty. The API is open.');
if (config.telegram.token && !config.telegram.webhookSecret) {
  console.warn('WARNING: TELEGRAM_WEBHOOK_SECRET is empty. The Telegram webhook will reject all requests.');
}

const db = openDb(config.dataDir);
if (config.seedDemo) seedDemo(db);

const tms = createTmsClient(config.tms);
const telegram = createTelegram(config.telegram);
const service = createService({
  db,
  dataDir: config.dataDir,
  publicUrl: config.publicUrl,
  tms,
  notifier: telegram,
});
service.tmsEnabled = tms.enabled;

const app = createApp({ config, service, telegram });
http.createServer(app).listen(config.port, () => {
  console.log(`Fleet Readiness on ${config.publicUrl} (port ${config.port})`);
  console.log(`  TMS sync:  ${tms.enabled ? 'enabled' : 'disabled (set TMS_BASE_URL, TMS_API_KEY)'}`);
  console.log(`  Telegram:  ${telegram.enabled ? 'enabled' : 'disabled (set TELEGRAM_BOT_TOKEN)'}`);
});
