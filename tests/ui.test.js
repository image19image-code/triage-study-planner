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
  const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', onclick: null, attrs: {}, focused: 0, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k]; }, focus() { this.focused++; } });
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
  ['Required assignment FULL 45m', 'Assessment preparation FULL 1h', 'Research assignment PROTECTED 2h 30m', 'Project work FULL 2h 30m',
    'Review material 1h 30m → 45m', 'Presentation preparation 45m → 30m', 'Practice work DEFERRED 1h'].forEach((x) => assert.ok(t.includes(x), x));
});
test('UI-03 priority blocks 15:00-15:45 / 15:45-16:30 / 16:30-17:00', () => {
  const t = txt(boot().els.blocks.innerHTML);
  ['15:00 – 15:45 Required assignment', '15:45 – 16:30 Review material', '16:30 – 17:00 Assessment preparation'].forEach((x) => assert.ok(t.includes(x), x));
});
test('UI-04 CRITICAL 45/25/0 -> Short by 2h 50m and ONLY real changes', () => {
  const a = fell({ math: '45', eng: '25', quiz: '0' }); const c = changes(a);
  assert.ok(txt(a.els.status.innerHTML).includes('Short by 2h 50m'));
  assert.ok(c.includes('Review material') && c.includes('Presentation preparation') && c.includes('deferred'), c);
  ['Required assignment', 'Assessment preparation', 'Practice work', 'Research assignment', 'Project work'].forEach((x) => assert.ok(!c.includes(x), 'false change: ' + x + ' | ' + c));
});
test('UI-05 executing the plan literally 45/45/30 -> no fake changes', () => {
  const c = changes(fell({ math: '45', eng: '45', quiz: '30' }));
  assert.ok(c.includes('No change needed'), c);
  ['kept', 'reduced to 0m', 'done'].forEach((x) => assert.ok(!c.includes(x), 'fake: ' + x + ' | ' + c));
});
test('UI-06 doing more than planned (Math 60) does not create a change for Math', () => {
  assert.ok(!changes(fell({ math: '60' })).includes('Required assignment'));
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

test('UI-12 regression: critical 45/25/0 -> 8h 50m needed / 6h available / 2h 50m shortfall; only English + Chemistry change', () => {
  const a = fell({ math: '45', eng: '25', quiz: '0' }); const s = txt(a.els.status.innerHTML);
  assert.ok(s.includes('Short by 2h 50m') && s.includes('8h 50m needed') && s.includes('6h available') && s.includes('2h 50m shortfall'), s);
  const c = changes(a); assert.ok(/Review material: planned 20m \u2192 deferred/.test(c) && /Presentation preparation: planned 30m \u2192 deferred/.test(c), c);
  assert.strictEqual((c.match(/\u2192/g) || []).length, 2, c);
});

test('UI-13 status bar: dark = covered, red = missing, proportions match the numbers (demo 8h of 10h)', () => {
  const h = boot().els.status.innerHTML;
  assert.ok(h.includes('class="have" style="width:80%"') && h.includes('class="gap" style="width:20%"'), h);
  const r = fell({ math: '45', eng: '25', quiz: '0' }).els.status.innerHTML;        // 530 needed, 360 covered, 170 missing
  assert.ok(r.includes('style="width:67.9%"') && r.includes('style="width:32.1%"'), r);
});
test('UI-14 only the first priority block says "Start here"; Defer zone never claims time', () => {
  const a = boot(); const b = a.els.blocks.innerHTML;
  assert.strictEqual((b.match(/Start here/g) || []).length, 1); assert.ok(b.indexOf('Start here') < b.indexOf('Review material'));
  assert.ok(/Defer<span class="hint">left out of this plan/.test(a.els.triage.innerHTML));
});

test('UI-15 Why? is short, human, states the numbers, and says it is deterministic (no AI wording of its own)', () => {
  const R0 = boot().els.triage.innerHTML; const ps = [...R0.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.strictEqual(ps.length, 7);                       // 4 full + 2 reduced + 1 deferred
  ps.forEach((x) => { assert.ok(x.length < 220, 'wall of text: ' + x); assert.ok(x.includes('No AI'), x); assert.ok(!/AI (thinks|recommends|suggests)/i.test(x), x); });
  const t = txt(R0);
  assert.ok(t.includes('Importance 2 was the least important task still in your plan, and you were 45m short by day 5. So Triage defers it'), t);
  assert.ok(t.includes('Importance 5 is never cut') && t.includes('shortens it instead of dropping it'));
});
test('UI-16 after REPLAN the recovery panel explains instead of looking broken', () => {
  const a = fell({ math: '45', eng: '25', quiz: '0' }); const b = txt(a.els.behind.innerHTML);
  assert.ok(b.includes('Plan rebuilt from what you actually did. Your next session is tomorrow.'), b);
});

test('UI-17 what-if on the demo: +15 -> short 15m, +30 -> Realistic, -15 -> short 3h 45m, Back -> the exact golden demo', () => {
  const a = boot(); const st = () => txt(a.els.status.innerHTML); const golden = JSON.stringify(a.ctx.__R());
  assert.strictEqual(a.els.wiLabel.textContent, 'Your real time'); assert.strictEqual(a.els.wiBack.hidden, true);
  a.els.wiPlus.onclick(); assert.ok(st().includes('Short by 15m') && st().includes('WHAT-IF'), st()); assert.strictEqual(a.els.wiLabel.textContent, '+15 min per study day');
  a.els.wiPlus.onclick(); assert.ok(st().includes('Realistic') && !st().includes('Short by'), st());
  a.els.wiBack.onclick(); assert.strictEqual(JSON.stringify(a.ctx.__R()), golden); assert.ok(st().includes('Short by 2h') && !st().includes('WHAT-IF')); assert.strictEqual(a.els.wiBack.hidden, true);
  a.els.wiMinus.onclick(); assert.ok(st().includes('Short by 3h 45m'), st());
  assert.ok(/Review material DEFERRED/.test(txt(a.els.triage.innerHTML)));   // less time -> English now deferred instead of reduced
});
test('UI-18 what-if never mixes with real recovery: I FELL BEHIND and "Your plan changed" are hidden, then restored', () => {
  const a = boot(); a.els.wiPlus.onclick();
  assert.ok(!a.els.behind.innerHTML.includes('id="fb"') && /what-if, not your real plan/.test(a.els.behind.innerHTML)); a.els.wiBack.onclick(); assert.ok(a.els.behind.innerHTML.includes('id="fb"'));
  const b = fell({ math: '45', eng: '25', quiz: '0' }); const real = JSON.stringify(b.ctx.__R()), ch = changes(b); assert.ok(ch.includes('Review material'));
  b.els.wiPlus.onclick(); assert.strictEqual(b.els.changes.innerHTML, ''); b.els.wiBack.onclick();
  assert.strictEqual(JSON.stringify(b.ctx.__R()), real); assert.strictEqual(changes(b), ch);
});
test('UI-19 what-if is clamped to +-120, disables its buttons at the limit, and Reset clears it', () => {
  const a = boot(); for (let i = 0; i < 12; i++) a.els.wiPlus.onclick();
  assert.strictEqual(a.els.wiLabel.textContent, '+120 min per study day'); assert.strictEqual(a.els.wiPlus.disabled, true); assert.strictEqual(a.els.wiMinus.disabled, false);
  for (let i = 0; i < 20; i++) a.els.wiMinus.onclick(); assert.strictEqual(a.els.wiLabel.textContent, '\u2212120 min per study day'); assert.strictEqual(a.els.wiMinus.disabled, true);
  assert.ok(txt(a.els.status.innerHTML).includes('Still impossible'));
  a.els.reset.onclick(); assert.strictEqual(a.els.wiLabel.textContent, 'Your real time'); assert.ok(txt(a.els.status.innerHTML).includes('Short by 2h'));
});

console.log('UI tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
