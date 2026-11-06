import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHECKLIST, PHOTO_SLOTS, REQUIRED_PHOTOS, STATUS_LABEL, allItems, evaluateChecklist,
} from './checklist.js';
import { httpError, safeEqual } from './util.js';

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const VALID_ITEM_KEYS = new Set(allItems().map((i) => i.key));
const VALID_ANSWERS = new Set(['pass', 'fail', 'na']);

const clip = (v, max) => String(v ?? '').slice(0, max);
const safe = async (fn, log, what) => {
  try { return await fn(); } catch (e) { log.error(`${what} failed:`, e.message); return null; }
};

export function createService({ db, dataDir, publicUrl, tms, notifier, log = console }) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const inspectionUrl = (i) => `${publicUrl}/inspect.html?id=${i.id}&t=${i.token}`;
  const reportUrl = (id) => `${publicUrl}/viewer.html?id=${id}`;

  const driverRow = (id) => db.prepare('SELECT * FROM drivers WHERE id = ?').get(id) ?? null;
  const truckRow = (id) => db.prepare('SELECT * FROM trucks WHERE id = ?').get(id) ?? null;
  const inspectionRow = (id) => db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) ?? null;

  function requireDriver(id) {
    const d = driverRow(id);
    if (!d) throw httpError(404, 'Driver not found');
    return d;
  }
  function requireTruck(id) {
    const t = truckRow(id);
    if (!t) throw httpError(404, 'Truck not found');
    return t;
  }
  function requireInspection(id) {
    const i = inspectionRow(id);
    if (!i) throw httpError(404, 'Inspection not found');
    return i;
  }
  function requireOpen(id) {
    const i = requireInspection(id);
    if (i.status !== 'in_progress') throw httpError(409, 'Inspection is already completed');
    return i;
  }

  // ---------- Drivers ----------
  function listDrivers() {
    return db.prepare('SELECT id, name, phone, tms_id, active, telegram_chat_id FROM drivers ORDER BY name')
      .all()
      .map(({ telegram_chat_id, ...d }) => ({ ...d, telegram_linked: telegram_chat_id != null }));
  }

  function createDriver({ name, phone = '' } = {}) {
    const cleanName = clip(name, 120).trim();
    if (!cleanName) throw httpError(400, 'Driver name is required');
    const r = db.prepare('INSERT INTO drivers (name, phone) VALUES (?, ?)').run(cleanName, clip(phone, 40).trim());
    return requireDriver(Number(r.lastInsertRowid));
  }

  /** One-time 6-digit code the driver sends to the bot with /link CODE. */
  function createLinkCode(driverId) {
    requireDriver(driverId);
    const code = String(crypto.randomInt(100000, 1000000));
    db.prepare('UPDATE drivers SET link_code = ? WHERE id = ?').run(code, driverId);
    return code;
  }

  function linkTelegram(code, chatId) {
    const d = db.prepare('SELECT * FROM drivers WHERE link_code = ?').get(String(code));
    if (!d) return null;
    db.prepare('UPDATE drivers SET telegram_chat_id = ?, link_code = NULL WHERE id = ?').run(chatId, d.id);
    return requireDriver(d.id);
  }

  function driverByChat(chatId) {
    return db.prepare('SELECT * FROM drivers WHERE telegram_chat_id = ?').get(chatId) ?? null;
  }

  function truckForDriver(driverId) {
    return db.prepare('SELECT * FROM trucks WHERE driver_id = ? LIMIT 1').get(driverId) ?? null;
  }

  // ---------- Trucks ----------
  function listTrucks() {
    return db.prepare(`
      SELECT t.*, d.name AS driver_name,
        (SELECT i.id FROM inspections i
           WHERE i.truck_id = t.id AND i.status = 'in_progress'
           ORDER BY i.id DESC LIMIT 1) AS open_inspection_id,
        (SELECT i.id FROM inspections i
           WHERE i.truck_id = t.id AND i.status != 'in_progress'
           ORDER BY i.id DESC LIMIT 1) AS last_inspection_id
      FROM trucks t
      LEFT JOIN drivers d ON d.id = t.driver_id
      ORDER BY t.unit`).all();
  }

  /** A driver can drive one truck at a time, so the previous truck is cleared. */
  async function assignDriver(truckId, driverId) {
    const truck = requireTruck(truckId);
    const driver = driverId == null ? null : requireDriver(Number(driverId));
    db.exec('BEGIN');
    try {
      if (driver) db.prepare('UPDATE trucks SET driver_id = NULL WHERE driver_id = ?').run(driver.id);
      db.prepare('UPDATE trucks SET driver_id = ? WHERE id = ?').run(driver ? driver.id : null, truck.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    if (driver?.telegram_chat_id && notifier.enabled) {
      await safe(() => notifier.sendMessage(
        driver.telegram_chat_id,
        `You're assigned to truck ${truck.unit}${truck.plate ? ` (${truck.plate})` : ''}.\nSend /inspect when you're ready for the readiness check.`,
      ), log, 'assignment notice');
    }
    return listTrucks().find((t) => t.id === truck.id);
  }

  // ---------- Inspections ----------
  /** Reuses the open inspection for a truck, otherwise creates one. */
  function startInspection(truckId, driverId = null) {
    const truck = requireTruck(truckId);
    const open = db.prepare("SELECT * FROM inspections WHERE truck_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1").get(truckId);
    if (open) return { id: open.id, token: open.token, url: inspectionUrl(open), reused: true };

    const token = crypto.randomBytes(24).toString('base64url');
    const r = db.prepare('INSERT INTO inspections (token, truck_id, driver_id) VALUES (?, ?, ?)')
      .run(token, truckId, driverId ?? truck.driver_id ?? null);
    const created = requireInspection(Number(r.lastInsertRowid));
    return { id: created.id, token, url: inspectionUrl(created), reused: false };
  }

  function inspectionTokenMatches(id, token) {
    const row = inspectionRow(id);
    return Boolean(row) && safeEqual(token, row.token);
  }

  function getInspection(id) {
    const insp = requireInspection(id);
    const truck = truckRow(insp.truck_id);
    const driver = insp.driver_id ? driverRow(insp.driver_id) : null;
    const photos = Object.fromEntries(
      db.prepare('SELECT slot FROM photos WHERE inspection_id = ?').all(id).map((p) => [p.slot, true]),
    );
    const answers = JSON.parse(insp.checklist || '{}');
    const evaluation = evaluateChecklist(answers);
    const missingPhotos = REQUIRED_PHOTOS.filter((s) => !photos[s]);

    return {
      id: insp.id,
      status: insp.status,
      createdAt: insp.created_at,
      completedAt: insp.completed_at,
      odometer: insp.odometer,
      notes: insp.notes,
      tmsRef: insp.tms_ref,
      tmsError: insp.tms_error,
      truck: truck && {
        id: truck.id, unit: truck.unit, plate: truck.plate, vin: truck.vin,
        make: truck.make, model: truck.model, year: truck.year, readiness: truck.readiness,
      },
      driver: driver && { id: driver.id, name: driver.name, phone: driver.phone },
      checklist: { template: CHECKLIST, answers },
      photos,
      photoSlots: PHOTO_SLOTS,
      requiredPhotos: REQUIRED_PHOTOS,
      missingPhotos,
      evaluation,
      canComplete: evaluation.unanswered.length === 0 && missingPhotos.length === 0,
    };
  }

  function saveChecklist(id, { answers, odometer, notes } = {}) {
    requireOpen(id);
    const clean = {};
    if (answers && typeof answers === 'object') {
      for (const [k, v] of Object.entries(answers)) {
        if (VALID_ITEM_KEYS.has(k) && VALID_ANSWERS.has(v)) clean[k] = v;
      }
    }
    const odo = odometer === '' || odometer == null ? null : Number(odometer);
    const odoValue = Number.isInteger(odo) && odo >= 0 && odo <= 9999999 ? odo : null;
    db.prepare('UPDATE inspections SET checklist = ?, odometer = ?, notes = ? WHERE id = ?')
      .run(JSON.stringify(clean), odoValue, clip(notes, 2000), id);
    return getInspection(id);
  }

  function savePhoto(id, slot, dataUrl) {
    requireOpen(id);
    if (!PHOTO_SLOTS[slot]) throw httpError(400, `Unknown photo slot: ${slot}`);
    const m = typeof dataUrl === 'string' ? DATA_URL.exec(dataUrl) : null;
    if (!m) throw httpError(400, 'Photo must be a JPEG, PNG or WebP image');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) throw httpError(400, 'Photo is empty');
    if (buf.length > MAX_PHOTO_BYTES) throw httpError(413, 'Photo is too large');

    const dir = path.join(uploadsDir, String(id));
    fs.mkdirSync(dir, { recursive: true });
    for (const ext of Object.values(EXT)) fs.rmSync(path.join(dir, `${slot}.${ext}`), { force: true });
    const file = `${slot}.${EXT[m[1]]}`;
    fs.writeFileSync(path.join(dir, file), buf);

    db.prepare(`INSERT INTO photos (inspection_id, slot, file) VALUES (?, ?, ?)
      ON CONFLICT (inspection_id, slot) DO UPDATE SET file = excluded.file, created_at = datetime('now')`)
      .run(id, slot, file);
    return getInspection(id);
  }

  function photoFile(id, slot) {
    const row = db.prepare('SELECT file FROM photos WHERE inspection_id = ? AND slot = ?').get(id, slot);
    if (!row) throw httpError(404, 'Photo not found');
    const full = path.join(uploadsDir, String(id), row.file);
    if (!fs.existsSync(full)) throw httpError(404, 'Photo file missing');
    return { path: full, type: MIME[path.extname(row.file).slice(1)] ?? 'application/octet-stream' };
  }

  /** Photos in display order, for Telegram albums. */
  function photoFiles(id) {
    return Object.keys(PHOTO_SLOTS)
      .filter((slot) => db.prepare('SELECT 1 FROM photos WHERE inspection_id = ? AND slot = ?').get(id, slot))
      .map((slot) => ({ slot, path: photoFile(id, slot).path }));
  }

  function buildTmsPayload(d) {
    return {
      externalId: `inspection-${d.id}`,
      date: d.completedAt,
      truckTmsId: truckRow(d.truck.id)?.tms_id ?? null,
      truckUnit: d.truck.unit,
      driverTmsId: d.driver ? driverRow(d.driver.id)?.tms_id ?? null : null,
      result: d.status,
      odometer: d.odometer,
      failedItems: d.evaluation.failed.map((f) => f.label),
      notes: d.notes,
      reportUrl: reportUrl(d.id),
    };
  }

  async function notifyCompleted(d) {
    if (!notifier.enabled) return;
    const failed = d.evaluation.failed.map((f) => `• ${f.label}${f.critical ? ' (critical)' : ''}`).join('\n') || '• None';
    const summary = `Truck ${d.truck.unit} — ${STATUS_LABEL[d.status]}\nDriver: ${d.driver?.name ?? '—'}\nOdometer: ${d.odometer ?? '—'}\nFailed items:\n${failed}`;

    if (d.driver) {
      const chat = driverRow(d.driver.id)?.telegram_chat_id;
      if (chat) await safe(() => notifier.sendMessage(chat, `Inspection complete.\n${summary}`), log, 'driver notice');
    }
    if (notifier.dispatchChatId) {
      await safe(() => notifier.sendMessage(notifier.dispatchChatId, `${summary}\nReport: ${reportUrl(d.id)}`), log, 'dispatch notice');
      // Telegram albums hold at most 10 photos, so send the set in chunks.
      const files = photoFiles(d.id);
      for (let i = 0; i < files.length; i += 10) {
        await safe(() => notifier.sendPhotos(notifier.dispatchChatId, files.slice(i, i + 10), `Truck ${d.truck.unit} · inspection #${d.id}`), log, 'dispatch photos');
      }
    }
  }

  async function completeInspection(id) {
    const insp = requireInspection(id);
    if (insp.status !== 'in_progress') throw httpError(409, 'Inspection is already completed');
    const d = getInspection(id);
    if (!d.canComplete) {
      throw httpError(409, 'Inspection is incomplete', {
        missingChecklist: d.evaluation.unanswered,
        missingPhotos: d.missingPhotos,
      });
    }
    const status = d.evaluation.status;
    db.prepare("UPDATE inspections SET status = ?, completed_at = datetime('now') WHERE id = ?").run(status, id);
    db.prepare("UPDATE trucks SET readiness = ?, last_inspection_at = datetime('now') WHERE id = ?").run(status, insp.truck_id);

    const done = getInspection(id);
    if (tms.enabled) {
      try {
        const ref = await tms.pushInspection(buildTmsPayload(done));
        db.prepare('UPDATE inspections SET tms_ref = ?, tms_error = NULL WHERE id = ?').run(ref == null ? null : String(ref), id);
      } catch (e) {
        log.error('TMS push failed:', e.message);
        db.prepare('UPDATE inspections SET tms_error = ? WHERE id = ?').run(e.message, id);
      }
    }
    await notifyCompleted(done);
    return getInspection(id);
  }

  function listInspections(truckId = null) {
    const base = `SELECT i.id, i.status, i.created_at, i.completed_at, t.unit
      FROM inspections i JOIN trucks t ON t.id = i.truck_id`;
    return truckId
      ? db.prepare(`${base} WHERE i.truck_id = ? ORDER BY i.id DESC LIMIT 50`).all(truckId)
      : db.prepare(`${base} ORDER BY i.id DESC LIMIT 50`).all();
  }

  // ---------- TMS sync (pull master data from DataTruck) ----------
  async function syncFromTms() {
    if (!tms.enabled) throw httpError(400, 'TMS is not configured (set TMS_BASE_URL and TMS_API_KEY)');
    const [drivers, trucks] = await Promise.all([tms.listDrivers(), tms.listTrucks()]);

    db.exec('BEGIN');
    try {
      for (const d of drivers) {
        const ex = db.prepare('SELECT id FROM drivers WHERE tms_id = ?').get(d.tmsId);
        if (ex) db.prepare('UPDATE drivers SET name = ?, phone = ? WHERE id = ?').run(d.name, d.phone ?? '', ex.id);
        else db.prepare('INSERT INTO drivers (tms_id, name, phone) VALUES (?, ?, ?)').run(d.tmsId, d.name, d.phone ?? '');
      }
      for (const t of trucks) {
        const driverId = t.driverTmsId
          ? db.prepare('SELECT id FROM drivers WHERE tms_id = ?').get(t.driverTmsId)?.id ?? null
          : null;
        const ex = db.prepare('SELECT id FROM trucks WHERE tms_id = ? OR unit = ?').get(t.tmsId, t.unit);
        if (ex) {
          db.prepare(`UPDATE trucks SET tms_id = ?, unit = ?, plate = ?, vin = ?, make = ?, model = ?, year = ?,
              driver_id = COALESCE(?, driver_id) WHERE id = ?`)
            .run(t.tmsId, t.unit, t.plate ?? null, t.vin ?? null, t.make ?? null, t.model ?? null, t.year ?? null, driverId, ex.id);
        } else {
          db.prepare(`INSERT INTO trucks (tms_id, unit, plate, vin, make, model, year, driver_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(t.tmsId, t.unit, t.plate ?? null, t.vin ?? null, t.make ?? null, t.model ?? null, t.year ?? null, driverId);
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { drivers: drivers.length, trucks: trucks.length };
  }

  return {
    listDrivers, createDriver, createLinkCode, linkTelegram, driverByChat, truckForDriver,
    listTrucks, assignDriver,
    startInspection, inspectionTokenMatches, getInspection, saveChecklist, savePhoto,
    photoFile, completeInspection, listInspections, syncFromTms,
  };
}
