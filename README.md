# Triage

**A study planner that tells the truth.**

You enter what you have to do and the time you actually have. Triage tells you whether that is realistic. If it is not, it says exactly what to protect, what to reduce and what to defer, and why. If you fall behind, it re-plans from what you really did.

Live demo: https://image19image-code.github.io/triage-study-planner/

## The problem

Most planners accept any plan, even an impossible one. Students find out on the night before the deadline. Triage does the arithmetic first (work due before each deadline vs. time available before it) and refuses to pretend.

## How it decides

For every deadline it compares the work due by then with the time available before then. The largest difference is the **shortfall**. Then:

| Decision | Rule |
|---|---|
| **Protect** | Importance 5 is never cut. |
| **Reduce** | A task can be shortened, down to 50% of its estimate at most. All-or-nothing tasks are never shortened. |
| **Defer** | A whole task is dropped from the plan when reducing is not enough. |

Order of sacrifice: lowest importance first. If that importance level can absorb the shortfall by reductions alone, only reductions are used. Otherwise one whole task is deferred (the one that wastes the fewest minutes) and the check repeats. Ties: larger task first, then later deadline, then later entry. Every decision has a **Why?** that states the reason. When nothing is left to cut, it says **Still impossible** and by how much.

Scheduling: earliest deadline first, in blocks of 15-50 minutes, inside a planning window of **15:00-22:00** each day (at most 7h/day count). This is a fixed planning window, not your device clock.

**I FELL BEHIND**: you enter the minutes you actually did. Triage recomputes `remaining = estimate - completed` for every task and runs the whole decision again from scratch. Nothing from the previous plan is stored, so progress is counted exactly once.

**These decisions are deterministic. There is no AI, no network call and no randomness**: the same input always gives the same plan.

## Using it

1. Open the page. It starts with demo data (10h of work, 8h of time).
2. Press **I FELL BEHIND** in the demo, enter what you did, press **REPLAN**.
3. Press **Use my own tasks**. Add tasks (name, minutes needed, importance 1-5, due in N days where 0 = today), enter your available minutes per day, press **PLAN MY TIME**.

Quick example: Essay 120 min (importance 3), Exam 90 (5), Reading 60 (1), all due tomorrow, 100 min/day. Needed 4h 30m, available 3h 20m, short by 1h 10m. Exam is protected, Reading is deferred, Essay goes from 2h to 1h 50m.

## Architecture

```
index.html            UI only: renders what the engine returns
   |
engine/task-input.js  validates form input, builds the engine's state
   |
engine/triage-engine.js   the decision engine (pure functions, no DOM)
```

The UI contains no Protect / Reduce / Defer rules. Everything is plain static files with no dependencies and no build step.

## Run locally

Open `index.html` in a browser, or serve the folder: `python3 -m http.server 8080`. It deploys as-is to GitHub Pages.

## Tests

```
npm test        # Node 18+, no installs
```

- `tests/triage-engine.test.js`: engine unit, golden-scenario and property tests (4000 random states checked against hard invariants).
- `tests/ui.test.js`: runs the real script of `index.html` on a minimal fake DOM and checks every decision it displays.
- `tests/input.test.js`: task input, validation, replanning on user data, XSS.

The UI tests do not render CSS or layout; check responsive layout in a real browser.

## Known limitations

- Tasks live in memory only: refreshing the page resets everything.
- One available-minutes value is applied to every day.
- After a REPLAN you cannot start a second REPLAN for the next day.
- Free minutes shorter than 15 in a day count as capacity but cannot form a session.
- The planning window and the 50% reduction limit are product settings, not facts.
