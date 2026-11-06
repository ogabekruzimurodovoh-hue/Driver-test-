import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKLIST, PHOTO_SLOTS, REQUIRED_PHOTOS } from './checklist.js';
import { httpError, safeEqual } from './util.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY = 15 * 1024 * 1024;
const STREAMED = Symbol('streamed');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";

export function createApp({ config, service, telegram, log = console }) {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
    routes.push({ method, re, handler, ...opts });
  };

  // ---- Public ----
  add('GET', '/healthz', async () => ({ ok: true, tms: service.tmsEnabled, telegram: telegram.enabled }), { public: true });

  add('POST', '/api/telegram/webhook', async ({ req, body }) => {
    const header = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
    const secret = config.telegram.webhookSecret;
    if (!telegram.enabled || !secret || !safeEqual(header, secret)) throw httpError(401, 'Unauthorized');
    try {
      await telegram.handleUpdate(body, service);
    } catch (e) {
      log.error('Telegram update failed:', e.message);
    }
    return { ok: true };
  }, { public: true });

  // ---- Dispatcher + driver API ----
  add('GET', '/api/config', async () => ({
    checklist: CHECKLIST,
    photoSlots: PHOTO_SLOTS,
    requiredPhotos: REQUIRED_PHOTOS,
    tmsEnabled: service.tmsEnabled,
    telegramEnabled: telegram.enabled,
  }));

  add('GET', '/api/drivers', () => service.listDrivers());
  add('POST', '/api/drivers', ({ body }) => service.createDriver(body));
  add('POST', '/api/drivers/:id/link-code', ({ params }) => ({ code: service.createLinkCode(Number(params.id)) }));

  add('GET', '/api/trucks', () => service.listTrucks());
  add('POST', '/api/trucks/:id/assign', ({ params, body }) =>
    service.assignDriver(Number(params.id), body?.driverId ?? null));
  add('POST', '/api/trucks/:id/inspections', ({ params, body }) =>
    service.startInspection(Number(params.id), body?.driverId ?? null));

  add('GET', '/api/inspections', ({ query }) =>
    service.listInspections(query.get('truckId') ? Number(query.get('truckId')) : null));
  add('GET', '/api/inspections/:id', ({ params }) => service.getInspection(Number(params.id)), { inspection: true });
  add('PUT', '/api/inspections/:id/checklist', ({ params, body }) =>
    service.saveChecklist(Number(params.id), body ?? {}), { inspection: true });
  add('PUT', '/api/inspections/:id/photos/:slot', ({ params, body }) =>
    service.savePhoto(Number(params.id), params.slot, body?.data), { inspection: true });
  add('GET', '/api/inspections/:id/photos/:slot', async ({ params, res }) => {
    const file = service.photoFile(Number(params.id), params.slot);
    res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'private, max-age=300' });
    fs.createReadStream(file.path).pipe(res);
    return STREAMED;
  }, { inspection: true });
  add('POST', '/api/inspections/:id/complete', ({ params }) =>
    service.completeInspection(Number(params.id)), { inspection: true });

  add('POST', '/api/tms/sync', () => service.syncFromTms());

  // ---- Helpers ----
  function basicAuthOk(req) {
    const h = req.headers.authorization ?? '';
    if (!h.startsWith('Basic ')) return false;
    const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    return safeEqual(pass, config.dashboardPassword);
  }

  function authorized(req, url, route, params) {
    if (route.public || !config.dashboardPassword) return true;
    if (route.inspection) {
      const token = req.headers['x-inspection-token'] ?? url.searchParams.get('t');
      if (token && service.inspectionTokenMatches(Number(params.id), String(token))) return true;
    }
    return basicAuthOk(req);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(httpError(413, 'Payload too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function sendJson(res, status, data) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  }

  async function handleApi(req, res, url) {
    const route = routes.find((r) => {
      if (r.method !== req.method) return false;
      return r.re.test(url.pathname);
    });
    if (!route) {
      const anyMethod = routes.some((r) => r.re.test(url.pathname));
      return sendJson(res, anyMethod ? 405 : 404, { error: anyMethod ? 'Method not allowed' : 'Not found' });
    }

    const params = { ...(url.pathname.match(route.re)?.groups ?? {}) };
    if (!authorized(req, url, route, params)) {
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      if (!route.public) headers['WWW-Authenticate'] = 'Basic realm="Fleet Readiness", charset="UTF-8"';
      res.writeHead(401, headers);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    let body;
    const raw = await readBody(req);
    if (raw.length && String(req.headers['content-type'] ?? '').includes('application/json')) {
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        throw httpError(400, 'Invalid JSON');
      }
    }

    const result = await route.handler({ req, res, params, query: url.searchParams, body });
    if (result === STREAMED) return;
    sendJson(res, 200, result ?? { ok: true });
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });

    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return sendJson(res, 404, { error: 'Not found' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': CSP,
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
        await handleApi(req, res, url);
      } else {
        serveStatic(req, res, url);
      }
    } catch (e) {
      const status = e.status ?? (e instanceof URIError ? 400 : 500);
      if (status >= 500) log.error(e);
      if (!res.headersSent) {
        sendJson(res, status, status >= 500 ? { error: 'Internal server error' } : { error: e.message, ...(e.extra ?? {}) });
      } else {
        res.end();
      }
    }
  };
}
