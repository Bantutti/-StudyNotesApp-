# aiui: algorithms and rules (companion to the code)

Code comments cite this file as **§X.Y**. The engine's own maths (tokens, pacing, aliases, apply and
undo) is in `src/modules/ai/ALGORITHMS.md`; this file covers only what the AI *screens* decide.

---

## §1 Age rule (18+ gate, Rey Nov 1: birth year, neutral prompt, Q2 = A, Q3 = A)

### §1.1 Inputs and what is kept

- Inputs: a birth year `Y` typed by the student (no default value), and today's local date
  `C-M-D` (year, month 1–12, day).
- Kept on the phone: only `{ adult: true | false, checkedAt }` (§5). The year, month and day exist
  only in the screen's memory and are cleared once the check is done. They are never logged,
  never stored and never synced.
- The prompt is neutral: "What year were you born?" The cut-off (18) is not shown before the answer,
  so the screen doesn't suggest which year to type (Q2 = A).

### §1.2 Year check

Let `d = C − Y` (whole years between the birth year and this year).

| Condition | Result | Why |
|---|---|---|
| `Y` not a whole number, `Y < 1900`, or `Y > C` | `invalid` (ask again) | not a real birth year |
| `d ≥ 19` | `adult` | even if the birthday hasn't come yet this year, age ≥ `d − 1` ≥ 18 |
| `d ≤ 17` | `minor` | even after the birthday, age ≤ `d` ≤ 17 |
| `d = 18` | `need_month` | age is 17 before the birthday and 18 after it, so the year alone can't tell |

Proof for `d ≥ 19`: age on a given date is `d − 1` before the birthday and `d` from the birthday on, so
`age ≥ d − 1 ≥ 18`. For `d ≤ 17`: `age ≤ d ≤ 17`.

### §1.3 Boundary year (`d = 18`): month, then day only if needed

Ask the birth month `Mb` (1–12, no default). Compare it with today's month `M`:

| Condition | Result |
|---|---|
| `Mb < M` | `adult` (the 18th birthday was in an earlier month this year) |
| `Mb > M` | `minor` (the 18th birthday is later this year) |
| `Mb = M` | `need_day`: ask the day `Db` |

Day step (`Mb = M` only): valid days are `1 … daysIn(Y, Mb)`, where `daysIn` uses the *birth* year, so
Feb 29 is valid only for leap birth years.

| Condition | Result |
|---|---|
| `Db ≤ D` | `adult` |
| `Db > D` | `minor` |

**Feb 29 births.** In a non-leap current year there is no Feb 29, so on Feb 28 `Db = 29 > 28` and the result
is `minor`. On Mar 1 the month rule `Mb = 2 < 3` gives `adult`. In effect the birthday counts as Mar 1,
which is the stricter of the two usual legal readings (Feb 28 or Mar 1).

*Note for the Lead:* Q3 = A approved "ask the month in the boundary year". The day is asked in one
further case only: when the birth month is the current month, because the month alone can't decide that
case. It is never stored either.

### §1.4 Re-check (Q4 = A)

- `adult` answers stay until "Delete all data".
- A `minor` answer sticks too. A re-check is *offered* (never forced) once a full calendar year has
  passed since `checkedAt`: `now ≥ addYears(checkedAt, 1)`, with Feb 29 rolling to Mar 1. "Delete
  all data" also clears it.
- Why 12 months: anyone who is 17 on the check date turns 18 within 12 months. Offering it sooner
  would invite simply changing the year.

---

## §2 Word diff for the preview (Q9 = A)

### §2.1 Tokens

A block's display text (§2.4) is split into tokens `w₁ … wₙ`, each a run of non-spaces plus any
spaces after it (regex `\S+\s*`), so joining the tokens rebuilds the text exactly. Two tokens are
*equal* when their trimmed forms are equal (a change in spacing alone is not shown as an edit).

### §2.2 Longest common subsequence (LCS)

For "before" tokens `a₁ … aₙ` and "after" tokens `b₁ … bₘ`, let `L[i][j]` be the LCS length of the
suffixes `aᵢ …` and `bⱼ …`:

```
L[n+1][j] = L[i][m+1] = 0
L[i][j]   = L[i+1][j+1] + 1                 if aᵢ ≡ bⱼ
          = max(L[i+1][j], L[i][j+1])       otherwise
```

Walking forward from `(1, 1)`:
- if `aᵢ ≡ bⱼ`, emit `equal`;
- otherwise, if `L[i+1][j] ≥ L[i][j+1]`, emit `removed(aᵢ)`;
- otherwise emit `added(bⱼ)`.

Then emit whatever is left of either side. This gives a minimal edit script: the number of edits is
`n + m − 2·L[1][1]`. Adjacent segments of the same kind are merged.

### §2.3 Cost cap

Time and memory are `O(n·m)`. When `n > 400` or `m > 400` words (the cap in Q9 = A, at most about
160,000 table cells), the diff falls back to **whole block**: one `removed` segment with all of "before"
and one `added` segment with all of "after". The table is a flat `Uint16Array` (cell values ≤ 401 fit
in 16 bits).

### §2.4 Display text of a block

The preview shows plain text only (no HTML is ever rendered). For a node:
- text and hard breaks are joined (a hard break becomes a newline);
- block children are joined with newlines, list items get "• ";
- a definition shows as `term: meaning`; a heading has its level shown as a label, not as `#` marks.

Marks (bold, highlight and so on) are not shown in the diff, but they are kept exactly in the applied
document. The preview's job is to show *what text* changes. The note screen shows the final styling
after applying, and Undo restores it.

---

## §3 Flow state machine (Plan Flow 4)

### §3.1 Order of checks

When the student picks an action, the controller moves through these steps and stops at the first
one that isn't satisfied. The cheapest and most private checks come first, so nothing leaves the
phone until all of them pass:

```
blocked?  (subject has AI off)       -> step 'blocked'      (no network, no prompts)
age unknown?                         -> step 'age'          (§1)
minor?                               -> step 'minor'        (calm panel, no nagging)
no key for the chosen provider?      -> step 'key'          (wizard: provider, key page, paste, test)
no consent for this provider+version?-> step 'consent'      (explicit yes, Apple 5.1.2(i))
                                     -> step 'running'      (engine.run; Cancel aborts)
                                     -> step 'preview'      (or 'error' / 'empty')
apply                                -> resolve(doc)        (P1 runEditorAction saves "Before AI change")
```

The engine checks the same gates again on its own (defence in depth): if any of them fails, it throws
`blocked`, `age_required`, `consent_required` or `missing_key` and sends nothing. The controller then
routes that error back to the matching step.

### §3.2 One flow at a time

`start()` returns a promise that resolves **exactly once**: with the accepted document, or with a
cancellation (`AppError('cancelled')`). A second `start()` while one is open is refused. Closing the
modal from any step, including the system back gesture, settles the promise as cancelled. A running
request is aborted before the promise settles.

### §3.3 What can go into the flow state

The flow keeps in memory only the action id, the provider, the scope, the proposal and the accept
toggles. The note itself is the document `runEditorAction` passed in. The birth year and the typed key
are local state of their screens and are cleared when those screens close. No route parameters are
used, so nothing in the flow appears in navigation state or deep links.

---

## §4 Usage line and waits

### §4.1 "N of L today"

`N = usage.today(p).requests` counts every request made today (local day, ai/ALGORITHMS §8),
including failed ones, because providers count those too. `L` is the provider's published
requests-per-day limit for its **primary** model (`freeTier.limits[models.primary].rpd`). When `L` is
unknown (Mistral publishes no numbers), the line says "N today" and links to the provider's limits
page. When the provider sent a "requests left today" header, that number is shown as well, because
it's the provider's own count.

### §4.2 Wait wording

Waits come from the engine as milliseconds. The screen rounds them up to whole seconds
(`⌈ms / 1000⌉ s`) for short waits (under a minute), and otherwise uses `describeWait` from the ai
module ("about 20 minutes"), so one rule produces every message.

---

## §5 Gate file (`ai/gate.json`, Q7 = A)

```
{ v: 1,
  age: { adult: boolean, checkedAt: ms } | null,
  consents: { groq?: { version: int ≥ 1, at: ms }, mistral?: {...} },
  defaultProvider: 'groq' | 'mistral' | null,
  fakeMode: boolean }            // honoured only in development builds
```

- **Fail closed.** A file that's missing, unreadable, over 16 KB or fails the zod schema reads as
  "no age, no consent". The student is asked again, and nothing is sent in the meantime.
- **Consent is per provider and per version.** `hasConsent(p, v)` is true only when
  `consents[p].version === v`. When the catalog bumps a consent version, the old "yes" stops
  counting.
- Writes are serialised, so two quick answers can't overwrite each other.
- Delete all data removes the file (APP_FOLDERS has `ai`) and drops the in-memory copy (`forget()`).
