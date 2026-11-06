import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allItems, evaluateChecklist } from '../server/checklist.js';

const allPass = () => Object.fromEntries(allItems().map((i) => [i.key, 'pass']));

test('all items passed -> ready', () => {
  const r = evaluateChecklist(allPass());
  assert.equal(r.status, 'ready');
  assert.deepEqual(r.unanswered, []);
  assert.deepEqual(r.failed, []);
});

test('unanswered items keep the inspection in progress', () => {
  const answers = allPass();
  delete answers.horn;
  const r = evaluateChecklist(answers);
  assert.equal(r.status, 'in_progress');
  assert.deepEqual(r.unanswered, ['horn']);
});

test('non-critical failure -> needs_attention', () => {
  const r = evaluateChecklist({ ...allPass(), horn: 'fail' });
  assert.equal(r.status, 'needs_attention');
  assert.equal(r.failed[0].key, 'horn');
  assert.equal(r.failed[0].critical, false);
});

test('critical failure -> out_of_service', () => {
  const r = evaluateChecklist({ ...allPass(), service_brakes: 'fail' });
  assert.equal(r.status, 'out_of_service');
  assert.equal(r.failed[0].critical, true);
});

test('N/A counts as answered and does not fail the truck', () => {
  const r = evaluateChecklist({ ...allPass(), warning_triangles: 'na' });
  assert.equal(r.status, 'ready');
});

test('checklist item keys are unique', () => {
  const keys = allItems().map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('360 walk-around has 12 photos at 30° steps, with the four sides required', async () => {
  const { EXTERIOR_RING, PHOTO_GROUPS, REQUIRED_PHOTOS, PHOTO_SLOTS } = await import('../server/checklist.js');
  assert.equal(EXTERIOR_RING.length, 12);
  assert.deepEqual(EXTERIOR_RING.map((p) => p.angle), [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]);
  const ringSlots = EXTERIOR_RING.map((p) => p.slot);
  assert.equal(new Set(ringSlots).size, 12);
  for (const s of ['front', 'right', 'rear', 'left']) {
    assert.ok(ringSlots.includes(s) && REQUIRED_PHOTOS.includes(s));
  }
  assert.equal(PHOTO_GROUPS[0].slots.length, 12);
  for (const s of ringSlots) assert.ok(PHOTO_SLOTS[s], `label for ${s}`);
});
