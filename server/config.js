import path from 'node:path';

const env = process.env;
const port = Number(env.PORT || 3000);

export const config = {
  port,
  publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  dataDir: path.resolve(env.DATA_DIR || 'data'),
  dashboardPassword: env.DASHBOARD_PASSWORD || '',
  seedDemo: env.SEED_DEMO !== 'false',
  telegram: {
    token: env.TELEGRAM_BOT_TOKEN || '',
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    dispatchChatId: env.TELEGRAM_DISPATCH_CHAT_ID || '',
  },
  tms: {
    baseUrl: env.TMS_BASE_URL || '',
    apiKey: env.TMS_API_KEY || '',
    driversPath: env.TMS_DRIVERS_PATH || '/drivers',
    trucksPath: env.TMS_TRUCKS_PATH || '/trucks',
    inspectionsPath: env.TMS_INSPECTIONS_PATH || '/inspections',
  },
};
