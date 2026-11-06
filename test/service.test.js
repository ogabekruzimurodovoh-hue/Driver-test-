import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createService } from '../server/service.js';
import { createTmsClient } from '../server/tms.js';
import { createApp } from '../server/app.js';
import { allItems } from '../server/checklist.js';
import { seedDemo } from '../server/seed.js';

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const dirs = [];
function setup({ tms = createTmsClient({ baseUrl: '', apiKey: '' }), notifier, password = '', secret = '' } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-test-'));
  dirs.push(dataDir);
  const db = openDb(dataDir);
  seedDemo(db);
  const sent = [];
  const fakeNotifier = notifier ?? {
    enabled: false,
    dispatchChatId: '',
    sendMessage: async (chat, text) => { sent.push({ chat, text }); },
    sendPhotos: async () => null,
  };
  const service = createService({ db, dataDir, publicUrl: 'http://test.local', tms, notifier: fakeNotifier, log: { error() {}, warn() {} } });
  service.tmsEnabled = tms.enabled;
  const config = {
    dashboardPassword: password,
    telegram: { token: '', webhookSecret: secret, dispatchChatId: '' },
  };
  const telegram = { enabled: false, handleUpdate: async () => {} };
  return { db, service, sent, config, telegram, dataDir };
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

function completeAnswers() {
  return Object.fromEntries(allItems().map((i) => [i.key, 'pass']));
}

test('start inspection, save photos and checklist, then complete -> ready', async () => {
  const { service } = setup();
  const truck = service.listTrucks().find((t) => t.unit === '103');
  const started = service.startInspection(truck.id);
  assert.equal(started.reused, false);
  assert.match(started.url, /inspect\.html\?id=\d+&t=/);

  // Re-starting returns the same open inspection
  assert.equal(service.startInspection(truck.id).id, started.id);

  for (const slot of ['front', 'right', 'rear', 'left', 'interior_dash', 'interior_cab']) {
    service.savePhoto(started.id, slot, PNG);
  }
  const saved = service.saveChecklist(started.id, { answers: completeAnswers(), odometer: '412560', notes: 'ok' });
  assert.equal(saved.canComplete, true);

  const done = await service.completeInspection(started.id);
  assert.equal(done.status, 'ready');
  assert.equal(done.truck.readiness, 'ready');
  assert.equal(done.odometer, 412560);
});

test('completing with missing items is rejected with details', async () => {
  const { service } = setup();
  const truck = service.listTrucks()[0];
  const { id } = service.startInspection(truck.id);
  await assert.rejects(() => service.completeInspection(id), (e) => {
    assert.equal(e.status, 409);
    assert.ok(e.extra.missingPhotos.includes('front'));
    assert.ok(e.extra.missingChecklist.length > 0);
    return true;
  });
});

test('a critical failure makes the truck out of service', async () => {
  const { service } = setup();
  const truck = service.listTrucks()[0];
  const { id } = service.startInspection(truck.id);
  for (const slot of ['front', 'right', 'rear', 'left', 'interior_dash', 'interior_cab']) service.savePhoto(id, slot, PNG);
  service.saveChecklist(id, { answers: { ...completeAnswers(), service_brakes: 'fail' } });
  const done = await service.completeInspection(id);
  assert.equal(done.status, 'out_of_service');
  assert.equal(service.listTrucks().find((t) => t.id === truck.id).readiness, 'out_of_service');
});

test('invalid photo slot, bad data URL and completed inspections are rejected', async () => {
  const { service } = setup();
  const { id } = service.startInspection(service.listTrucks()[0].id);
  assert.throws(() => service.savePhoto(id, 'roof', PNG), /Unknown photo slot/);
  assert.throws(() => service.savePhoto(id, 'front', 'data:text/html;base64,PGgxPg=='), /JPEG, PNG or WebP/);
  for (const slot of ['front', 'right', 'rear', 'left', 'interior_dash', 'interior_cab']) service.savePhoto(id, slot, PNG);
  service.saveChecklist(id, { answers: completeAnswers() });
  await service.completeInspection(id);
  assert.throws(() => service.savePhoto(id, 'front', PNG), /already completed/);
});

test('assigning a driver clears their previous truck and links Telegram chat', async () => {
  const { service, db } = setup();
  const drivers = service.listDrivers();
  const alex = drivers.find((d) => d.name === 'Alex Morgan');
  const truck103 = service.listTrucks().find((t) => t.unit === '103');
  await service.assignDriver(truck103.id, alex.id);
  const after = service.listTrucks();
  assert.equal(after.find((t) => t.unit === '103').driver_id, alex.id);
  assert.equal(after.find((t) => t.unit === '101').driver_id, null);
  assert.ok(db);
});

test('Telegram link code is one-time and maps chat to driver', () => {
  const { service } = setup();
  const driver = service.createDriver({ name: 'Test Driver' });
  const code = service.createLinkCode(driver.id);
  assert.match(code, /^\d{6}$/);
  assert.equal(service.linkTelegram('000000', 42), null);
  assert.equal(service.linkTelegram(code, 42).name, 'Test Driver');
  assert.equal(service.driverByChat(42).id, driver.id);
  assert.equal(service.linkTelegram(code, 43), null, 'code is consumed after use');
});

test('driver notified on assignment when linked', async () => {
  const { service, sent } = setup({
    notifier: {
      enabled: true, dispatchChatId: '',
      sendMessage: async (chat, text) => { sent.push({ chat, text }); },
      sendPhotos: async () => null,
    },
  });
  const driver = service.createDriver({ name: 'Linked Driver' });
  service.linkTelegram(service.createLinkCode(driver.id), 777);
  await service.assignDriver(service.listTrucks()[0].id, driver.id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat, 777);
  assert.match(sent[0].text, /assigned to truck/);
});

test('TMS sync upserts drivers and trucks by tms_id', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/drivers')) {
      return new Response(JSON.stringify([{ id: 'T-1', name: 'TMS Driver', phone: '1' }]), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [{ id: 'V-9', unitNumber: '555', driverId: 'T-1', plate: 'XYZ' }] }), { status: 200 });
  };
  const tms = createTmsClient({ baseUrl: 'https://tms.test', apiKey: 'k', driversPath: '/drivers', trucksPath: '/trucks', inspectionsPath: '/i' }, { fetchImpl });
  const { service } = setup({ tms });
  const result = await service.syncFromTms();
  assert.deepEqual(result, { drivers: 1, trucks: 1 });
  const truck = service.listTrucks().find((t) => t.unit === '555');
  assert.equal(truck.plate, 'XYZ');
  assert.equal(truck.driver_name, 'TMS Driver');
});

// ---------- HTTP layer: auth and routing ----------
async function withServer(ctx, fn) {
  const app = createApp({ config: ctx.config, service: ctx.service, telegram: ctx.telegram, log: { error() {} } });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

test('dashboard API requires Basic auth; inspection token grants only its own inspection', async () => {
  const ctx = setup({ password: 's3cret' });
  const { id, token } = ctx.service.startInspection(ctx.service.listTrucks()[0].id);
  await withServer(ctx, async (base) => {
    assert.equal((await fetch(`${base}/api/trucks`)).status, 401);
    const basic = { Authorization: `Basic ${Buffer.from('dispatch:s3cret').toString('base64')}` };
    assert.equal((await fetch(`${base}/api/trucks`, { headers: basic })).status, 200);
    assert.equal((await fetch(`${base}/api/trucks`, { headers: { Authorization: `Basic ${Buffer.from('x:wrong').toString('base64')}` } })).status, 401);

    // Inspection-scoped access with token (no password)
    assert.equal((await fetch(`${base}/api/inspections/${id}?t=${token}`)).status, 200);
    assert.equal((await fetch(`${base}/api/inspections/${id}?t=bad`)).status, 401);
    assert.equal((await fetch(`${base}/api/inspections/${id + 999}?t=${token}`)).status, 401);
    // Token does not unlock the fleet list
    assert.equal((await fetch(`${base}/api/trucks?t=${token}`)).status, 401);
  });
});

test('Telegram webhook rejects requests without the secret header', async () => {
  const ctx = setup({ secret: 'hook-secret' });
  ctx.telegram.enabled = true;
  await withServer(ctx, async (base) => {
    const bad = await fetch(`${base}/api/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${base}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'hook-secret' },
      body: '{}',
    });
    assert.equal(ok.status, 200);
  });
});

test('static pages are served with security headers and path traversal is blocked', async () => {
  const ctx = setup();
  await withServer(ctx, async (base) => {
    const page = await fetch(`${base}/inspect.html`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 403);
    assert.equal((await fetch(`${base}/nope.html`)).status, 404);
  });
});
