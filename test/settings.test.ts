import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerce, defaults, warnings } from '../src/settings/dsl.ts';
import { presetSchema, appSchema } from '../src/settings/schema.ts';
import { buildPlan } from '../src/schedule/planner.ts';

test('defaults are valid and coerce is idempotent', () => {
  const d = defaults(presetSchema);
  assert.deepEqual(coerce(presetSchema, d), d);
  assert.equal(d.engagement.like.enabled, false, 'engagement off by default');
  assert.equal(d.engagement.comment.requireApproval, true);
  const a = defaults(appSchema);
  assert.equal(a.general.timezone, 'Asia/Kuala_Lumpur');
});

test('coerce repairs bad input and drops unknown keys', () => {
  const v = coerce(presetSchema, { watch: { behaviour: { strictness: 99, glanceFrames: 'abc' }, hacker: 1 }, schedule: { windows: { mon: [{ start: '25:00', end: '10:00' }, { start: '08:00', end: '09:00' }] } }, engagement: { comment: { requireApproval: false } } });
  assert.equal(v.watch.behaviour.strictness, 10);
  assert.equal(v.watch.behaviour.glanceFrames, 3);
  assert.equal(v.watch.hacker, undefined);
  assert.deepEqual(v.schedule.windows.mon, [{ start: '08:00', end: '09:00' }]);
  assert.equal(v.engagement.comment.requireApproval, true, 'locked field cannot be turned off');
});

test('warns above 4 hours per day', () => {
  const v = coerce(presetSchema, { schedule: { dailyMinutes: 300 } });
  assert.ok(warnings(presetSchema, v).some(w => w.path === 'schedule.dailyMinutes'));
});

test('planner fits sessions in windows with breaks', () => {
  const data = coerce(presetSchema, { schedule: { dailyMinutes: 90, sessions: 3, breakMinutes: 30, jitter: false, windows: { mon: [{ start: '09:00', end: '12:00' }] } } });
  const plan = buildPlan('2026-11-23', 'mon', { id: 'x', name: 'x', data });
  assert.deepEqual(plan.entries.map(e => [e.start, e.end]), [['09:00', '09:30'], ['10:00', '10:30'], ['11:00', '11:30']]);
  const tight = coerce(presetSchema, { schedule: { dailyMinutes: 300, sessions: 2, breakMinutes: 0, jitter: false, windows: { mon: [{ start: '09:00', end: '10:00' }] } } });
  const p2 = buildPlan('2026-11-23', 'mon', { id: 'x', name: 'x', data: tight });
  assert.equal(p2.plannedMinutes, 60);
  assert.ok(p2.warnings.length >= 2);
});
