# review

**Purpose:** spaced repetition (FSRS) with append-only review logs and deterministic card rebuild.

**Public interface**
- `createScheduler()` (ts-fsrs `DefaultScheduler`, FSRS-7, retention 0.9, steps 1m/10m,
  relearning 10m, **fuzz off**), `SCHEDULER_CONFIG`, `toRating`, `GRADE_LABEL`, `snapshot(card)`.
- Logs: `reviewLogSchema`, `mergeLogs(...sets)` (union by id, sorted by time then id),
  `sortLogs`, `rebuildCard(scheduler, cardId, createdAt, logs)`, `rebuildSnapshot`.
- Self-test: `runFsrsSelfTest(scheduler)`, `goldenSnapshots`, `goldenLogs`.

**Golden values:** `golden.ts` holds the expected card state after each of 8 fixed reviews,
computed in Node 24 with ts-fsrs 6.0.0. The unit test checks Node still matches; the review spike
checks the phone (Hermes) matches. If you intentionally change ts-fsrs or the config, regenerate:

```bash
FSRS_PRINT_GOLDEN=1 npx jest src/modules/review      # PowerShell: $env:FSRS_PRINT_GOLDEN=1; npx jest src/modules/review
```

and paste the printed array into `GOLDEN_EXPECTED`.

**How to extend:** keep fuzz off unless it becomes deterministic per card (for example seeded by
card id); never store card state as the source of truth, only logs.
