'use strict';
/**
 * Task input: validation + conversion to the engine's state. NO triage logic lives here.
 * Deadline = "due in N whole days" (0 = today). Date-only, so the engine treats it as end of that day (22:00),
 * exactly like the demo's date-only tasks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TaskInput = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITS = Object.freeze({ MAX_NAME: 60, MAX_MINUTES: 1440, MAX_DAYS: 60, MAX_TASKS: 30 });
  const NOW = 900; // planning starts at 15:00 on day 0 (same assumption as the demo)

  /** Strict whole-number parser. Returns {value} or {error}. Never converts bad input to 0 silently. */
  function whole(raw, label, min, max) {
    const s = String(raw === undefined || raw === null ? '' : raw).trim();
    if (s === '') return { error: label + ': enter a number.' };
    if (/^-/.test(s)) return { error: label + " can't be negative." };
    if (/^\d+[.,]\d+$/.test(s)) return { error: label + ': use whole numbers (no decimals).' };
    if (!/^\d+$/.test(s)) return { error: label + ' must be a number.' };
    const n = Number(s);
    if (n < min) return { error: label + ' must be at least ' + min + '.' };
    if (n > max) return { error: label + ' must be at most ' + max + '.' };
    return { value: n };
  }

  function validateTask(raw) {
    const errors = {};
    const name = String(raw && raw.name !== undefined && raw.name !== null ? raw.name : '').replace(/\s+/g, ' ').trim();
    if (!name) errors.name = 'Task name is required.';
    else if (name.length > LIMITS.MAX_NAME) errors.name = 'Task name is too long (max ' + LIMITS.MAX_NAME + ').';
    const est = whole(raw && raw.estimate, 'Estimated time (minutes)', 1, LIMITS.MAX_MINUTES);
    if (est.error) errors.estimate = est.error;
    const imp = whole(raw && raw.importance, 'Importance', 1, 5);
    if (imp.error) errors.importance = imp.error;
    const days = whole(raw && raw.days, 'Due in (days)', 0, LIMITS.MAX_DAYS);
    if (days.error) errors.days = days.error;
    const ok = Object.keys(errors).length === 0;
    return { ok, errors, task: ok ? { name, estimate: est.value, importance: imp.value, days: days.value } : null };
  }

  function validateAvailable(raw) {
    const r = whole(raw, 'Available study time (minutes per day)', 0, LIMITS.MAX_MINUTES);
    return r.error ? { ok: false, error: r.error } : { ok: true, value: r.value };
  }

  /** draft: [{id,name,estimate,importance,days}]  ->  engine state. The engine decides everything else. */
  function buildState(draft, availablePerDay) {
    const lastDay = Math.max(0, ...draft.map((t) => t.days));
    return {
      now: NOW,
      capacity: Array.from({ length: lastDay + 1 }, () => availablePerDay),
      tasks: draft.map((t, i) => ({
        id: t.id, name: t.name, seq: i + 1, deadlineDay: t.days, estimate: t.estimate,
        completed: 0, importance: t.importance, allOrNothing: false,
      })),
    };
  }

  /**
   * What-if: returns a NEW state where every study day (capacity > 0) gains `delta` minutes (never below 0).
   * Days with 0 stay 0 (a day off is not a study day). delta = 0 returns an equal state. The input is never mutated.
   */
  function adjustCapacity(state, delta) {
    if (!Number.isInteger(delta)) throw new TypeError('delta must be an integer number of minutes');
    return Object.assign({}, state, { capacity: state.capacity.map((c) => (c > 0 ? Math.max(0, c + delta) : 0)) });
  }

  return { validateTask, validateAvailable, buildState, adjustCapacity, LIMITS };
});
