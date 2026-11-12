const test = require('node:test');
const assert = require('node:assert/strict');
const Ledger = require('../src/ledger');

function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get(keys, cb) {
      const result = {};
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(store, k)) {
          result[k] = structuredClone(store[k]);
        }
      }
      cb(result);
    },
    set(items, cb) {
      for (const [k, v] of Object.entries(items)) {
        store[k] = structuredClone(v);
      }
      if (cb) cb();
    }
  };
}

test('Ledger: default 50/50 split starts with 900s (15 min) grace buffer', () => {
  const allowance = Ledger.computeEntertainmentAllowance(0, 0, 50, 900);
  assert.equal(allowance, 900);

  const stats = Ledger.computeSplitStats({
    educationalSeconds: 0,
    entertainmentSeconds: 0,
    targetEduPct: 50,
    graceBufferSeconds: 900
  });
  assert.equal(stats.remainingBankSeconds, 900);
  assert.equal(stats.isDepleted, false);
  assert.equal(stats.actualEduPct, 50);
  assert.equal(stats.actualEntPct, 50);
});

test('Ledger: 50/50 ratio accrues 1s entertainment per 1s educational and depletes at 0:00', () => {
  // Watch 600s (10m) educational -> bank becomes 900 + 600 = 1500s (25m)
  const allowanceAfterEdu = Ledger.computeEntertainmentAllowance(600, 0, 50, 900);
  assert.equal(allowanceAfterEdu, 1500);

  // Watch 1500s (25m) entertainment -> bank reaches exactly 0
  const statsAtZero = Ledger.computeSplitStats({
    educationalSeconds: 600,
    entertainmentSeconds: 1500,
    targetEduPct: 50,
    graceBufferSeconds: 900
  });
  assert.equal(statsAtZero.allowanceSeconds, 0);
  assert.equal(statsAtZero.remainingBankSeconds, 0);
  assert.equal(statsAtZero.isDepleted, true);
  assert.equal(statsAtZero.eduSecondsToUnlockOneMin, 60);
  assert.equal(statsAtZero.eduSecondsToUnlockFiveMin, 300);
});

test('Ledger: supports custom ratio splits (80/20 and 20/80)', () => {
  // 80% Educational / 20% Entertainment -> multiplier is (100 - 80) / 80 = 0.25
  // 1200s (20m) educational earns 300s (5m) entertainment
  const allowance80 = Ledger.computeEntertainmentAllowance(1200, 900, 80, 900);
  assert.equal(allowance80, 300);

  // If depleted at 80/20, unlocking 60s of entertainment requires 240s (4m) of educational time
  const needed80 = Ledger.computeEducationalNeededToUnlock(0, 900, 80, 900, 60);
  assert.equal(needed80, 240);

  // 20% Educational / 80% Entertainment -> multiplier is (100 - 20) / 20 = 4.0
  // 300s (5m) educational earns 1200s (20m) entertainment
  const allowance20 = Ledger.computeEntertainmentAllowance(300, 900, 20, 900);
  assert.equal(allowance20, 1200);
});

test('Ledger: automatically resets counters at local midnight and preserves history in storage', async () => {
  const day1 = new Date(2026, 10, 10, 23, 50, 0); // 2026-11-10 23:50 local
  const day2 = new Date(2026, 10, 11, 0, 5, 0); // 2026-11-11 00:05 local

  const mockStorage = createMockStorage();

  // Accrue watch time on Day 1
  await Ledger.updateState(
    (state) => {
      let next = state;
      next = Ledger.recordWatchTime(next, 'educational', 1800, day1).state;
      next = Ledger.recordWatchTime(next, 'entertainment', 1200, day1).state;
      return next;
    },
    { storage: mockStorage, now: day1 }
  );

  const stateDay1 = await Ledger.loadState({ storage: mockStorage, now: day1 });
  assert.equal(stateDay1.currentDay.dateKey, '2026-11-10');
  assert.equal(stateDay1.currentDay.educationalSeconds, 1800);
  assert.equal(stateDay1.currentDay.entertainmentSeconds, 1200);

  // Load state after local midnight on Day 2
  const stateDay2 = await Ledger.loadState({ storage: mockStorage, now: day2 });
  assert.equal(stateDay2.currentDay.dateKey, '2026-11-11');
  assert.equal(stateDay2.currentDay.educationalSeconds, 0);
  assert.equal(stateDay2.currentDay.entertainmentSeconds, 0);

  // Verify Day 1 summary was preserved in history
  const archived = stateDay2.history['2026-11-10'];
  assert.ok(archived, 'Expected 2026-11-10 summary in state.history');
  assert.equal(archived.educationalSeconds, 1800);
  assert.equal(archived.entertainmentSeconds, 1200);
  assert.equal(archived.actualEduPct, 60);
  assert.equal(archived.actualEntPct, 40);
});
