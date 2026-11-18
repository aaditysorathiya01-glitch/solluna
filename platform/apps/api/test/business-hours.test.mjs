// Working hours (Mon–Sat 10:00–19:00 IST): open/closed and the next opening, independent of the server's time zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
process.env.BUSINESS_HOURS = '1-6 10:00-19:00';
const require = createRequire(import.meta.url);
const { isOpen, nextOpen } = require('../dist/apps/api/src/common/business-hours.js');
const ist = (s) => new Date(`${s}+05:30`);

test('working hours: open, closed, next opening', () => {
  assert.equal(isOpen(ist('2026-11-18T10:00:00')), true, 'Wed 10:00 open');
  assert.equal(isOpen(ist('2026-11-18T18:59:00')), true);
  assert.equal(isOpen(ist('2026-11-18T19:00:00')), false, 'closes at 19:00');
  assert.equal(isOpen(ist('2026-11-18T09:59:00')), false);
  assert.equal(isOpen(ist('2026-11-22T12:00:00')), false, 'Sunday closed');
  assert.equal(nextOpen(ist('2026-11-18T22:30:00')).toISOString(), ist('2026-11-19T10:00:00').toISOString(), 'night → next morning');
  assert.equal(nextOpen(ist('2026-11-18T07:00:00')).toISOString(), ist('2026-11-18T10:00:00').toISOString(), 'early morning → same day');
  assert.equal(nextOpen(ist('2026-11-21T20:00:00')).toISOString(), ist('2026-11-23T10:00:00').toISOString(), 'Saturday night → Monday');
  assert.equal(nextOpen(ist('2026-11-22T11:00:00')).toISOString(), ist('2026-11-23T10:00:00').toISOString(), 'Sunday → Monday');
  const now = ist('2026-11-18T12:00:00');
  assert.equal(nextOpen(now), now, 'open now → now');
});
