import fs from 'node:fs';
import { STATUS_LABEL } from './checklist.js';

const API = 'https://api.telegram.org';
const mimeFor = (file) => (file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg');

/**
 * Telegram Bot API client + command handler.
 * Disabled (no-op) when TELEGRAM_BOT_TOKEN is empty.
 */
export function createTelegram({ token, dispatchChatId = '' }, { fetchImpl = fetch } = {}) {
  const enabled = Boolean(token);

  async function call(method, payload, form) {
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: form ? undefined : { 'Content-Type': 'application/json' },
      body: form ?? JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description || res.status}`);
    return data.result;
  }

  const api = {
    enabled,
    dispatchChatId,

    sendMessage(chatId, text) {
      if (!enabled) return Promise.resolve(null);
      return call('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000) });
    },

    /** photos: [{ slot, path }]. One photo -> sendPhoto; 2-10 -> sendMediaGroup (album). */
    sendPhotos(chatId, photos, caption = '') {
      if (!enabled || !photos.length) return Promise.resolve(null);
      const items = photos.slice(0, 10);
      const form = new FormData();
      form.append('chat_id', String(chatId));

      if (items.length === 1) {
        const p = items[0];
        form.append('photo', new Blob([fs.readFileSync(p.path)], { type: mimeFor(p.path) }), `${p.slot}.jpg`);
        if (caption) form.append('caption', caption.slice(0, 1024));
        return call('sendPhoto', null, form);
      }

      const media = items.map((p, i) => {
        form.append(`photo${i}`, new Blob([fs.readFileSync(p.path)], { type: mimeFor(p.path) }), `${p.slot}.jpg`);
        return {
          type: 'photo',
          media: `attach://photo${i}`,
          ...(i === 0 && caption ? { caption: caption.slice(0, 1024) } : {}),
        };
      });
      form.append('media', JSON.stringify(media));
      return call('sendMediaGroup', null, form);
    },

    setWebhook(url, secret) {
      return call('setWebhook', { url, secret_token: secret, allowed_updates: ['message'] });
    },

    getMe() {
      return call('getMe');
    },

    /** Handles one Telegram update (long-polling-free webhook). */
    async handleUpdate(update, service) {
      const msg = update?.message;
      if (!msg?.text || !msg.chat) return null;
      const chatId = msg.chat.id;
      const [head = '', ...rest] = msg.text.trim().split(/\s+/);
      const cmd = head.split('@')[0].toLowerCase();
      const arg = rest.join(' ');
      const say = (text) => api.sendMessage(chatId, text);

      switch (cmd) {
        case '/start':
          return say('Fleet Readiness bot.\nAsk your dispatcher for a 6-digit code, then send:\n/link CODE');

        case '/link': {
          if (!/^\d{6}$/.test(arg)) return say('Usage: /link 123456 (the code from your dispatcher)');
          const driver = service.linkTelegram(arg, chatId);
          return say(driver
            ? `Linked. Hi ${driver.name}! Commands: /status, /inspect`
            : 'That code is not valid. Ask your dispatcher for a new one.');
        }

        case '/status': {
          const driver = service.driverByChat(chatId);
          if (!driver) return say('Link your account first: /link CODE');
          const truck = service.truckForDriver(driver.id);
          if (!truck) return say('No truck is assigned to you yet.');
          return say(`Truck ${truck.unit}\nReadiness: ${STATUS_LABEL[truck.readiness] ?? STATUS_LABEL.unknown}\nLast inspection: ${truck.last_inspection_at ?? 'never'}`);
        }

        case '/inspect': {
          const driver = service.driverByChat(chatId);
          if (!driver) return say('Link your account first: /link CODE');
          const truck = service.truckForDriver(driver.id);
          if (!truck) return say('No truck is assigned to you yet.');
          const r = service.startInspection(truck.id, driver.id);
          return say(`Inspection for truck ${truck.unit} is open. Take the photos and complete the checklist here:\n${r.url}`);
        }

        default:
          return say('Commands:\n/link CODE - connect your account\n/status - your truck\n/inspect - start inspection');
      }
    },
  };

  return api;
}
