'use strict';
/**
 * Triage Engine v1.3  (pure logic: no UI, no network, no storage, no AI)
 *
 * Principle:  Deadline decides EXECUTION order.  Importance decides SACRIFICE order.
 * Source of truth: the input `state` only. Nothing from previous runs is ever read.
 *
 * All quantities are integer minutes. No rounding except the two conservative
 * divisions documented below (usable = floor, floorTotal = ceil).
 *
 * state = {
 *   now: 900,                  // minutes since midnight, on day 0 (= today)
 *   capacity: [120, 60, ...],  // minutes the student CLAIMS to have on day 0,1,2...
 *   tasks: [{ id, name, seq, deadlineDay, deadlineTime?, estimate, completed,
 *             importance (1-5), allOrNothing, status? ('active'|'done'|'dropped') }],
 *   settings?: { MIN_BLOCK, MAX_BLOCK, MIN_FRACTION, WINDOW_START, WINDOW_END }
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TriageEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // ---- Product settings (declared assumptions, NOT mathematical facts) ----
  const DEFAULTS = Object.freeze({
    MIN_BLOCK: 15,        // smallest normal study session
    MAX_BLOCK: 50,        // largest single session
    MIN_FRACTION: 0.5,    // a reducible task keeps at least 50% of its estimate
    WINDOW_START: 900,    // 15:00
    WINDOW_END: 1320,     // 22:00
  });
  const PROTECTED_IMPORTANCE = 5;

  const cmpT = (a, b) => (a.day - b.day) || (a.time - b.time);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const mkCfg = (state) => Object.assign({}, DEFAULTS, (state && state.settings) || {});

  // ------------------------------------------------------------------ validation
  function validate(state) {
    const bad = (m) => { throw new TypeError('Invalid state: ' + m); };
    if (!state || !Array.isArray(state.tasks) || !Array.isArray(state.capacity)) bad('needs tasks[] and capacity[]');
    if (!Number.isInteger(state.now) || state.now < 0) bad('now must be a non-negative integer (minutes)');
    state.capacity.forEach((c, i) => { if (!Number.isInteger(c) || c < 0) bad('capacity[' + i + ']'); });
    const ids = new Set();
    state.tasks.forEach((t, i) => {
      if (t.id === undefined || ids.has(t.id)) bad('task id missing or duplicated at index ' + i);
      ids.add(t.id);
      ['estimate', 'completed', 'deadlineDay'].forEach((k) => {
        if (!Number.isInteger(t[k])) bad('task ' + t.id + '.' + k + ' must be an integer');
      });
      if (t.estimate < 0 || t.completed < 0) bad('task ' + t.id + ' has negative minutes');
      if (!Number.isInteger(t.importance) || t.importance < 1 || t.importance > 5) bad('task ' + t.id + '.importance must be 1..5');
      if (t.deadlineTime !== undefined && (!Number.isInteger(t.deadlineTime) || t.deadlineTime < 0 || t.deadlineTime > 1439)) bad('task ' + t.id + '.deadlineTime');
    });
  }

  // ------------------------------------------------------------------ capacity
  const windowStart = (state, d, cfg) => (d === 0 ? Math.max(state.now, cfg.WINDOW_START) : cfg.WINDOW_START);
  const windowLen = (state, d, cfg) => Math.max(0, cfg.WINDOW_END - windowStart(state, d, cfg));

  /** Real minutes available on day d (never rounded). */
  function capacityAvail(state, d, cfg) {
    cfg = cfg || mkCfg(state);
    if (d < 0) return 0;
    return Math.min(Math.max(0, state.capacity[d] || 0), windowLen(state, d, cfg));
  }

  /** Minutes of day d usable before time tau (uniform spread inside the window). floor = never over-promise. */
  function capacityUsable(state, d, tau, cfg) {
    cfg = cfg || mkCfg(state);
    const L = windowLen(state, d, cfg);
    if (d < 0 || L <= 0) return 0;
    const O = clamp(tau - windowStart(state, d, cfg), 0, L);
    return Math.floor((capacityAvail(state, d, cfg) * O) / L);
  }

  /** C(T): all days strictly before T.day, plus the usable part of T.day. */
  function capacityUpTo(state, T, cfg) {
    cfg = cfg || mkCfg(state);
    let c = 0;
    for (let d = 0; d < T.day; d++) c += capacityAvail(state, d, cfg);
    return c + capacityUsable(state, T.day, T.time, cfg);
  }

  // ------------------------------------------------------------------ derived task values
  function deriveRow(t, i, state, cfg) {
    const remaining = Math.max(0, t.estimate - t.completed);
    const floorTotal = Math.ceil(t.estimate * cfg.MIN_FRACTION - 1e-9);
    const row = {
      id: t.id, name: t.name === undefined ? String(t.id) : t.name,
      seq: t.seq === undefined ? i : t.seq,
      importance: t.importance, allOrNothing: !!t.allOrNothing,
      estimate: t.estimate, completed: t.completed, remaining,
      floorFuture: Math.max(0, floorTotal - t.completed),
      T: { day: t.deadlineDay, time: t.deadlineTime === undefined ? cfg.WINDOW_END : t.deadlineTime },
      a: 0, kind: 'active',
    };
    if (t.status === 'dropped') row.kind = 'dropped';
    else if (t.status === 'done' || remaining === 0) row.kind = 'done';
    else if (row.T.day < 0 || (row.T.day === 0 && row.T.time <= state.now)) row.kind = 'overdue';
    return row;
  }

  const headroom = (r) => (r.allOrNothing ? 0 : Math.max(0, r.a - r.floorFuture));

  // ------------------------------------------------------------------ Shortfall engine
  /** For each distinct deadline T: W(T) = sum a(t) for T(t) <= T ; Gap = W - C. */
  function computeGaps(rows, state, cfg) {
    const seen = new Map();
    rows.forEach((r) => seen.set(r.T.day + ':' + r.T.time, r.T));
    const Ts = [...seen.values()].sort(cmpT);
    return Ts.map((T) => {
      let W = 0;
      rows.forEach((r) => { if (cmpT(r.T, T) <= 0) W += r.a; });
      const C = capacityUpTo(state, T, cfg);
      return { T: { day: T.day, time: T.time }, W, C, gap: W - C };
    });
  }

  // ------------------------------------------------------------------ Triage
  /**
   * Sacrifice order = importance ascending. Importance 5 is never touched.
   * Product policy: "We prefer partial preservation over full cancellation."
   *   1. If the lowest importance level can absorb the gap by reductions alone -> reduce only.
   *   2. Otherwise defer ONE whole task (least waste), then re-evaluate from scratch.
   * No recovery pass, no carry, no thresholds. Stops with "Still impossible" when nothing is left to sacrifice.
   */
  function triage(active, state, cfg) {
    const steps = [];
    let stillImpossible = null;
    for (let guard = 0; guard < 100000; guard++) {
      const bad = computeGaps(active, state, cfg).find((g) => g.gap > 0);
      if (!bad) break;
      const Tstar = bad.T, need = bad.gap;
      const pool = active.filter((r) => r.a > 0 && r.importance < PROTECTED_IMPORTANCE && cmpT(r.T, Tstar) <= 0);
      if (pool.length === 0) { stillImpossible = { T: Tstar, need }; break; }
      const level = Math.min(...pool.map((r) => r.importance));
      const lv = pool.filter((r) => r.importance === level);
      const sumHead = lv.reduce((s, r) => s + headroom(r), 0);

      if (sumHead >= need) {
        // reduce only. order: estimate desc -> later deadline first -> larger seq first
        const order = lv.filter((r) => headroom(r) > 0)
          .sort((x, y) => (y.estimate - x.estimate) || cmpT(y.T, x.T) || (y.seq - x.seq));
        let left = need;
        for (const r of order) {
          if (left === 0) break;
          const c = Math.min(headroom(r), left);
          r.a -= c; left -= c;
          steps.push({ kind: 'reduce', taskId: r.id, minutes: c, level, Tstar, need });
        }
      } else {
        // defer one whole task. cost = minutes cut in total if this task is the one deferred.
        const feasible = lv.filter((r) => r.a + lv.reduce((s, o) => s + (o === r ? 0 : headroom(o)), 0) >= need);
        let pick;
        if (feasible.length) {
          pick = feasible.sort((x, y) => (Math.max(x.a, need) - Math.max(y.a, need)) || cmpT(y.T, x.T) || (y.seq - x.seq))[0];
        } else {
          pick = lv.slice().sort((x, y) => (y.a - x.a) || cmpT(y.T, x.T) || (y.seq - x.seq))[0];
        }
        steps.push({ kind: 'defer', taskId: pick.id, minutes: pick.a, level, Tstar, need });
        pick.a = 0;
      }
    }
    return { steps, stillImpossible };
  }

  // ------------------------------------------------------------------ Scheduler
  function splitBlocks(g, cfg) {
    cfg = cfg || DEFAULTS;
    if (g <= 0) return [];
    const unit = g % 5 === 0 ? 5 : 1;          // presentation only: nicer blocks, never affects a decision
    const n = Math.ceil(g / cfg.MAX_BLOCK);
    const m = g / unit, q = Math.floor(m / n), r = m % n;
    const out = [];
    for (let i = 0; i < n; i++) out.push((i < r ? q + 1 : q) * unit);
    return out;
  }

  /** Places allocated minutes day by day in EDF order. Never cuts anything. */
  function schedule(active, state, cfg) {
    const tasks = active.filter((r) => r.a > 0)
      .sort((x, y) => cmpT(x.T, y.T) || (y.importance - x.importance) || (x.seq - y.seq));
    const left = new Map(tasks.map((r) => [r.id, r.a]));
    const blocks = [], days = [];
    const last = tasks.length ? Math.max(...tasks.map((r) => r.T.day)) : -1;
    for (let d = 0; d <= last; d++) {
      let used = 0;
      for (const r of tasks) {
        const l = left.get(r.id);
        if (l <= 0 || d > r.T.day) continue;
        const limit = d < r.T.day ? capacityAvail(state, d, cfg) : capacityUsable(state, d, r.T.time, cfg);
        const free = limit - used;
        if (free <= 0) continue;
        const g = Math.min(l, free);
        // A session is accepted if it is a normal-size session OR it finishes the task. MIN_BLOCK never blocks completion.
        if (g >= cfg.MIN_BLOCK || g === l) {
          splitBlocks(g, cfg).forEach((m) => blocks.push({ taskId: r.id, day: d, minutes: m }));
          used += g; left.set(r.id, l - g);
        }
      }
      const av = capacityAvail(state, d, cfg);
      days.push({ day: d, avail: av, used, flex: av - used });
    }
    return { blocks, days, unplaced: left };
  }

  // ------------------------------------------------------------------ reasons / formatting
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const fmtT = (T, cfg) => 'D' + T.day + (T.time === cfg.WINDOW_END ? '' : ' ' + hhmm(T.time));

  function decide(r) {
    if (r.kind !== 'active') return r.kind;                      // done | dropped | overdue
    if (r.a === r.remaining) return 'full';
    if (r.a === 0 && (r.allOrNothing || r.floorFuture > 0)) return 'deferred';
    return 'reduced';                                            // includes "stop at what you already did"
  }

  function reasonFor(r, decision, steps, cfg) {
    if (decision === 'done') return 'Nothing remaining.';
    if (decision === 'dropped') return 'Dropped by the student.';
    if (decision === 'overdue') return 'Deadline has passed: set a new deadline or drop it.';
    if (decision === 'full') return r.importance === PROTECTED_IMPORTANCE ? 'Protected (importance 5): never cut.' : 'Fits: kept in full.';
    const mine = steps.filter((s) => s.taskId === r.id);
    const s = mine[mine.length - 1];
    // "still scheduled" = tasks that were really candidates for this cut (already-deferred tasks are not counted).
    const why = s ? 'importance ' + s.level + ' was the lowest among the tasks still scheduled by ' + fmtT(s.Tstar, cfg) + ' (tasks already deferred are not counted); that deadline was short by ' + s.need + ' min.' : '';
    if (decision === 'deferred') return 'Deferred: ' + why;
    return 'Reduced ' + r.remaining + '\u2192' + r.a + ' min: ' + why;
  }

  // ------------------------------------------------------------------ main entry
  function runTriageEngine(state) {
    validate(state);
    const cfg = mkCfg(state);
    const rows = state.tasks.map((t, i) => deriveRow(t, i, state, cfg));
    const active = rows.filter((r) => r.kind === 'active');
    active.forEach((r) => { r.a = r.remaining; });

    const gapsInitial = computeGaps(active, state, cfg);
    const shortfall = Math.max(0, ...gapsInitial.map((g) => g.gap));
    const workload = active.reduce((s, r) => s + r.remaining, 0);
    const capacityTotal = gapsInitial.length ? gapsInitial[gapsInitial.length - 1].C : 0;

    const { steps, stillImpossible } = triage(active, state, cfg);
    const gapsFinal = computeGaps(active, state, cfg);
    const sched = schedule(active, state, cfg);

    const outTasks = rows.slice().sort((x, y) => x.seq - y.seq).map((r) => {
      const decision = decide(r);
      const placed = sched.blocks.filter((b) => b.taskId === r.id).reduce((s, b) => s + b.minutes, 0);
      const unplaced = r.kind === 'active' ? r.a - placed : 0;          // unplaced = allocated - sum(blocks)
      return {
        id: r.id, name: r.name, seq: r.seq, decision, importance: r.importance, protected: r.importance === PROTECTED_IMPORTANCE,
        remaining: r.remaining, allocated: r.a, cut: r.kind === 'active' ? r.remaining - r.a : 0,
        floorFuture: r.floorFuture, placed, unplaced, atRisk: unplaced > 0,
        reason: reasonFor(r, decision, steps, cfg),
      };
    });

    const anyRisk = outTasks.some((t) => t.atRisk);
    const status = stillImpossible ? 'impossible' : anyRisk ? 'atRisk' : 'verified';
    const allocated = active.reduce((s, r) => s + r.a, 0);

    return {
      status,
      summary: { workload, capacity: capacityTotal, shortfall, allocated, totalCut: workload - allocated },
      stillImpossible,                       // { T, need } | null
      gapsInitial, gapsFinal,
      overdue: rows.filter((r) => r.kind === 'overdue').map((r) => r.id),
      tasks: outTasks, steps,
      blocks: sched.blocks, days: sched.days,
    };
  }

  return { runTriageEngine, splitBlocks, capacityAvail, capacityUsable, capacityUpTo, DEFAULTS };
});
