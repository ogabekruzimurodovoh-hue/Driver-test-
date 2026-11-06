import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTmsClient, normalizeDriver, normalizeTruck } from '../server/tms.js';

test('normalizeTruck accepts common field names', () => {
  const t = normalizeTruck({ id: 77, unitNumber: '101', licensePlate: 'ABC-1', make: 'Volvo', year: '2020', driverId: 5 });
  assert.deepEqual(t, {
    tmsId: '77', unit: '101', plate: 'ABC-1', vin: undefined, make: 'Volvo',
    model: undefined, year: 2020, driverTmsId: '5',
  });
});

test('normalizeDriver builds a name from first/last name', () => {
  const d = normalizeDriver({ driverId: 'D-9', firstName: 'Alex', lastName: 'Morgan', phoneNumber: '+1 555' });
  assert.equal(d.tmsId, 'D-9');
  assert.equal(d.name, 'Alex Morgan');
  assert.equal(d.phone, '+1 555');
});

test('disabled client (no URL/key) is a safe no-op', async () => {
  const tms = createTmsClient({ baseUrl: '', apiKey: '' });
  assert.equal(tms.enabled, false);
  assert.deepEqual(await tms.listTrucks(), []);
  assert.equal(await tms.pushInspection({}), null);
});

test('http client sends bearer auth, unwraps {data:[]} and filters incomplete rows', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, method: init.method });
    return new Response(JSON.stringify({
      data: [{ id: 1, unitNumber: '101' }, { id: null, unitNumber: 'x' }, { id: 2 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const tms = createTmsClient(
    { baseUrl: 'https://tms.example.com/api/', apiKey: 'k123', trucksPath: '/trucks', driversPath: '/d', inspectionsPath: '/i' },
    { fetchImpl },
  );
  const trucks = await tms.listTrucks();
  assert.equal(calls[0].url, 'https://tms.example.com/api/trucks');
  assert.equal(calls[0].auth, 'Bearer k123');
  assert.equal(trucks.length, 1);
  assert.equal(trucks[0].unit, '101');
});

test('http client raises on non-2xx responses', async () => {
  const tms = createTmsClient(
    { baseUrl: 'https://tms.example.com', apiKey: 'k', trucksPath: '/t', driversPath: '/d', inspectionsPath: '/i' },
    { fetchImpl: async () => new Response('nope', { status: 401 }) },
  );
  await assert.rejects(() => tms.listDrivers(), /HTTP 401/);
});
