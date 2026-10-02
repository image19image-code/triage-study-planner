'use strict';
// STEP 3 tests: the user-input flow, run through the REAL index.html script on a fake DOM.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = process.env.TRIAGE_DIR || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const code = html.split('<script>')[1].split('</script>')[0];
const TE = require(path.join(DIR, 'engine', 'triage-engine.js'));
const TI = require(path.join(DIR, 'engine', 'task-input.js'));

function boot() {
  const els = {}, errors = [];
  const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, onclick: null, attrs: {}, focused: 0, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k]; }, focus() { this.focused++; } });
  const doc = { getElementById: el, values: {} };
  doc.querySelectorAll = () => {
    const out = []; const re = /<input[^>]*value="(\d+)"[^>]*data-id="([^"]*)"/g; let m;
    while ((m = re.exec(els.behind.innerHTML))) out.push({ value: doc.values[m[2]] !== undefined ? doc.values[m[2]] : m[1], dataset: { id: m[2] } });
    return out;
  };
  ['status','empty','tasks','taskList','demoNote','useOwn','form','tName','tEst','tImp','tDays','addBtn','formErr','tAvail','availErr','planBtn','rest','triage','planTitle','blocks','behind','changes','reset'].forEach(el);
  const ctx = { TriageEngine: TE, TaskInput: TI, document: doc, console };
  try { vm.runInNewContext(code + ';this.__S=()=>S;this.__R=()=>R;this.__D=()=>draft;', ctx); } catch (e) { errors.push(e.message); }
  const app = { els, doc, ctx, errors };
  app.start = () => { els.useOwn.onclick(); return app; };
  app.add = (name, est, imp, days) => { els.tName.value = name; els.tEst.value = est; els.tImp.value = String(imp); els.tDays.value = days; els.addBtn.onclick(); return app; };
  app.plan = (avail) => { if (avail !== undefined) els.tAvail.value = String(avail); els.planBtn.onclick(); return app; };
  app.rm = (id) => els.taskList.onclick({ target: { dataset: { rm: id } } });
  app.fell = (vals) => { els.fb.onclick(); doc.values = vals || {}; els.rp.onclick(); return app; };
  return app;
}
const txt = (h) => h.replace(/<summary>.*?<\/summary>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const everything = (a) => ['status', 'taskList', 'triage', 'blocks', 'behind', 'changes', 'formErr', 'availErr'].map((k) => a.els[k].innerHTML + a.els[k].textContent).join('\n');

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; } catch (e) { fail++; console.log('FAIL  ' + n + '\n      ' + String(e.message).split('\n').slice(0, 3).join(' | ')); } };

// A realistic user scenario with a known answer:
//   Essay 120m imp3, Exam 90m imp5, Reading 60m imp1, all due tomorrow, 100 min/day available.
//   W=270, C=day0+day1=200 -> shortfall 70. Reading deferred (60), then Essay reduced by 10.
const userScenario = () => boot().start().add('Essay', '120', 3, '1').add('Exam', '90', 5, '1').add('Reading', '60', 1, '1').plan(100);

test('IN-01 valid task is added and shown', () => {
  const a = boot().start().add('Chemistry report', '60', 3, '2');
  assert.strictEqual(a.els.formErr.textContent, ''); assert.strictEqual(a.ctx.__D().length, 1);
  assert.ok(txt(a.els.taskList.innerHTML).includes('Chemistry report 1h · importance 3 · due day 2'));
  assert.strictEqual(a.els.tName.value, '');
});
test('IN-02 two tasks', () => { const a = boot().start().add('A', '30', 3, '0').add('B', '45', 4, '1'); assert.strictEqual(JSON.stringify(a.ctx.__D().map((t) => t.name)), '["A","B"]'); });
test('IN-03 remove a task', () => {
  const a = boot().start().add('A', '30', 3, '0').add('B', '45', 4, '1'); a.rm('u1');
  assert.strictEqual(JSON.stringify(a.ctx.__D().map((t) => t.name)), '["B"]'); assert.ok(!txt(a.els.taskList.innerHTML).includes('A 30m'));
});
test('IN-04 empty / blank name rejected with a message', () => {
  ['', '   '].forEach((n) => { const a = boot().start().add(n, '30', 3, '1'); assert.strictEqual(a.ctx.__D().length, 0); assert.ok(/name is required/i.test(a.els.formErr.textContent)); });
});
test('IN-05 negative / zero / non-numeric / decimal / huge time rejected (never silently 0)', () => {
  [['-1', /negative/], ['0', /at least 1/], ['abc', /must be a number/], ['30.5', /whole numbers/], ['30,5', /whole numbers/], ['', /enter a number/], ['999999', /at most/], ['1e3', /must be a number/]].forEach(([v, re]) => {
    const a = boot().start().add('X', v, 3, '1'); assert.strictEqual(a.ctx.__D().length, 0, v); assert.ok(re.test(a.els.formErr.textContent), v + ' -> ' + a.els.formErr.textContent);
  });
});
test('IN-06 importance outside 1-5 or non-numeric rejected', () => {
  ['0', '6', '-2', 'x', '2.5', ''].forEach((v) => { const a = boot().start().add('X', '30', v, '1'); assert.strictEqual(a.ctx.__D().length, 0, v); assert.ok(/Importance/.test(a.els.formErr.textContent), v); });
});
test('IN-07 deadline: negative / non-numeric / too far rejected; 0 and 1 accepted', () => {
  ['-1', 'x', '61', '', '1.5'].forEach((v) => assert.strictEqual(boot().start().add('X', '30', 3, v).ctx.__D().length, 0, v));
  assert.strictEqual(boot().start().add('X', '30', 3, '0').ctx.__D().length, 1);
});
test('IN-08 available time: 0 accepted; negative / text / empty / decimal rejected and engine NOT run', () => {
  const ok = boot().start().add('A', '60', 3, '1').plan(0);                       // 60 min of work, 0 min available -> short by exactly 1h
  assert.strictEqual(ok.els.availErr.textContent, ''); assert.ok(txt(ok.els.status.innerHTML).includes('Short by 1h'), txt(ok.els.status.innerHTML));
  ['-5', 'abc', '', '10.5'].forEach((v) => {
    const a = boot().start().add('A', '60', 3, '1').plan(v); assert.ok(a.els.availErr.textContent.length > 0, v);
    assert.strictEqual(a.ctx.__S().tasks.length, 7, 'engine state must still be the demo: ' + v);   // plan did not run
  });
});
test('IN-09 planning with no tasks is blocked with a message', () => {
  const a = boot().start().plan(120); assert.ok(/Add at least one task/.test(a.els.formErr.textContent));
});
test('IN-10 before the first plan the results are hidden and an empty state is shown', () => {
  const a = boot().start().add('A', '30', 3, '1'); assert.strictEqual(a.els.rest.hidden, true); assert.strictEqual(a.els.empty.hidden, false);
  a.plan(120); assert.strictEqual(a.els.rest.hidden, false); assert.strictEqual(a.els.empty.hidden, true);
});
test('IN-11 Triage on user data = the REAL engine (no logic in the UI)', () => {
  const a = userScenario(); assert.deepStrictEqual(a.errors, []);
  const direct = TE.runTriageEngine(TI.buildState(a.ctx.__D(), 100));
  assert.strictEqual(JSON.stringify(a.ctx.__R()), JSON.stringify(direct));
  const s = txt(a.els.status.innerHTML); assert.ok(s.includes('Short by 1h 10m') && s.includes('4h 30m needed') && s.includes('3h 20m available'), s);
  const t = txt(a.els.triage.innerHTML);
  assert.ok(t.includes('Exam PROTECTED 1h 30m') && t.includes('Essay 2h → 1h 50m') && t.includes('Reading DEFERRED 1h'), t);
});
test('IN-12 Why? on user data matches the data', () => {
  const R = userScenario().ctx.__R(); const r = (n) => R.tasks.find((t) => t.name === n).reason;
  assert.ok(/importance 1 .*still scheduled by D1/.test(r('Reading')), r('Reading'));
  assert.ok(/importance 3 .*still scheduled by D1/.test(r('Essay')), r('Essay'));
  assert.strictEqual(r('Exam'), 'Protected (importance 5): never cut.');
});
test('IN-13 priority blocks fit the available time and start at 15:00', () => {
  const a = userScenario(); const R = a.ctx.__R();
  const day0 = R.blocks.filter((b) => b.day === 0).reduce((s, b) => s + b.minutes, 0); assert.ok(day0 <= 100 && day0 > 0);
  assert.ok(txt(a.els.blocks.innerHTML).includes('15:00 –'));
});
test('IN-14 I FELL BEHIND on user data: executing the plan literally -> no changes', () => {
  // 90 min/day: day 0 is filled exactly by the Exam block, so no unusable leftover minutes exist.
  const a = boot().start().add('Essay', '120', 3, '1').add('Exam', '90', 5, '1').add('Reading', '60', 1, '1').plan(90);
  assert.strictEqual(a.ctx.__R().days[0].flex, 0);
  a.els.fb.onclick(); assert.ok(a.doc.querySelectorAll('x').length >= 1); a.els.rp.onclick();
  assert.ok(txt(a.els.changes.innerHTML).includes('No change needed'), txt(a.els.changes.innerHTML));
});
test('IN-14b documented engine behavior: minutes that cannot form a session (<15) are lost when the day passes (a REAL change)', () => {
  // 100 min/day: Exam takes 90, the 10 leftover minutes are below MIN_BLOCK so Essay gets no block today.
  const a = userScenario(); assert.strictEqual(a.ctx.__R().days[0].flex, 10);
  a.els.fb.onclick(); a.els.rp.onclick();
  const c = txt(a.els.changes.innerHTML); assert.ok(c.includes('Essay') && !c.includes('Exam') && !c.includes('Reading'), c);
  assert.strictEqual(a.ctx.__R().tasks.find((t) => t.name === 'Essay').allocated, 100);   // was 110: the 10 spare minutes were never usable
});
test('IN-15 REPLAN on user data: only real changes, no double counting, Exam untouched', () => {
  const a = boot().start().add('Essay', '120', 3, '1').add('Exam', '90', 5, '1').add('Reading', '60', 1, '1').plan(120);
  const R0 = a.ctx.__R(); const day0 = (id) => R0.blocks.filter((b) => b.day === 0 && b.taskId === id).reduce((s, b) => s + b.minutes, 0);
  assert.strictEqual(day0('u2'), 90); assert.strictEqual(day0('u1'), 30);
  a.fell({ u2: '90', u1: '0' });                                       // did the exam block, skipped the essay block
  const S = a.ctx.__S(), R = a.ctx.__R(); const done = (id) => S.tasks.find((t) => t.id === id).completed;
  assert.strictEqual(done('u2'), 90); assert.strictEqual(done('u1'), 0); assert.strictEqual(done('u3'), 0);
  assert.strictEqual(R.tasks.reduce((s, t) => s + t.remaining, 0), 270 - 90);                       // original - completed, counted once
  const ex = R.tasks.find((t) => t.id === 'u2'); assert.strictEqual(ex.decision, 'done'); assert.strictEqual(ex.allocated, 0);
  const c = txt(a.els.changes.innerHTML); assert.ok(c.includes('Reading') && c.includes('deferred') && !c.includes('Exam') && !c.includes('Essay'), c);
  assert.strictEqual(JSON.stringify(R), JSON.stringify(TE.runTriageEngine(S)));                       // engine is the only brain
});
test('IN-16 XSS: hostile task names never become tags or attributes (allowlist check on all rendered HTML)', () => {
  const evil = ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "' onmouseover='alert(1)", '</div><b id=pwn>', '&lt;script&gt;', 'x" data-rm="u1'];
  const a = boot().start(); evil.forEach((n, i) => a.add(n, '40', (i % 5) + 1, String(i % 2)));
  assert.strictEqual(a.ctx.__D().length, evil.length); a.plan(60); a.fell({});
  const TAGS = new Set(['div', 'span', 'b', 'time', 'details', 'summary', 'p', 'input', 'button', 'h2']);
  const ATTR = new Set(['class', 'style', 'data-id', 'data-rm', 'aria-label', 'type', 'min', 'max', 'value', 'id']);
  ['status', 'taskList', 'triage', 'blocks', 'behind', 'changes'].forEach((k) => {
    for (const m of a.els[k].innerHTML.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
      assert.ok(TAGS.has(m[1].toLowerCase()), k + ': unexpected tag <' + m[1] + '>');
      const rest = m[2].replace(/\s+([\w-]+)="([^"]*)"/g, (x, n) => { assert.ok(ATTR.has(n), k + ': unexpected attribute ' + n); return ''; });
      assert.strictEqual(rest.replace(/\/$/, '').trim(), '', k + ': stray attribute text: ' + rest);
    }
  });
  const all = a.els.taskList.innerHTML + a.els.triage.innerHTML;
  assert.ok(all.includes('&lt;img src=x onerror=alert(1)&gt;'));
  [...a.els.taskList.innerHTML.matchAll(/data-rm="([^"]*)"/g)].forEach((m) => assert.ok(/^u\d+$/.test(m[1]), m[1]));
  [...a.els.behind.innerHTML.matchAll(/data-id="([^"]*)"/g)].forEach((m) => assert.ok(/^u\d+$/.test(m[1]), m[1]));
});
test('IN-17 Demo mode preserved: same numbers and decisions as before', () => {
  const a = boot(); const s = txt(a.els.status.innerHTML); assert.ok(s.includes('Short by 2h') && s.includes('10h needed') && s.includes('8h available'));
  const t = txt(a.els.triage.innerHTML);
  ['Math homework FULL 45m', 'Math quiz prep FULL 1h', 'Biology exam PROTECTED 2h 30m', 'History project FULL 2h 30m', 'English essay 1h 30m → 45m', 'Chemistry lab 45m → 30m', 'Physics worksheet DEFERRED 1h'].forEach((x) => assert.ok(t.includes(x), x));
  assert.ok(txt(a.els.taskList.innerHTML).includes('Math homework 45m · importance 3 · due tomorrow 08:00'));
});
test('IN-18 user mode -> Reset demo restores the exact demo; BUG-1 fix still holds in demo', () => {
  const a = boot(); const first = JSON.stringify(a.ctx.__R()); a.start().add('A', '30', 3, '1').plan(60); a.els.reset.onclick();
  assert.strictEqual(JSON.stringify(a.ctx.__R()), first); assert.strictEqual(a.els.rest.hidden, false);
  a.fell({ math: '45', eng: '45', quiz: '30' }); assert.ok(txt(a.els.changes.innerHTML).includes('No change needed'));
});
test('IN-19 editing tasks after a plan rebuilds from scratch (no leftover progress, no double counting)', () => {
  const a = userScenario(); a.fell({ u2: '45' }); assert.ok(a.ctx.__S().tasks.some((t) => t.completed > 0));
  a.add('Extra', '30', 2, '3'); assert.strictEqual(a.els.rest.hidden, true);
  a.plan(100); const R = a.ctx.__R(); assert.strictEqual(a.ctx.__S().tasks.every((t) => t.completed === 0), true);
  assert.strictEqual(R.summary.workload, 120 + 90 + 60 + 30); assert.strictEqual(a.els.changes.innerHTML, '');
});
test('IN-20 due-today task is planned today; determinism of the whole user flow', () => {
  const a = boot().start().add('Quick', '30', 3, '0').plan(60); assert.ok(a.ctx.__R().blocks.every((b) => b.day === 0)); assert.strictEqual(a.ctx.__R().status, 'verified');
  const run = () => JSON.stringify(userScenario().fell({ u2: '30' }).ctx.__R()); assert.strictEqual(new Set([1, 2, 3, 4]).size && new Set([run(), run(), run()]).size, 1);
});
test('IN-21 task limit and name length enforced', () => {
  const a = boot().start(); for (let i = 0; i < 30; i++) a.add('T' + i, '10', 3, '5'); a.add('one more', '10', 3, '5');
  assert.strictEqual(a.ctx.__D().length, 30); assert.ok(/at most 30/.test(a.els.formErr.textContent));
  assert.strictEqual(boot().start().add('x'.repeat(61), '30', 3, '1').ctx.__D().length, 0);
});
test('IN-22 buildState output is valid engine input; no importance/deadline rules duplicated', () => {
  const st = TI.buildState([{ id: 'u1', name: 'A', estimate: 30, importance: 3, days: 2 }], 90);
  assert.doesNotThrow(() => TE.runTriageEngine(st)); assert.strictEqual(st.capacity.length, 3); assert.strictEqual(st.now, 900);
  assert.ok(!/\bimp\w*\s*(===|!==|>=|<=|<|>)\s*\d/.test(code), 'importance comparison found in index.html script: the UI must not decide Protect/Reduce/Defer');
});

// ---- final polish: behaviors added in the hardening pass ----
test('IN-24 focus moves to the FIRST invalid field (form order) and marks every invalid field', () => {
  const a = boot().start(); const f0 = a.els.tEst.focused; a.add('Essay', 'abc', 3, '1');
  assert.strictEqual(a.els.tEst.focused, f0 + 1); assert.strictEqual(a.els.tEst.attrs['aria-invalid'], 'true'); assert.strictEqual(a.els.tName.attrs['aria-invalid'], undefined);
  const b = boot().start(); const n0 = b.els.tName.focused, e0 = b.els.tEst.focused; b.add('', 'abc', 3, '1');   // name AND time wrong -> only the name gets focus
  assert.strictEqual(b.els.tName.focused, n0 + 1); assert.strictEqual(b.els.tEst.focused, e0);
  assert.strictEqual(b.els.tName.attrs['aria-invalid'], 'true'); assert.strictEqual(b.els.tEst.attrs['aria-invalid'], 'true');
  b.els.tEst.oninput(); assert.strictEqual(b.els.tEst.attrs['aria-invalid'], undefined);   // typing clears the red state
  const c = boot().start().add('A', '30', 3, '1'); const v0 = c.els.tAvail.focused; c.plan('-4');
  assert.strictEqual(c.els.tAvail.focused, v0 + 1); assert.strictEqual(c.els.tAvail.attrs['aria-invalid'], 'true');
  const d = boot().start(); const m0 = d.els.tName.focused; d.plan(60); assert.strictEqual(d.els.tName.focused, m0 + 1);   // no tasks -> focus the name field
});
test('IN-25 PLAN MY TIME is disabled until there is at least one task, with a visible reason', () => {
  const a = boot().start(); assert.strictEqual(a.els.planBtn.disabled, true); assert.ok(/at least one task/i.test(a.els.planHint.textContent));
  a.add('A', '30', 3, '1'); assert.strictEqual(a.els.planBtn.disabled, false); assert.strictEqual(a.els.planHint.textContent, '');
  a.rm('u1'); assert.strictEqual(a.els.planBtn.disabled, true);
});
test('IN-26 add / remove give clear feedback, and say when an old plan was cleared', () => {
  const a = boot().start().add('Essay', '60', 3, '1'); assert.strictEqual(a.els.formMsg.textContent, 'Added "Essay". 1 task ready. Add more, or press PLAN MY TIME.');
  a.plan(120); a.add('Quiz', '30', 4, '1'); assert.ok(/Added "Quiz"\. 2 tasks ready\. The old plan was cleared/.test(a.els.formMsg.textContent), a.els.formMsg.textContent);
  a.plan(120); a.rm('u1'); assert.ok(/Removed "Essay"\. 1 task left\. The old plan was cleared/.test(a.els.formMsg.textContent), a.els.formMsg.textContent);
  assert.strictEqual(a.els.tName.focused >= 1, true);
});
test('IN-27 I FELL BEHIND inputs are labelled with the (escaped) task name', () => {
  const a = boot().start().add('Q"<b>x', '60', 3, '0').plan(120); a.els.fb.onclick();
  assert.ok(a.els.behind.innerHTML.includes('aria-label="Minutes actually done: Q&quot;&lt;b&gt;x"'), a.els.behind.innerHTML);
});
test('IN-28 planning window is presented as a window (not the device clock); no stray escape text in the HTML', () => {
  const a = userScenario(); assert.ok(txt(a.els.blocks.innerHTML).includes('15:00\u201322:00 planning window, not your device clock'), txt(a.els.blocks.innerHTML));
  const markup = html.split('<script')[0]; assert.ok(!/\\u[0-9a-f]{4}/i.test(markup), 'literal \\uXXXX text in the visible HTML');
  assert.ok(markup.includes('15:00\u201322:00 each day') && /not your device clock/.test(markup));
});

console.log('Input tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
