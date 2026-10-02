'use strict';
// Executes the REAL inline script of index.html against a minimal fake DOM (no browser needed).
// It does not test layout/CSS. It tests every decision the UI shows. Use TRIAGE_DIR to point at another copy.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = process.env.TRIAGE_DIR || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const code = html.split('<script>')[1].split('</script>')[0];
const TE = require(path.join(DIR, 'engine', 'triage-engine.js'));

function boot() {
  const els = {}, errors = [];
  const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', onclick: null });
  const doc = { getElementById: el, values: {} };
  doc.querySelectorAll = () => {
    const out = []; const re = /<input[^>]*value="(\d+)"[^>]*data-id="(\w+)"/g; let m;
    while ((m = re.exec(els.behind.innerHTML))) out.push({ value: doc.values[m[2]] !== undefined ? doc.values[m[2]] : m[1], dataset: { id: m[2] } });
    return out;
  };
  const ctx = { TriageEngine: TE, TaskInput: require(path.join(DIR, 'engine', 'task-input.js')), document: doc, console };
  try { vm.runInNewContext(code + ';this.__S=()=>S;this.__R=()=>R;', ctx); } catch (e) { errors.push(e.message); }
  return { els, doc, ctx, errors };
}
const txt = (h) => h.replace(/<summary>.*?<\/summary>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function fell(vals) { const a = boot(); a.els.fb.onclick(); a.doc.values = vals; a.els.rp.onclick(); return a; }
const changes = (a) => txt(a.els.changes.innerHTML);

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; } catch (e) { fail++; console.log('FAIL  ' + n + '\n      ' + String(e.message).split('\n')[0]); } };

test('UI-01 boots without errors; Reality Check 10h / 8h / 2h', () => {
  const a = boot(); assert.deepStrictEqual(a.errors, []);
  const s = txt(a.els.status.innerHTML);
  assert.ok(s.includes('Short by 2h') && s.includes('10h needed') && s.includes('8h available'), s);
});
test('UI-02 Triage groups match the demo', () => {
  const t = txt(boot().els.triage.innerHTML);
  ['Math homework FULL 45m', 'Math quiz prep FULL 1h', 'Biology exam PROTECTED 2h 30m', 'History project FULL 2h 30m',
    'English essay 1h 30m → 45m', 'Chemistry lab 45m → 30m', 'Physics worksheet DEFERRED 1h'].forEach((x) => assert.ok(t.includes(x), x));
});
test('UI-03 priority blocks 15:00-15:45 / 15:45-16:30 / 16:30-17:00', () => {
  const t = txt(boot().els.blocks.innerHTML);
  ['15:00 – 15:45 Math homework', '15:45 – 16:30 English essay', '16:30 – 17:00 Math quiz prep'].forEach((x) => assert.ok(t.includes(x), x));
});
test('UI-04 CRITICAL 45/25/0 -> Short by 2h 50m and ONLY real changes', () => {
  const a = fell({ math: '45', eng: '25', quiz: '0' }); const c = changes(a);
  assert.ok(txt(a.els.status.innerHTML).includes('Short by 2h 50m'));
  assert.ok(c.includes('English essay') && c.includes('Chemistry lab') && c.includes('deferred'), c);
  ['Math homework', 'Math quiz', 'Physics', 'Biology', 'History'].forEach((x) => assert.ok(!c.includes(x), 'false change: ' + x + ' | ' + c));
});
test('UI-05 executing the plan literally 45/45/30 -> no fake changes', () => {
  const c = changes(fell({ math: '45', eng: '45', quiz: '30' }));
  assert.ok(c.includes('No change needed'), c);
  ['kept', 'reduced to 0m', 'done'].forEach((x) => assert.ok(!c.includes(x), 'fake: ' + x + ' | ' + c));
});
test('UI-06 doing more than planned (Math 60) does not create a change for Math', () => {
  assert.ok(!changes(fell({ math: '60' })).includes('Math homework'));
});
test('UI-07 Why? text: no stale "tasks due by", no raw D-labels, deferred tasks not counted', () => {
  const a = fell({ math: '45', eng: '25', quiz: '0' }); const b = boot();
  [b, a].forEach((x) => {
    const h = x.els.triage.innerHTML; assert.ok(!/\bD\d+\b/.test(h), 'raw D-label in UI');
    x.ctx.__R().tasks.filter((t) => ['reduced', 'deferred'].includes(t.decision)).forEach((t) => {
      assert.ok(!/tasks due by/.test(t.reason) && /still scheduled/.test(t.reason), t.name + ': ' + t.reason);
    });
  });
});
test('UI-08 Why? for English/Chemistry names the candidates only (Physics already deferred)', () => {
  const R = boot().ctx.__R(); const get = (id) => R.tasks.find((t) => t.id === id).reason;
  assert.ok(/importance 3 .*still scheduled by D8/.test(get('eng')) && /importance 3 .*still scheduled by D8/.test(get('chem')));
  assert.ok(/importance 2 .*still scheduled by D5/.test(get('phys')));
  assert.strictEqual(get('bio'), 'Protected (importance 5): never cut.');
});
test('UI-09 mathematical verification (critical scenario)', () => {
  const a = fell({ math: '45', eng: '25', quiz: '0' }); const R = a.ctx.__R(), S = a.ctx.__S();
  assert.strictEqual(S.tasks.reduce((s, t) => s + t.completed, 0), 70);
  assert.strictEqual(S.tasks.reduce((s, t) => s + t.estimate, 0) - 70, 530);
  assert.strictEqual(R.summary.workload, 530); assert.strictEqual(R.summary.capacity, 360); assert.strictEqual(R.summary.shortfall, 170);
  assert.strictEqual(R.summary.allocated, 360); assert.strictEqual(R.summary.totalCut, 170);
  const cut = Object.fromEntries(R.tasks.map((t) => [t.id, t.cut]));
  assert.deepStrictEqual([cut.phys, cut.eng, cut.chem], [60, 65, 45]);
  ['bio', 'quiz', 'hist'].forEach((id) => assert.strictEqual(cut[id], 0));
});
test('UI-10 determinism (5 fresh runs) + reset + replan again', () => {
  const run = () => JSON.stringify(fell({ math: '45', eng: '25', quiz: '0' }).ctx.__R());
  assert.strictEqual(new Set([1, 2, 3, 4, 5].map(run)).size, 1);
  const b = fell({ math: '45', eng: '25', quiz: '0' }); const first = JSON.stringify(b.ctx.__R());
  b.els.reset.onclick(); assert.strictEqual(JSON.stringify(b.ctx.__R()), JSON.stringify(boot().ctx.__R()));
  assert.strictEqual(txt(b.els.changes.innerHTML), '');
  b.els.fb.onclick(); b.doc.values = { math: '45', eng: '25', quiz: '0' }; b.els.rp.onclick();
  assert.strictEqual(JSON.stringify(b.ctx.__R()), first);
});
test('UI-11 bad inputs never throw or print NaN/undefined', () => {
  [{ math: '-1', eng: '-1', quiz: '-1' }, { eng: '25.5' }, { eng: '' }, { eng: 'abc' }, { math: '999999', eng: '999999', quiz: '999999' }, { math: '0', eng: '0', quiz: '0' }].forEach((v) => {
    const a = fell(v); const all = a.els.status.innerHTML + a.els.triage.innerHTML + a.els.blocks.innerHTML + a.els.changes.innerHTML;
    assert.ok(!/NaN|undefined|null/.test(all), JSON.stringify(v));
  });
});

console.log('UI tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
