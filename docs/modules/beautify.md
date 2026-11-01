# Module: beautify

Turns messy notes into structured pages. Added in P1 (M7).

## Beautify Lite (`beautifyLite(doc, ids)`)
On device, no network, no key. Rules (decision Q8 = B), applied to top-level paragraphs only:

1. `- x`, `* x`, `• x` lines become a bullet list (consecutive lines merge).
2. `1. x`, `1) x` lines become a numbered list (keeps the first number).
3. `Q: ...` followed by `A: ...` becomes a Q&A block.
4. Lines starting `Note:`, `Tip:`, `Important:`, `Exam:`, `Remember:` or `Warning:` become callouts (the label stays).
5. `Term :: meaning` (up to 6 words) or `Term - meaning` (up to 4 words, not a sentence such as
   "I went home - …", not maths such as "3 - 2") becomes a definition box.
6. A short line ending in `:` or written in capitals (up to 8 words) becomes a heading.
7. Runs of empty lines collapse to one; empty lines at the end are removed.
8. Bold text gets the pack's first highlighter ("Key idea").
9. A "Key terms" list at the end (definition terms and bold terms), refreshed in place, never duplicated.

## Guarantees (tested in `__tests__/lite.test.ts`)
- **Words never change.** Only markers (`-`, `1.`, `::`, `Q:`/`A:`, a heading's final `:`) become structure.
  The only added text is the Key terms list.
- **Block ids:** the block carrying a line's text keeps the line's id; a line that becomes a
  definition box gives the box its id (cards point at definition boxes). New wrappers get fresh ids.
- **Idempotent:** running it twice equals running once.
- Output passes the note schema.

## How it runs in the app
`beautifyLiteAction` is an `EditorAction` (see editor.md, "Editor action hook"), run through
`runEditorAction`: a "Before Beautify" version is saved first and the snackbar offers Undo for 8 seconds.
P3b adds the AI Beautify as another action; Lite stays the offline fallback.
