'use strict';
const assert = require('assert');
const E = require('../engine/triage-engine.js');
const { runTriageEngine: run, splitBlocks, capacityAvail, capacityUsable, capacityUpTo } = E;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n').slice(0, 6).join('\n      ')); }
}

// ---------------------------------------------------------------- helpers
const mk = (id, o) => ({ id, name: id, seq: o.seq === undefined ? 0 : o.seq, deadlineDay: o.day, deadlineTime: o.time,
  estimate: o.est, completed: o.done || 0, importance: o.imp === undefined ? 3 : o.imp, allOrNothing: !!o.aon, status: o.status });
const st = (cap, tasks, now) => ({ now: now === undefined ? 900 : now, capacity: cap, tasks });
const row = (res, id) => res.tasks.find((t) => t.id === id);
const alloc = (res) => Object.fromEntries(res.tasks.map((t) => [t.id, t.allocated]));
const blk = (res) => res.blocks.map((b) => b.day + ':' + b.taskId + ':' + b.minutes);
const gaps = (gs) => gs.map((g) => g.gap);
const clone = (x) => JSON.parse(JSON.stringify(x));
const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };

const demoTasks = (extra) => {
  const t = [
    mk('math_hw', { seq: 1, day: 1, time: 480, est: 45, imp: 3, aon: true }),
    mk('physics', { seq: 2, day: 2, est: 60, imp: 2 }),
    mk('english', { seq: 3, day: 3, est: 90, imp: 3 }),
    mk('quiz', { seq: 4, day: 4, est: 60, imp: 4 }),
    mk('biology', { seq: 5, day: 5, est: 150, imp: 5 }),
    mk('chem', { seq: 6, day: 6, est: 45, imp: 3 }),
    mk('history', { seq: 7, day: 8, est: 150, imp: 4 }),
  ];
  if (extra) Object.entries(extra).forEach(([id, done]) => { t.find((x) => x.id === id).completed = done; });
  return t;
};
const DEMO_CAP = [120, 60, 60, 0, 60, 60, 60, 0, 60];

// ================================================================= CAPACITY
test('Capacity-01 current day partial, deadline today 20:00', () => {
  const s = st([120], [], 1080);
  assert.strictEqual(capacityAvail(s, 0), 120);
  assert.strictEqual(capacityUsable(s, 0, 1200), 60);
});
test('Capacity-02 deadline tomorrow 08:00 -> only tonight', () => {
  assert.strictEqual(capacityUpTo(st([30, 60], [], 1230), { day: 1, time: 480 }), 30);
});
test('Capacity-03 same, date only -> tonight + whole tomorrow', () => {
  assert.strictEqual(capacityUpTo(st([30, 60], [], 1230), { day: 1, time: 1320 }), 90);
});
test('Capacity-04 deadline tomorrow 18:30', () => {
  assert.strictEqual(capacityUpTo(st([30, 60], [], 1230), { day: 1, time: 1110 }), 60);
});
test('Capacity-05 future day capped by window (420)', () => {
  assert.strictEqual(capacityAvail(st([0, 500], []), 1), 420);
});
test('Capacity-06 now after 22:00 -> 0', () => {
  assert.strictEqual(capacityAvail(st([60], [], 1350), 0), 0);
});
test('Capacity-07 capacity 37 never rounded to 35 (floor only in usable)', () => {
  const s = st([0, 37], []);
  assert.strictEqual(capacityAvail(s, 1), 37);
  assert.strictEqual(capacityUsable(s, 1, 1080), 15);      // floor(37*180/420)
  assert.strictEqual(capacityUpTo(s, { day: 1, time: 1320 }), 37);
});
test('Capacity-08 capacity 10 stays 10', () => assert.strictEqual(capacityUpTo(st([10], []), { day: 0, time: 1320 }), 10));
test('Capacity-09 zero-capacity day', () => assert.strictEqual(capacityUpTo(st([60, 0, 60], []), { day: 2, time: 1320 }), 120));
test('Capacity-10 future day with time', () => assert.strictEqual(capacityUsable(st([0, 60], []), 1, 900 + 210), 30));
test('Capacity-11 now before window start uses 15:00', () => assert.strictEqual(capacityAvail(st([500], [], 600), 0), 420));

// ================================================================= SPLIT
test('Split-01 deterministic block splitting', () => {
  const cases = { 45: [45], 55: [30, 25], 65: [35, 30], 75: [40, 35], 95: [50, 45], 105: [35, 35, 35], 60: [30, 30], 10: [10], 101: [34, 34, 33], 120: [40, 40, 40], 100: [50, 50] };
  Object.entries(cases).forEach(([g, exp]) => assert.deepStrictEqual(splitBlocks(+g), exp, 'g=' + g));
});

// ================================================================= SCHEDULER
test('Scheduler-01 task 20 + capacity 30 -> block 20 (never 5)', () => {
  const r = run(st([30, 0], [mk('x', { day: 1, est: 20 })]));
  assert.deepStrictEqual(blk(r), ['0:x:20']); assert.strictEqual(r.status, 'verified');
});
test('Scheduler-02 task 50, 40 today, 60 tomorrow -> 40 + 10 (finishes)', () => {
  assert.deepStrictEqual(blk(run(st([40, 60], [mk('x', { day: 1, est: 50 })]))), ['0:x:40', '1:x:10']);
});
test('Scheduler-03 10 min capacity + 10 min task', () => {
  assert.deepStrictEqual(blk(run(st([10], [mk('x', { day: 0, est: 10 })]))), ['0:x:10']);
});
test('Scheduler-04 10 min today skipped, 30 tomorrow used', () => {
  const r = run(st([10, 30], [mk('x', { day: 1, est: 30 })]));
  assert.deepStrictEqual(blk(r), ['1:x:30']); assert.strictEqual(r.days[0].flex, 10);
});
test('Scheduler-05 task 45 with split capacities 10/60', () => {
  assert.deepStrictEqual(blk(run(st([10, 60], [mk('x', { day: 1, est: 45 })]))), ['1:x:45']);
});
test('Scheduler-06 Gap<=0 but fragmentation -> At risk, unplaced 5 (documented limitation)', () => {
  const r = run(st([10, 40], [mk('x', { day: 1, est: 45 })]));
  assert.strictEqual(gaps(r.gapsFinal)[0], -5);
  assert.deepStrictEqual(blk(r), ['1:x:40']);
  assert.strictEqual(row(r, 'x').unplaced, 5); assert.strictEqual(r.status, 'atRisk');
});
test('Scheduler-07 same deadline: importance first, then seq', () => {
  const r = run(st([60, 0], [mk('a', { seq: 1, day: 1, est: 30, imp: 3 }), mk('b', { seq: 2, day: 1, est: 30, imp: 4 })]));
  assert.deepStrictEqual(blk(r), ['0:b:30', '0:a:30']);
});
test('Scheduler-08 same deadline, same importance: seq', () => {
  const r = run(st([60, 0], [mk('a', { seq: 2, day: 1, est: 30 }), mk('b', { seq: 1, day: 1, est: 30 })]));
  assert.deepStrictEqual(blk(r), ['0:b:30', '0:a:30']);
});
test('Scheduler-09 different deadline times on one day', () => {
  const r = run(st([0, 60], [mk('x', { seq: 1, day: 1, time: 1110, est: 30 }), mk('y', { seq: 2, day: 1, est: 30 })]));
  assert.deepStrictEqual(blk(r), ['1:x:30', '1:y:30']); assert.strictEqual(r.status, 'verified');
});
test('Scheduler-10 early-time deadline limits that task (Triage reduces 40->30)', () => {
  const r = run(st([0, 60], [mk('x', { day: 1, time: 1110, est: 40 })]));
  assert.strictEqual(row(r, 'x').allocated, 30); assert.deepStrictEqual(blk(r), ['1:x:30']);
});
test('Scheduler-11 max block 50', () => {
  assert.deepStrictEqual(blk(run(st([120], [mk('x', { day: 0, est: 120 })]))), ['0:x:40', '0:x:40', '0:x:40']);
});
test('Scheduler-12 10 min capacity + 30 min task due today -> deferred (honest)', () => {
  const r = run(st([10], [mk('x', { day: 0, est: 30 })]));
  assert.strictEqual(row(r, 'x').decision, 'deferred'); assert.strictEqual(r.status, 'verified');
});

// ================================================================= TRIAGE
// all single-deadline tests: tasks due day 1 (date only), capacity on day 0 only => C = cap[0]
const tri = (cap0, tasks) => run(st([cap0, 0], tasks.map((t) => ({ ...t, deadlineDay: 1 }))));
test('Triage-01 small gap 5', () => {
  const r = tri(5, [mk('x', { est: 10 })]);
  assert.strictEqual(row(r, 'x').allocated, 5); assert.strictEqual(row(r, 'x').decision, 'reduced');
});
test('Triage-A gap 10: reduce B, never cancel A', () => {
  const r = tri(100, [mk('A', { seq: 1, imp: 2, est: 10, aon: true }), mk('B', { seq: 2, imp: 2, est: 100 })]);
  assert.deepStrictEqual(alloc(r), { A: 10, B: 90 });
});
test('Triage-B gap 40', () => {
  const r = tri(90, [mk('A', { seq: 1, imp: 2, est: 30, aon: true }), mk('B', { seq: 2, imp: 2, est: 100 })]);
  assert.deepStrictEqual(alloc(r), { A: 30, B: 60 });
});
test('Triage-C1 gap 90: defer A whole, then reduce B', () => {
  const r = tri(60, [mk('A', { seq: 1, imp: 2, est: 60 }), mk('B', { seq: 2, imp: 3, est: 90 })]);
  assert.deepStrictEqual(alloc(r), { A: 0, B: 60 }); assert.strictEqual(row(r, 'A').decision, 'deferred');
});
test('Triage-C2 gap 140: defer both, waste is reported as negative gap', () => {
  const r = tri(10, [mk('A', { seq: 1, imp: 2, est: 60 }), mk('B', { seq: 2, imp: 3, est: 90 })]);
  assert.deepStrictEqual(alloc(r), { A: 0, B: 0 }); assert.strictEqual(r.gapsFinal[0].gap, -10);
});
test('Triage-D gap 60: several importance levels, 5 protected', () => {
  const r = tri(180, [mk('A', { seq: 1, imp: 5, est: 180 }), mk('B', { seq: 2, imp: 2, est: 40 }), mk('C', { seq: 3, imp: 1, est: 20 })]);
  assert.deepStrictEqual(alloc(r), { A: 180, B: 0, C: 0 }); assert.strictEqual(r.status, 'verified');
});
test('Triage-E gap 60: defer all-or-nothing A (cheapest), reduce B', () => {
  const r = tri(70, [mk('A', { seq: 1, imp: 2, est: 30, aon: true }), mk('B', { seq: 2, imp: 2, est: 100 })]);
  assert.deepStrictEqual(alloc(r), { A: 0, B: 70 });
});
test('Triage-F protected + insufficient pool -> Still impossible 20', () => {
  const r = tri(160, [mk('A', { seq: 1, imp: 5, est: 180 }), mk('B', { seq: 2, imp: 2, est: 40 })]);
  assert.strictEqual(r.status, 'impossible'); assert.strictEqual(r.stillImpossible.need, 20);
  assert.deepStrictEqual(alloc(r), { A: 180, B: 0 });
});
test('Triage-G only importance 5 -> Still impossible, nothing cut', () => {
  const r = tri(60, [mk('A', { seq: 1, imp: 5, est: 100 })]);
  assert.strictEqual(r.status, 'impossible'); assert.strictEqual(r.stillImpossible.need, 40); assert.strictEqual(r.summary.totalCut, 0);
});
test('Triage-H policy: partial preservation over full cancellation', () => {
  const r = tri(60, [mk('A', { seq: 1, imp: 2, est: 30, aon: true }), mk('B', { seq: 2, imp: 2, est: 20 }), mk('C', { seq: 3, imp: 2, est: 20 }), mk('D', { seq: 4, imp: 2, est: 20 })]);
  assert.deepStrictEqual(alloc(r), { A: 30, B: 10, C: 10, D: 10 });
});
test('Triage-I equal importance/size/deadline -> larger seq is cut first', () => {
  const r = tri(100, [mk('A', { seq: 1, est: 60 }), mk('B', { seq: 2, est: 60 })]);
  assert.deepStrictEqual(alloc(r), { A: 60, B: 40 });
});
test('Triage-J equal sizes, different deadlines -> later deadline cut first', () => {
  const r = run(st([100, 0, 0], [mk('X', { seq: 1, day: 1, est: 60 }), mk('Y', { seq: 2, day: 2, est: 60 })]));
  assert.deepStrictEqual(alloc(r), { X: 60, Y: 40 });
});
test('Triage-K a gap at an early deadline cannot be rescued by a later task (no carry needed)', () => {
  const r = run(st([120, 0, 0, 0, 0, 0], [mk('Exam', { seq: 1, day: 2, est: 180, imp: 5 }), mk('Read', { seq: 2, day: 5, est: 60, imp: 1 })]));
  assert.strictEqual(r.status, 'impossible'); assert.strictEqual(r.stillImpossible.need, 60); assert.strictEqual(row(r, 'Read').allocated, 60);
});
test('Triage-L all-or-nothing is never reduced', () => {
  const r = tri(30, [mk('H', { est: 45, aon: true })]);
  assert.strictEqual(row(r, 'H').allocated, 0); assert.strictEqual(row(r, 'H').decision, 'deferred');
});

// ================================================================= DEMO (golden)
test('Golden-Initial: 600 / 480 / shortfall 120', () => {
  const r = run(st(DEMO_CAP, demoTasks()));
  assert.strictEqual(r.summary.workload, 600); assert.strictEqual(r.summary.capacity, 480); assert.strictEqual(r.summary.shortfall, 120);
  assert.deepStrictEqual(gaps(r.gapsInitial), [-75, -135, -45, -45, 45, 30, 120]);
});
test('Golden-Triage: Physics 60->0, English 90->45, Chem 45->30, rest unchanged', () => {
  const r = run(st(DEMO_CAP, demoTasks()));
  assert.deepStrictEqual(alloc(r), { math_hw: 45, physics: 0, english: 45, quiz: 60, biology: 150, chem: 30, history: 150 });
  assert.strictEqual(r.summary.allocated, 480); assert.strictEqual(r.summary.totalCut, 120);
  assert.deepStrictEqual(gaps(r.gapsFinal), [-75, -195, -150, -150, -60, -90, 0]);
  assert.strictEqual(row(r, 'physics').decision, 'deferred'); assert.strictEqual(row(r, 'english').decision, 'reduced');
  assert.strictEqual(row(r, 'biology').decision, 'full'); assert.strictEqual(r.status, 'verified');
});
test('Golden-Schedule (priority blocks)', () => {
  const r = run(st(DEMO_CAP, demoTasks()));
  assert.deepStrictEqual(blk(r), ['0:math_hw:45', '0:english:45', '0:quiz:30', '1:quiz:30', '1:biology:30', '2:biology:30', '2:biology:30',
    '4:biology:30', '4:biology:30', '5:chem:30', '5:history:30', '6:history:30', '6:history:30', '8:history:30', '8:history:30']);
});
const FELL = { math_hw: 45, english: 25 };
test('Golden-Replan "I fell behind": remaining 530, shortfall 170', () => {
  const r = run(st([0, 60, 60, 0, 60, 60, 60, 0, 60], demoTasks(FELL), 1320));
  assert.strictEqual(r.tasks.reduce((s, t) => s + t.remaining, 0), 530);
  assert.strictEqual(r.summary.shortfall, 170); assert.strictEqual(r.summary.workload, 530);
  assert.deepStrictEqual(gaps(r.gapsInitial), [-60, 5, 5, 95, 80, 170]);
  assert.deepStrictEqual(alloc(r), { math_hw: 0, physics: 0, english: 0, quiz: 60, biology: 150, chem: 0, history: 150 });
  assert.strictEqual(r.summary.totalCut, 170); assert.strictEqual(r.summary.allocated, 360);
  assert.deepStrictEqual(gaps(r.gapsFinal), [-120, -120, -120, -30, -90, 0]);
  assert.strictEqual(row(r, 'math_hw').decision, 'done');
  ['physics', 'english', 'chem'].forEach((id) => assert.strictEqual(row(r, id).decision, 'deferred', id));
  assert.deepStrictEqual(blk(r), ['1:quiz:30', '1:quiz:30', '2:biology:30', '2:biology:30', '4:biology:30', '4:biology:30', '5:biology:30', '5:history:30', '6:history:30', '6:history:30', '8:history:30', '8:history:30']);
});
test('Replan: original estimate - completed = remaining; total original - completed = remaining', () => {
  const r = run(st([0, 60, 60, 0, 60, 60, 60, 0, 60], demoTasks(FELL), 1320));
  assert.strictEqual(600 - 70, r.tasks.reduce((s, t) => s + t.remaining, 0));
});
test('Replan-stability: executing the plan literally then re-running gives the same remaining plan', () => {
  const r = run(st([0, 60, 60, 0, 60, 60, 60, 0, 60], demoTasks({ math_hw: 45, english: 45, quiz: 30 }), 1320));
  assert.strictEqual(r.summary.workload, 480); assert.strictEqual(r.summary.shortfall, 120);
  assert.deepStrictEqual(alloc(r), { math_hw: 0, physics: 0, english: 0, quiz: 30, biology: 150, chem: 30, history: 150 });
  assert.strictEqual(row(r, 'english').decision, 'reduced');
});
test('Replan: previously reduced task becomes fully possible when time appears', () => {
  const r = run(st([0, 60, 60, 60, 60, 60, 60, 60, 60], demoTasks({ math_hw: 45, english: 45, quiz: 30 }), 1320));
  assert.strictEqual(r.summary.shortfall, 0);
  ['physics', 'english', 'chem'].forEach((id) => assert.ok(['full', 'done'].includes(row(r, id).decision), id));
  assert.strictEqual(row(r, 'physics').decision, 'full'); assert.strictEqual(row(r, 'chem').allocated, 45);
});
test('Replan: student does MORE than planned (Case D, Exam 120 done)', () => {
  const tasks = [mk('exam', { seq: 1, day: 2, est: 180, imp: 5, done: 120 }), mk('proj', { seq: 2, day: 7, est: 300, imp: 4 })];
  const r = run(st([0, 90, 90, 90, 90, 90, 90, 90], tasks, 1320));
  assert.strictEqual(r.summary.totalCut, 0);
  assert.deepStrictEqual(blk(r).filter((b) => b.includes('proj')).map((b) => b.split(':')[0]), ['1', '2', '2', '3', '3', '4', '4']);
});
test('Replan: complete day missed (Case G)', () => {
  const tasks = [mk('exam', { seq: 1, day: 2, est: 180, imp: 5 }), mk('proj', { seq: 2, day: 7, est: 300, imp: 4 })];
  const r = run(st([0, 90, 90, 90, 90, 90, 90, 90], tasks));
  assert.strictEqual(r.gapsInitial[0].gap, 0); assert.strictEqual(r.summary.totalCut, 0); assert.strictEqual(r.status, 'verified');
});
test('Case D: exam soon + project later', () => {
  const tasks = [mk('exam', { seq: 1, day: 2, est: 180, imp: 5 }), mk('proj', { seq: 2, day: 7, est: 300, imp: 4 })];
  const r = run(st([90, 90, 90, 90, 90, 90, 90, 90], tasks));
  assert.deepStrictEqual(gaps(r.gapsInitial), [-90, -240]);
  assert.deepStrictEqual(blk(r).filter((b) => b.includes('exam')).map((b) => b.split(':')[0]), ['0', '0', '1', '1']);
});
test('Case A: 10h/10h -> Tight, no cuts, verified', () => {
  const tasks = [mk('a', { seq: 1, day: 4, est: 300 }), mk('b', { seq: 2, day: 4, est: 180 }), mk('c', { seq: 3, day: 4, est: 120 })];
  const r = run(st([120, 120, 120, 120, 120], tasks));
  assert.strictEqual(r.gapsInitial[0].gap, 0); assert.strictEqual(r.summary.totalCut, 0); assert.strictEqual(r.status, 'verified');
});
test('Case H-1 deadline tomorrow 08:00 -> deferred', () => {
  const r = run(st([30, 60], [mk('hw', { day: 1, time: 480, est: 45, aon: true })], 1230));
  assert.strictEqual(r.gapsInitial[0].C, 30); assert.strictEqual(r.summary.shortfall, 15); assert.strictEqual(row(r, 'hw').decision, 'deferred');
});
test('Case H-2 date only -> 30 tonight + 15 tomorrow', () => {
  const r = run(st([30, 60], [mk('hw', { day: 1, est: 45, aon: true })], 1230));
  assert.strictEqual(r.gapsInitial[0].C, 90); assert.deepStrictEqual(blk(r), ['0:hw:30', '1:hw:15']);
});
test('Replan: overdue task is excluded and reported; new deadline reschedules it', () => {
  const s = st([60], [mk('hw', { day: 0, time: 540, est: 45, aon: true })], 600);
  const r = run(s); assert.deepStrictEqual(r.overdue, ['hw']); assert.strictEqual(r.summary.workload, 0); assert.strictEqual(row(r, 'hw').decision, 'overdue');
  s.tasks[0].deadlineTime = undefined; // student chooses "end of today"
  const r2 = run(s); assert.deepStrictEqual(blk(r2), ['0:hw:45']); assert.strictEqual(r2.status, 'verified');
});
test('Replan: dropped tasks do not count', () => {
  const r = run(st([60], [mk('hw', { day: 0, est: 90, status: 'dropped' })]));
  assert.strictEqual(r.summary.workload, 0); assert.strictEqual(row(r, 'hw').decision, 'dropped');
});
test('Determinism: same state twice -> identical output; input never mutated', () => {
  const s = deepFreeze(st(DEMO_CAP, demoTasks()));
  assert.strictEqual(JSON.stringify(run(s)), JSON.stringify(run(s)));
});

// ================================================================= INVARIANTS (property tests)
const clampT = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const wsT = (s, d) => (d === 0 ? Math.max(s.now, 900) : 900);
const LT = (s, d) => Math.max(0, 1320 - wsT(s, d));
const avT = (s, d) => Math.min(s.capacity[d] || 0, LT(s, d));
const usT = (s, d, tau) => { const l = LT(s, d); return l <= 0 ? 0 : Math.floor(avT(s, d) * clampT(tau - wsT(s, d), 0, l) / l); };

function invariants(s, res) {
  const v = [];
  const T = (t) => ({ day: t.deadlineDay, time: t.deadlineTime === undefined ? 1320 : t.deadlineTime });
  const cmp = (a, b) => (a.day - b.day) || (a.time - b.time);
  const byId = Object.fromEntries(s.tasks.map((t) => [t.id, t]));
  const sumBlocks = (id) => res.blocks.filter((b) => b.taskId === id).reduce((x, b) => x + b.minutes, 0);
  for (const r of res.tasks) {
    const t = byId[r.id];
    const rem = Math.max(0, t.estimate - t.completed);
    if (r.remaining !== rem) v.push('H4 remaining ' + r.id);
    if (r.allocated < 0 || r.allocated > rem) v.push('H6 range ' + r.id);
    if (t.importance === 5 && r.decision !== 'overdue' && r.decision !== 'dropped' && r.decision !== 'done' && r.allocated !== rem) v.push('H5 imp5 cut ' + r.id);
    if (t.allOrNothing && r.allocated !== 0 && r.allocated !== rem) v.push('H6 aon partial ' + r.id);
    if (!t.allOrNothing && r.allocated > 0 && r.allocated < Math.min(rem, r.floorFuture)) v.push('H6 below floor ' + r.id);
    if (sumBlocks(r.id) > r.allocated) v.push('H1 blocks>allocated ' + r.id);
    if (r.unplaced !== (['full', 'reduced', 'deferred'].includes(r.decision) ? r.allocated - sumBlocks(r.id) : 0)) v.push('H8 unplaced formula ' + r.id);
    if (r.atRisk !== (r.unplaced > 0)) v.push('H8 atRisk flag ' + r.id);
    if (r.decision === 'done' && rem !== 0 && t.status !== 'done') v.push('H8 done');
    if (r.decision === 'full' && r.allocated !== rem) v.push('H8 full');
    if (r.decision === 'deferred' && r.allocated !== 0) v.push('H8 deferred');
    if (r.decision === 'reduced' && !(r.allocated < rem)) v.push('H8 reduced');
  }
  const maxDay = Math.max(-1, ...res.blocks.map((b) => b.day));
  for (let d = 0; d <= maxDay; d++) {
    const used = res.blocks.filter((b) => b.day === d).reduce((x, b) => x + b.minutes, 0);
    if (used > avT(s, d)) v.push('H2 day ' + d + ' over capacity');
  }
  res.blocks.forEach((b) => { if (b.day > byId[b.taskId].deadlineDay) v.push('H3 after deadline ' + b.taskId); if (b.minutes > 50) v.push('H10 >50'); });
  // H3 on the deadline day: cumulative (in scheduler order) <= usable(d, tau_t)
  const order = res.tasks.filter((r) => r.allocated > 0).map((r) => byId[r.id])
    .sort((x, y) => cmp(T(x), T(y)) || (y.importance - x.importance) || ((x.seq === undefined ? 0 : x.seq) - (y.seq === undefined ? 0 : y.seq)));
  order.forEach((t, i) => {
    const d = t.deadlineDay;
    const cum = order.slice(0, i + 1).reduce((x, o) => x + res.blocks.filter((b) => b.taskId === o.id && b.day === d).reduce((y, b) => y + b.minutes, 0), 0);
    if (cum > usT(s, d, T(t).time)) v.push('H3 deadline-day cumulative ' + t.id);
  });
  // H10: a block < MIN_BLOCK is only allowed if it completes its task's allocation
  res.blocks.forEach((b, i) => {
    if (b.minutes < 15) {
      const later = res.blocks.slice(i + 1).some((o) => o.taskId === b.taskId);
      if (later || row(res, b.taskId).unplaced > 0) v.push('H10 small block not completing ' + b.taskId);
    }
  });
  // H9a: blocks never exceed capacity (always)
  const lastDay = Math.max(-1, ...s.tasks.map((t) => t.deadlineDay));
  let capSum = 0; for (let d = 0; d <= lastDay; d++) capSum += avT(s, d);
  if (res.blocks.reduce((x, b) => x + b.minutes, 0) > capSum) v.push('H9a blocks > capacity');
  // H7 / H9b
  if (res.status !== 'impossible') {
    if (res.gapsFinal.some((g) => g.gap > 0)) v.push('H7 gap>0 without Still impossible');
    if (res.summary.totalCut < res.summary.shortfall) v.push('H12 cut < shortfall');
    if (res.summary.allocated > res.summary.capacity) v.push('H9b allocated > capacity');
  } else {
    const T0 = res.stillImpossible.T;
    if (res.gapsFinal.some((g) => cmp(g.T, T0) < 0 && g.gap > 0)) v.push('H7b gap before T* > 0');
    if (!(res.stillImpossible.need > 0)) v.push('impossible need');
  }
  if ((res.status === 'atRisk') !== (res.tasks.some((r) => r.atRisk) && !res.stillImpossible)) v.push('status mismatch');
  if (JSON.stringify(run(s)) !== JSON.stringify(res)) v.push('H11 not deterministic');
  return v;
}

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function randState(r) {
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const days = ri(1, 10), n = ri(1, 8);
  const cap = Array.from({ length: days + 1 }, () => (r() < 0.2 ? 0 : r() < 0.2 ? ri(1, 30) : ri(0, 200)));
  const tasks = Array.from({ length: n }, (_, i) => {
    const est = ri(1, 240);
    return mk('t' + i, { seq: i, day: ri(0, days), time: r() < 0.4 ? ri(0, 1439) : undefined, est, done: r() < 0.3 ? ri(0, est + 10) : 0,
      imp: ri(1, 5), aon: r() < 0.3, status: r() < 0.05 ? 'dropped' : undefined });
  });
  return st(cap, tasks, r() < 0.5 ? 900 : ri(0, 1439));
}
test('Property: 4000 random states satisfy every hard invariant', () => {
  const r = rng(12345); const errs = [];
  for (let i = 0; i < 4000 && errs.length < 5; i++) {
    const s = randState(r); const res = run(s); const v = invariants(s, res);
    if (v.length) errs.push('state#' + i + ': ' + v.join('; ') + '\n' + JSON.stringify(s));
  }
  assert.strictEqual(errs.length, 0, errs.join('\n---\n'));
});
test('Invariants hold on every golden scenario', () => {
  [st(DEMO_CAP, demoTasks()), st([0, 60, 60, 0, 60, 60, 60, 0, 60], demoTasks(FELL), 1320)].forEach((s) => {
    const v = invariants(s, run(s)); assert.deepStrictEqual(v, []);
  });
});

// ---- informational (NOT asserted): how often does "execute day-0 plan literally, then re-run" give the same allocation?
(function stability() {
  const r = rng(777); let n = 0, same = 0;
  for (let i = 0; i < 3000; i++) {
    const s = randState(r);
    if (s.tasks.some((t) => t.deadlineDay < 1 || t.status)) continue;
    const res = run(s); if (res.status !== 'verified') continue;
    const s2 = clone(s); s2.now = 1320;
    s2.tasks.forEach((t) => { t.completed += res.blocks.filter((b) => b.day === 0 && b.taskId === t.id).reduce((x, b) => x + b.minutes, 0); });
    const res2 = run(s2); n++;
    if (res.tasks.every((t) => row(res2, t.id).allocated === t.allocated - res.blocks.filter((b) => b.day === 0 && b.taskId === t.id).reduce((x, b) => x + b.minutes, 0))) same++;
  }
  console.log('[info] stability after executing day 0 literally: ' + same + '/' + n + ' states unchanged');
})();

test('Why-structured: engine exposes the reason as data (kind, level, deadline day, minutes short)', () => {
  const r = run(st(DEMO_CAP, demoTasks())); const w = (id) => row(r, id).why;
  assert.deepStrictEqual(w('physics'), { kind: 'defer', level: 2, day: 5, time: 1320, need: 45 });
  assert.strictEqual(w('english').kind, 'reduce'); assert.strictEqual(w('english').level, 3);
  ['biology', 'quiz', 'history', 'math_hw'].forEach((id) => assert.strictEqual(w(id), null));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
