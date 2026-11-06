// Registers the Telegram webhook for this deployment: npm run set-webhook
import { config } from '../server/config.js';
import { createTelegram } from '../server/telegram.js';

const tg = createTelegram(config.telegram);
if (!tg.enabled) {
  console.error('Set TELEGRAM_BOT_TOKEN first.');
  process.exit(1);
}
if (!config.telegram.webhookSecret) {
  console.error('Set TELEGRAM_WEBHOOK_SECRET first.');
  process.exit(1);
}
const url = `${config.publicUrl}/api/telegram/webhook`;
await tg.setWebhook(url, config.telegram.webhookSecret);
console.log(`Webhook set to ${url}`);
