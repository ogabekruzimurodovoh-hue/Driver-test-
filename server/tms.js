import { httpError } from './util.js';

// DataTruck's public API docs were not available when this was written, so field
// names are matched tolerantly. Confirm the real response shape with DataTruck
// support and adjust the picks below if needed.

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};
const str = (v) => (v === undefined ? undefined : String(v));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const listOf = (body) => (Array.isArray(body) ? body : body?.data ?? body?.items ?? body?.results ?? []);

export function normalizeDriver(raw) {
  const joined = [pick(raw, 'firstName', 'first_name'), pick(raw, 'lastName', 'last_name')]
    .filter(Boolean)
    .join(' ');
  const name = str(pick(raw, 'name', 'fullName', 'full_name', 'driverName')) ?? joined;
  return {
    tmsId: str(pick(raw, 'id', 'driverId', 'driver_id')),
    name: name.trim(),
    phone: str(pick(raw, 'phone', 'phoneNumber', 'mobile')) ?? '',
  };
}

export function normalizeTruck(raw) {
  return {
    tmsId: str(pick(raw, 'id', 'truckId', 'truck_id')),
    unit: str(pick(raw, 'unitNumber', 'unit', 'unit_number', 'truckNumber')),
    plate: str(pick(raw, 'plate', 'licensePlate', 'license_plate')),
    vin: str(pick(raw, 'vin', 'VIN')),
    make: str(pick(raw, 'make')),
    model: str(pick(raw, 'model')),
    year: num(pick(raw, 'year')),
    driverTmsId: str(pick(raw, 'driverId', 'driver_id', 'assignedDriverId')),
  };
}

/**
 * Returns an object with enabled/listDrivers/listTrucks/pushInspection.
 * When TMS_BASE_URL or TMS_API_KEY is missing the client is disabled and
 * the app works standalone.
 */
export function createTmsClient(cfg, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!cfg.baseUrl || !cfg.apiKey) {
    return {
      enabled: false,
      async listDrivers() { return []; },
      async listTrucks() { return []; },
      async pushInspection() { return null; },
    };
  }

  const base = cfg.baseUrl.replace(/\/+$/, '');

  async function request(method, path, body) {
    const res = await fetchImpl(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw httpError(502, `TMS ${method} ${path} failed with HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  return {
    enabled: true,
    async listDrivers() {
      const body = await request('GET', cfg.driversPath);
      return listOf(body).map(normalizeDriver).filter((d) => d.tmsId && d.name);
    },
    async listTrucks() {
      const body = await request('GET', cfg.trucksPath);
      return listOf(body).map(normalizeTruck).filter((t) => t.tmsId && t.unit);
    },
    async pushInspection(payload) {
      const body = await request('POST', cfg.inspectionsPath, payload);
      return body?.id ?? body?.ref ?? null;
    },
  };
}
