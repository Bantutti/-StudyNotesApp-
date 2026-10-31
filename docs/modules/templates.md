# Module: templates

Note templates as validated data (plan F12). Added in P1 (M6).

## Public interface (`@/modules/templates`)
| Export | What it does |
|---|---|
| `createTemplateRegistry(raw?)` | Validates the bundled templates; `list()`, `get(id)`, `rejected` (a build bug if not empty). |
| `instantiateTemplate(t, { ids, dateText })` | Template -> note document. Every block gets a **fresh** id, so two notes from one template never share ids. |
| `applyTemplateTo(doc, t, opts)` | Empty note: replaced. Note with content: keeps every block and id, the template's sections (minus its title) are added below. |
| `validateTemplate(raw)`, `templateSchema` | The validator (also for v1.1 user templates and synced templates). |

## Built-in templates
Lecture, Cornell (cue column 30% / notes 70% + summary), Outline, Vocabulary list, Lab report (with a
results table), Problem set (Q&A blocks), Reading notes (with a quote).

## Rules
- Block specs come from a closed set (title, date, heading, paragraph, bullets, numbered, callout,
  definition, summary, Q&A, quote, divider, columns, table). Unknown fields are rejected.
- Text can't contain `< > { }`, `url(`, `http(s):`, `javascript:`, `data:` or `@import`.
- Columns hold simple blocks only (no nested columns); tables have at most 6 columns and 20 rows.
- Applying a template to a note saves a "Before template" version first (`applyTemplateToNote` in
  composition). A subject's default template is used for new notes in that subject.

## How to extend
Add a template object to `builtins.ts`; the registry test fails if it doesn't validate or produces a
document that fails the note schema.
