import assert from 'node:assert/strict';
import test from 'node:test';
import {SyncSchedule, syncPreferences} from '../../wwwroot/sync-schedule.js';
import {isSyncKey} from '../../wwwroot/sync-engine.js';

function clock(t, preferences) {
  t.mock.timers.enable({apis:['Date', 'setTimeout'], now:1000000});
  const exchanges = [];
  const schedule = new SyncSchedule(() => {
    schedule.begin();
    exchanges.push(Date.now());
  });
  const options = syncPreferences(preferences);
  schedule.configure(true, options);
  schedule.setAvailable(true);
  function finish() {
    schedule.finish();
    schedule.setAvailable(true);
  }
  return {schedule, exchanges, finish, tick:ms => t.mock.timers.tick(ms)};
}

test('existing installations keep debounced edits and checks for remote edits', t => {
  const {schedule, exchanges, finish, tick} = clock(t);
  schedule.changed();
  tick(1200);
  schedule.changed();
  tick(1700);
  assert.equal(exchanges.length, 0);
  tick(100);
  assert.equal(exchanges.length, 1);
  finish();
  tick(90000);
  assert.equal(exchanges.length, 2);
});

test('timer-only mode ignores typing, checks an idle disk and combines missed ticks on resume', t => {
  const {schedule, exchanges, finish, tick} = clock(t, {onChange:false, timer:true, minutes:5});
  schedule.changed();
  tick(90000);
  assert.equal(exchanges.length, 0);
  schedule.setAvailable(false);
  tick(3 * 300000);
  assert.equal(exchanges.length, 0);
  schedule.setAvailable(true);
  tick(0);
  assert.equal(exchanges.length, 1);
  tick(600000); // A long-running exchange owns the single scheduler slot.
  assert.equal(exchanges.length, 1);
  finish();
  tick(299999);
  assert.equal(exchanges.length, 1);
  tick(1);
  assert.equal(exchanges.length, 2);
});

test('on-change and timer share one exchange, including a change pending at the deadline', t => {
  const {schedule, exchanges, finish, tick} = clock(t, {onChange:true, timer:true, minutes:1});
  tick(59000);
  schedule.changed();
  tick(1000);
  assert.equal(exchanges.length, 1);
  finish();
  tick(1800);
  assert.equal(exchanges.length, 1);
  schedule.changed();
  tick(1800);
  assert.equal(exchanges.length, 2);
});

test('manual-only settings and disconnect cancel alarms, reconnect can catch up from a saved timestamp', t => {
  const {schedule, exchanges, tick} = clock(t);
  const timer = syncPreferences({onChange:false, timer:true, minutes:15});
  schedule.changed();
  schedule.configure(true, syncPreferences({onChange:false}));
  schedule.changed();
  tick(120000);
  assert.equal(exchanges.length, 0);
  schedule.configure(true, timer);
  schedule.configure(false, timer);
  const previousCheck = Date.now();
  tick(900000);
  assert.equal(exchanges.length, 0);
  schedule.configure(true, timer, previousCheck);
  tick(0);
  assert.equal(exchanges.length, 1);
});

test('timer preferences and check timestamps belong to the device', () => {
  assert.deepEqual(syncPreferences({minutes:-1, timer:'yes'}), {onChange:true, timer:false, minutes:5});
  assert.equal(isSyncKey('sync-auto-settings'), false);
  assert.equal(isSyncKey('sync-last-check/google'), false);
  assert.equal(isSyncKey('sync-last-check/yandex'), false);
});

test('an exchange interrupted by a dropped network retries once when the disk is reachable', t => {
  const {schedule, exchanges, finish, tick} = clock(t, {onChange:false, timer:true, minutes:1});
  tick(60000);
  assert.equal(exchanges.length, 1);
  schedule.finish(true);
  tick(1000);
  assert.equal(exchanges.length, 1);
  schedule.setAvailable(true);
  tick(0);
  assert.equal(exchanges.length, 2);
  finish();
  tick(1000);
  assert.equal(exchanges.length, 2);
});
