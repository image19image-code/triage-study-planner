'use strict';
/**
 * Product System Test Suite:
 * Validates the higher-level product capabilities added to Triage:
 * 1. Plan Horizon calculation
 * 2. Buffer / Brittleness diagnosis
 * 3. What-If scenario comparisons
 * 4. Data export / import schema validation & safety
 * 5. Local storage serialization & recovery
 * 6. XSS protection on exported and imported data
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const DIR = process.env.TRIAGE_DIR || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const code = html.split('<script>')[1].split('</script>')[0];
const TE = require(path.join(DIR, 'engine', 'triage-engine.js'));
const TI = require(path.join(DIR, 'engine', 'task-input.js'));

function boot() {
  const els = {}, errors = [];
  const el = (id) => els[id] || (els[id] = {
    id, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
    onclick: null, attrs: {}, focused: 0,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k]; },
    focus() { this.focused++; }
  });
  const doc = { getElementById: el, values: {} };
  doc.querySelectorAll = () => {
    const out = [];
    const re = /<input[^>]*value="(\d+)"[^>]*data-id="([^"]*)"/g;
    let m;
    while ((m = re.exec(els.behind ? els.behind.innerHTML : ''))) {
      out.push({ value: doc.values[m[2]] !== undefined ? doc.values[m[2]] : m[1], dataset: { id: m[2] } });
    }
    return out;
  };
  const ctx = { TriageEngine: TE, TaskInput: TI, document: doc, console };
  try {
    vm.runInNewContext(code + ';this.__S=()=>S;this.__R=()=>R;this.__D=()=>draft;this.__W=()=>whatIf;this.__sys=()=>typeof TriageSystem !== "undefined" ? TriageSystem : null;', ctx);
  } catch (e) {
    errors.push(e.message);
  }
  return { els, doc, ctx, errors };
}

let pass = 0, fail = 0;
const test = (name, fn) => {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]);
  }
};

// --- Test 1: Boots cleanly with system capabilities exposed
test('SYS-01 Boot system exposes TriageSystem capabilities', () => {
  const a = boot();
  assert.deepStrictEqual(a.errors, []);
  const sys = a.ctx.__sys();
  assert.ok(sys !== null, 'TriageSystem should be exported');
  assert.strictEqual(typeof sys.computeHorizon, 'function');
  assert.strictEqual(typeof sys.computeBufferDiagnosis, 'function');
  assert.strictEqual(typeof sys.computeScenarios, 'function');
  assert.strictEqual(typeof sys.validateImport, 'function');
  assert.strictEqual(typeof sys.exportPlanJson, 'function');
});

// --- Test 2: Horizon Calculation
test('SYS-02 computeHorizon extracts days, allocations, and flex correctly', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  const S = a.ctx.__S(), R = a.ctx.__R();
  const horizon = sys.computeHorizon(R, S);
  assert.ok(Array.isArray(horizon));
  assert.strictEqual(horizon.length, S.capacity.length);
  // Day 0 in demo has 120 avail, 120 used, 0 flex
  assert.strictEqual(horizon[0].day, 0);
  assert.strictEqual(horizon[0].avail, 120);
  assert.strictEqual(horizon[0].used, 120);
  assert.strictEqual(horizon[0].flex, 0);
  assert.strictEqual(horizon[0].status, 'full');
  // Day 3 in demo is a day off (0 capacity)
  assert.strictEqual(horizon[3].avail, 0);
  assert.strictEqual(horizon[3].status, 'rest');
});

// --- Test 3: Buffer Diagnosis
test('SYS-03 computeBufferDiagnosis correctly diagnoses demo shortfall and slack', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  const diag = sys.computeBufferDiagnosis(a.ctx.__R());
  assert.strictEqual(diag.status, 'shortfall');
  assert.ok(diag.shortfallMinutes === 120);
  assert.ok(diag.title.includes('Short by 2h'));
});

test('SYS-04 computeBufferDiagnosis on feasible plan detects tight vs robust slack', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  // Plan with plenty of capacity
  const stHealthy = TI.buildState([{ id: 't1', name: 'Quick task', estimate: 30, importance: 3, days: 2 }], 120);
  const rHealthy = TE.runTriageEngine(stHealthy);
  const diagHealthy = sys.computeBufferDiagnosis(rHealthy);
  assert.strictEqual(diagHealthy.status, 'robust');
  assert.ok(diagHealthy.minSlack > 15);

  // Plan with minimal slack (<15 min)
  const stTight = TI.buildState([{ id: 't2', name: 'Tight task', estimate: 110, importance: 3, days: 0 }], 120);
  const rTight = TE.runTriageEngine(stTight);
  const diagTight = sys.computeBufferDiagnosis(rTight);
  assert.strictEqual(diagTight.status, 'tight');
});

// --- Test 4: Scenario Comparisons
test('SYS-05 computeScenarios computes deltas for -30, -15, +15, +30 without mutating state', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  const S = a.ctx.__S();
  const originalJson = JSON.stringify(S);
  const scenarios = sys.computeScenarios(S);
  assert.strictEqual(JSON.stringify(S), originalJson, 'Baseline state must not be mutated');
  assert.ok(Array.isArray(scenarios));
  assert.strictEqual(scenarios.length, 5); // -30, -15, 0 (baseline), +15, +30
  const plus30 = scenarios.find((s) => s.delta === 30);
  assert.ok(plus30);
  assert.strictEqual(plus30.shortfall, 0, '+30 min/day in demo eliminates the 2h shortfall');
  const minus15 = scenarios.find((s) => s.delta === -15);
  assert.ok(minus15.shortfall > 120, '-15 min/day increases shortfall');
});

// --- Test 5: Plan Export and Import Validation
test('SYS-06 exportPlanJson formats valid JSON with schema version and metadata', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  const draft = [
    { id: 'u1', name: 'Essay', estimate: 60, importance: 4, days: 2 }
  ];
  const exported = sys.exportPlanJson(draft, 90);
  const parsed = JSON.parse(exported);
  assert.strictEqual(parsed.app, 'Triage');
  assert.strictEqual(parsed.version, 1);
  assert.strictEqual(parsed.availablePerDay, 90);
  assert.strictEqual(parsed.tasks.length, 1);
  assert.strictEqual(parsed.tasks[0].name, 'Essay');
});

test('SYS-07 validateImport accepts valid exported plans', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  const validJson = JSON.stringify({
    app: 'Triage',
    version: 1,
    availablePerDay: 120,
    tasks: [
      { name: 'Research Paper', estimate: 90, importance: 4, days: 3 },
      { name: 'Problem Set', estimate: 45, importance: 3, days: 1 }
    ]
  });
  const res = sys.validateImport(validJson);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.tasks.length, 2);
  assert.strictEqual(res.availablePerDay, 120);
});

test('SYS-08 validateImport safely rejects corrupted, empty, or hostile JSON', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  ['not a json', '', '{}', JSON.stringify({ app: 'other' }), JSON.stringify({ tasks: 'not-array' }), JSON.stringify({ tasks: [], availablePerDay: -10 })].forEach((invalid) => {
    const res = sys.validateImport(invalid);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error.length > 0);
  });
});

test('SYS-09 validateImport sanitizes task names and enforces bounds', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  const payload = JSON.stringify({
    app: 'Triage',
    version: 1,
    availablePerDay: 120,
    tasks: [
      { name: '<script>alert(1)</script>', estimate: 60, importance: 3, days: 1 },
      { name: 'Valid', estimate: 999999, importance: 3, days: 1 } // invalid estimate
    ]
  });
  const res = sys.validateImport(payload);
  assert.strictEqual(res.ok, false);
  assert.ok(/Estimated time/i.test(res.error));
});

test('SYS-10 schedule text format generates clean readable output', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  const text = sys.formatScheduleText(a.ctx.__R(), a.ctx.__S());
  assert.ok(text.includes('TRIAGE STUDY PLAN'));
  assert.ok(text.includes('Short by 2h'));
  assert.ok(text.includes('Assessment preparation') && text.includes('PROTECTED'));
  assert.ok(text.includes('15:00'));
});

test('SYS-11 validateImport protects against prototype pollution and strips unwanted properties', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  const payload = JSON.stringify({
    app: 'Triage',
    version: 1,
    availablePerDay: 90,
    tasks: [
      { name: 'Research task', estimate: 45, importance: 3, days: 1, role: 'admin', isMalicious: true }
    ]
  });
  const res = sys.validateImport(payload);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.tasks.length, 1);
  const task = res.tasks[0];
  assert.strictEqual(task.name, 'Research task');
  assert.strictEqual(task.estimate, 45);
  assert.strictEqual(task.role, undefined);
  assert.strictEqual(task.isMalicious, undefined);
  assert.deepStrictEqual(Object.keys(task).sort(), ['days', 'estimate', 'id', 'importance', 'name']);
});

test('SYS-12 validateImport gracefully rejects non-object task items', () => {
  const a = boot();
  const sys = a.ctx.__sys();
  ['null', '"just a string"', '123'].forEach((invalidItem) => {
    const payload = '{"app":"Triage","version":1,"availablePerDay":90,"tasks":[' + invalidItem + ']}';
    const res = sys.validateImport(payload);
    assert.strictEqual(res.ok, false);
    assert.ok(/invalid task format/i.test(res.error));
  });
});

test('SYS-13 loadFromStorage safely sanitizes corrupt localStorage data without crashing', () => {
  let removed = false;
  const badStorage = {
    getItem: () => JSON.stringify({ mode: 'user', draft: [{ name: 'Tampered', estimate: -50, importance: 99 }], available: 120 }),
    removeItem: (k) => { removed = true; },
    setItem: () => {}
  };
  const a = boot();
  // Execute loadFromStorage with corrupt storage
  const ctx = Object.assign({}, a.ctx, { localStorage: badStorage });
  assert.doesNotThrow(() => {
    vm.runInNewContext(code, ctx);
  });
  assert.strictEqual(removed, true, 'Corrupt storage should be cleared');
});

test('SYS-14 recovery view provides working cancel action to dismiss without replanning', () => {
  const a = boot();
  assert.ok(a.els.behind.innerHTML.includes('id="fb"'));
  a.els.fb.onclick(); // Open recovery
  assert.ok(a.els.behind.innerHTML.includes('REPLAN'));
  assert.ok(a.els.behind.innerHTML.includes('btnCancelBehind'));
  a.els.btnCancelBehind.onclick(); // Cancel recovery
  assert.ok(a.els.behind.innerHTML.includes('id="fb"'), 'Must return cleanly to prompt on cancel');
});

test('SYS-15 trapModalFocus traps Tab key navigation within modal dialog', () => {
  const a = boot();
  const focused = [];
  const btns = [
    { id: 'btn1', focus: () => focused.push('btn1') },
    { id: 'btn2', focus: () => focused.push('btn2') }
  ];
  const fakeContainer = {
    hidden: false,
    querySelectorAll: () => btns
  };
  let trapped = false;
  const keyEvent = {
    key: 'Tab',
    shiftKey: false,
    preventDefault: () => { trapped = true; }
  };
  a.ctx.document.activeElement = btns[1]; // activeElement at last item
  a.ctx.trapModalFocus = vm.runInNewContext('trapModalFocus', a.ctx);
  a.ctx.trapModalFocus(fakeContainer);
  fakeContainer.onkeydown(keyEvent);
  assert.strictEqual(trapped, true, 'Tab at last item must be prevented and wrap to first');
  assert.strictEqual(focused[0], 'btn1', 'First item must receive focus');
});

console.log('Product system tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
