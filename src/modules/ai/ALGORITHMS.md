# AI module: algorithms and formulas (companion document)

This is the companion to the code in `src/modules/ai`. Code comments point here with `§X.Y`.
References written as "Plan §N" mean *Study Notes App Product and Technical Plan v0.2*.
Decision tags such as "Q6" refer to Rey's answers to the P3a plan questions (Nov 1, 2026).

| § | Topic | Code |
|---|---|---|
| §1 | Token estimate, chunking, output budget | `document/tokens.ts`, `actions/registry.ts` |
| §2 | Pacing under a tokens-per-minute limit | `transport/pacer.ts` |
| §3 | Retries, backoff, rate-limit headers | `transport/retry.ts`, `transport/http.ts` |
| §4 | Aliases and block-id preservation | `document/units.ts`, `document/materialize.ts`, `proposal/build.ts`, `actions/schemas.ts` |
| §5 | Inline-mark codec | `document/marks.ts` |
| §6 | Apply, rebase and invariants | `proposal/apply.ts` |
| §7 | Exact undo | `proposal/apply.ts` |
| §8 | Usage meter day buckets | `usage/meter.ts` |

---

## §1 Token estimate and chunking

### §1.1 Estimate

There is no on-device tokenizer for every model, so we estimate from UTF-8 bytes:

$$T(s) = \left\lceil \frac{\mathrm{bytes}_{\text{UTF-8}}(s)}{3} \right\rceil$$

English averages about 4 bytes per token. Dividing by **3** over-counts on purpose, because the
safe mistake is to think a request is bigger than it is: a request we think is small but isn't
would exceed Groq's free per-minute limit. Non-Latin scripts take more bytes per character,
and the formula scales with that automatically.

For one unit (block) the JSON line adds keys and quotes, so

$$T(u) = T(\text{text}_u) + T(\text{term}_u) + c,\qquad c = 14.$$

When the provider returns real token counts (`usage.prompt_tokens`, `usage.completion_tokens`),
those replace the estimate in the usage meter. If it returns none, the record is flagged
`estimated: true`.

### §1.2 Greedy, order-preserving packing

Given units $u_1 \dots u_n$ in document order and a budget $B = 2{,}500$ tokens, chunks are
built left to right:

```
current = [], used = 0
for u in units:
    t = T(u)
    if t > MAX_UNIT (4,000):          fail "unit_too_large"
    if current not empty and used + t > B:
        close current; current = [], used = 0
    current.append(u); used += t
close current
if number of chunks > 8:              fail "too_many_chunks"
```

Properties:
- **Order is kept**: concatenating the chunks gives the original sequence (tested).
- A unit larger than $B$ (but at most 4,000) gets a chunk of its own.
- Each chunk except the last holds more than $B - \max_i T(u_i)$ tokens, so greedy packing
  never uses more than about twice the minimum number of chunks.

Why $B = 2{,}500$: one request is roughly

$$R \approx T(\text{system}) + T(\text{chunk}) + O_{\max} \approx 600 + 2{,}500 + 3{,}200 = 6{,}300 < 8{,}000,$$

which stays below Groq's free limit of 8,000 tokens per minute for gpt-oss (checked Nov 1, 2026).

### §1.3 Output budget per action

With $t = T(\text{chunk})$:

| Action kind | $O_{\max}$ |
|---|---|
| Edit (Beautify, Clarify, Simplify, Translate, Clean transcript) | $\min(3200,\ \lceil 1.5\,t \rceil + 400)$ |
| Expand with context | $\min(3200,\ \lceil 2\,t \rceil + 600)$ |
| Summary / Explain / Key terms / Cards / Quiz | 900 / 1,000 / 2,000 / 2,400 / 2,400 |

The factor 1.5 allows for JSON structure plus moderate growth. gpt-oss reasoning tokens count
as output, so `reasoning_effort: "low"` keeps them small.

---

## §2 Pacing under a tokens-per-minute limit

Providers that publish a TPM limit $L$ (Groq gpt-oss: $L = 8{,}000$) get a **sliding 60-second
window** per provider and model. Each request reserves $r = T(\text{system}+\text{user}) + O_{\max}$
tokens at the time it is sent.

### §2.1 Window

Let $W(t)$ be the reservations made in $(t-60\,\text{s},\ t]$ and $U(t) = \sum_{e \in W(t)} e.\text{tokens}$.

### §2.2 Wait time

A new reservation $r$ fits at time $t$ when $U(t) + r \le L$. If it does not fit, we walk the
entries from oldest to newest, subtracting each one until the remainder fits:

$$k^\* = \min\Bigl\{k : U(t) - \sum_{i=1}^{k} e_i.\text{tokens} + r \le L\Bigr\},\qquad
\text{wait} = e_{k^\*}.\text{at} + 60\,\text{s} - t.$$

If $r \ge L$ the request can never fit, so we don't wait: we send it and let the provider
decide. Waits longer than 60 s are not taken either (they cannot happen within a 60-second
window, and the check is there for safety).

### §2.3 Settle

When the answer arrives, the reservation is replaced by the real total
(`prompt_tokens + completion_tokens`), so later waits use real numbers.

---

## §3 Retries, backoff and rate-limit headers

### §3.1 Equal-jitter exponential backoff

For the $n$-th retry ($n = 0, 1, \dots$), with base $b = 1\,\text{s}$, cap $C = 8\,\text{s}$ and
$r \in [0,1)$ uniform:

$$d(n) = \min(C,\ b\cdot 2^{n})\cdot(0.5 + 0.5\,r).$$

Half the delay is fixed, so we always back off; the other half is random, so many phones
don't retry at the same moment. With $r=0$: 0.5 s, 1 s, 2 s, ... With $r \to 1$: 1 s, 2 s, 4 s, ...

### §3.2 Headers

- `Retry-After`: either delta-seconds (`"2"`, `"1.5"`) or an HTTP date. A date becomes
  $\max(0,\ \text{date} - \text{now})$.
- Groq `x-ratelimit-reset-*`: Go durations, $\sum$ number × unit with
  $h = 3.6\times10^6$, $m = 6\times10^4$, $s = 10^3$, $ms = 1$ (ms). `"2m59.56s"` = 179,560 ms.
  `ms` is matched before `m`.
- Groq `x-ratelimit-remaining-requests` is per **day**; `x-ratelimit-remaining-tokens` is per
  **minute** (Groq docs, checked Nov 1, 2026).

### §3.3 Minute or day?

$$\text{scope} = \begin{cases}\text{day} & \text{remaining requests} = 0 \ \lor\ \text{wait} > 60\,\text{s}\ \lor\ \text{HTTP 402}\\ \text{minute} & \text{otherwise}\end{cases}$$

When `Retry-After` is missing and the daily counter is 0, the wait is taken from
`x-ratelimit-reset-requests`.

### §3.4 What is retried

| Failure | Retries | Wait |
|---|---|---|
| 429 with a known wait $\le 10$ s (Q9) | 1 | wait + 250 ms |
| HTTP 5xx | 2 | $d(0), d(1)$ |
| Timeout (30 s per request) | 1 | $d(0)$ |
| 401/403, 400/404/422, 413, offline, cancelled | 0 | — |

A 429 that is not retried moves to the next model if there is one (Groq: gpt-oss-120b, then
gpt-oss-20b, Q3), because Groq counts limits per model. The fallback is *sticky* for the rest
of the run.

---

## §4 Aliases and block-id preservation

### §4.1 Alias map

The units in scope get aliases $a_i = \texttt{"u"} \Vert i$ in document order. The prompt contains
only aliases. Let $A_k$ be the alias set of chunk $k$. An answer for chunk $k$ is rejected
(`OutputRejected`, then one re-ask, Q6) if:

- a ref $\notin A_k \cup \{\texttt{end}\}$ (`unknown_ref`),
- a ref appears twice (`duplicate_ref`),
- a read-only unit's op is not `keep` (`readonly_changed`),
- the action forbids the op (`delete_not_allowed`, `insert_not_allowed`).

Units the AI leaves out are **kept**. A delete is never implied.

### §4.2 Inheritance

For a rewrite of unit $u$ into blocks $b_1 \dots b_m$:

1. $b_1$ inherits $\text{attrs}(u) \setminus \{\text{level}, \text{term}, \text{start}\}$, which
   includes the block id and any future non-shape attribute.
2. Inner paragraphs of callouts, definitions and list items take the old inner paragraphs'
   attrs **by position** $j$: new paragraph $j$ ← old paragraph $j$, if it exists.
3. In a list, $b_1$ rewrites the item's first paragraph and the item **keeps its nested lists**.
   Every $b_j$ becomes a list item, whatever its kind (documented coercion).
4. At top level, runs of consecutive bullet or numbered blocks are grouped into one new list. If
   $b_1$ is a bullet, $u$'s id moves to the first list item (the text-bearing block). The list
   wrapper is new.
5. Every other node has **no id** until apply (§6.2).

*No-op rule*: if $m=1$ and the materialized node is canonically equal to $u$'s node, there is
no change. If $m>1$ and only $b_1$ is equal, the change is an **insert** of $b_2\dots b_m$ after
$u$ (Expand's pattern), so the original is not marked as rewritten.

### §4.3 Removed-id accounting

For each change $c$ with old node $N$ and new nodes $N'$:

$$\text{removes}(c) = \text{ids}(N) \setminus \text{ids}(N').$$

For a delete, $N' = \varnothing$, so every id in the deleted subtree is removed. Apply then
checks that exactly these ids (plus emptied lists, §6.3) disappear.

### §4.4 Provider schema reduction

The zod schema $S$ is converted with `z.toJSONSchema(S)` and reduced to the keyword set
$K = \{\text{type, properties, required, additionalProperties, items, enum, anyOf, const, description}\}$.
Property *names* inside `properties` are kept; only keywords are filtered. Length and size
limits are removed for the provider and enforced on the device by zod and by §4.1. So a provider
that doesn't support `maxLength` can't reject the request, and the device check stays complete.

---

## §5 Inline-mark codec

### §5.1 Render

Each text node renders as its escaped text, wrapped in markers in the fixed outer-to-inner
order `**` (bold), `*` (italic), `==` (highlight), `~~` (strike), `++` (underline).
`hardBreak` becomes `\n`. Escaping: every `\` and `*` gets a backslash, and so does
`=`, `~` or `+` when it sits next to the same character. Links render as plain text. Their
`(text, href)` pairs are remembered for §5.3.

### §5.2 Parse (toggle semantics)

1. **Tokenize.** `\x` is the literal x. `\n` is a break. A run of $n$ stars gives
   $\lfloor n/2\rfloor$ × `**` plus one `*` if $n$ is odd (so `***` toggles bold and italic
   together). `==`, `~~` and `++` are markers; single `=`, `~` and `+` are text.
2. **Unmatched markers.** For each marker type with occurrence count $c$, if $c$ is odd, the
   occurrence with index $c-1$ (the last one) is literal text.
3. **Walk.** Keep an active set $M$. Each matched marker toggles its mark in $M$, and each text
   run takes the marks in $M$. Overlap such as `**a *b** c*` is valid, because marks are a set per
   text node, not a tree.
4. Adjacent runs with equal mark sets merge. Leading and trailing breaks are dropped.

The codec has **no syntax for links, HTML, attributes or styles**. Whatever the AI writes, it
can only produce the five marks and line breaks.

### §5.3 Link re-application

Original links $\{(\ell_i, h_i)\}$ with $|\ell_i| \ge 2$ are applied longest first: every exact
occurrence of $\ell_i$ in a run is split out and given `link(href = h_i)`. Hrefs come **only** from
the user's original note. If the AI drops the link text, the link is gone (visible in the diff).

---

## §6 Apply, rebase and invariants

### §6.1 Stale test (block-level rebase, Q7)

Let $D$ be the current note and $c$ a change. With canonical JSON $\kappa$ (keys sorted at every
level):

$$\text{stale}(c) = \begin{cases}
\text{target} \notin D\ \lor\ \kappa(D[\text{target}]) \ne \kappa(c.\text{before}) & c \in \{\text{replace}, \text{delete}\}\\
\text{after} \ne \text{null}\ \land\ \text{after} \notin D & c = \text{insert}
\end{cases}$$

Stale changes are turned off. The others still apply.

### §6.2 Single-pass rebuild

Index the active changes: replace-by-target, delete-by-target, inserts-after-anchor (null =
start of the note). Then rebuild every node list once, in order:

```
rebuild(nodes, isTop):
    out = []
    if isTop: emit inserts anchored at null
    for n in nodes:
        id = blockId(n)
        if id is replaced:   for m in replacement: out += freshen(rebuildChildren(m))
        elif id is deleted:  (skip)
        else:                n' = rebuildChildren(n); drop n' if it is an empty list
        emit inserts anchored at id
    return out
```

`rebuildChildren` runs `rebuild` on a node's content. That's how a nested item kept under a
rewritten parent still gets its own change.

`freshen(node)` assigns ids to id-less blocks with core's `ensureBlockIds`. Let $H$ be the ids
the node already had, $E$ the ids in the current note and $G$ the ids assigned so far:

$$\text{fresh} = \text{ids}(\text{node}') \setminus H,\qquad \text{accept iff } \text{fresh} \cap (E \cup G) = \varnothing \ \land\ \text{fresh has no duplicates}.$$

It retries up to 8 times. If every attempt collides, the result is `internal/id_collision` and
nothing changes. Core makes ids of 16 random characters from a 54-character alphabet, so one new
id collides with probability about $|E|/54^{16}$, which is under $10^{-22}$ even for a
50,000-block note. In practice this path only shows up in tests.

### §6.3 Invariants (any failure returns an error, never a broken note)

1. Every active change was applied.
2. The result passes core's `validateNoteDoc` (schema plus depth and node limits).
3. Block ids are unique.
4. `ensureBlockIds(result)` changes nothing (every block has a valid id).
5. Lost ids: $E \setminus \text{ids}(\text{result}) \subseteq \bigcup_c \text{removes}(c) \cup \text{emptiedLists}$.

The result also reports `changedBlockIds`: kept ids inside replacements whose *own* content
(ignoring nested lists) changed. P4c uses it to mark cards "Source changed".

---

## §7 Exact undo

The undo record stores $\kappa(D_{\text{before}})$ and $\kappa(D_{\text{after}})$. Then

$$\text{undo}(D) = \begin{cases} \text{parse}(\kappa(D_{\text{before}})) & \kappa(D) = \kappa(D_{\text{after}}) \\ \text{error "stale"} & \text{otherwise.}\end{cases}$$

Because $\kappa$ is canonical and block ids are part of the tree, a successful undo gives back the
note **with the same block ids**. Any later edit makes undo refuse, so it can never overwrite the
student's newer work. P3b then offers version history (F14).

---

## §8 Usage meter day buckets

Events are counted per provider in the bucket for the student's **local** calendar day:

$$\text{day}(t) = \text{YYYY-MM-DD of } t \text{ in the device's time zone}.$$

The file keeps the last 30 days: after each write, buckets not in
$\{\text{day}(t - k\cdot 86{,}400{,}000\,\text{ms}) : 0 \le k < 30\}$ are removed. Providers reset
their own counters on their own clocks (Groq uses rolling windows; Gemini resets at midnight
Pacific), so the meter is an approximation of "today". The provider's own header
(`remainingRequests`) is shown when it is available. Writes are serialized through a promise
queue, so concurrent records can't lose counts (tested with 20 parallel writes).
