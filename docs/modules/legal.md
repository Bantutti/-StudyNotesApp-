# legal module (P2b)

C1's in-app privacy policy, terms of use and account-deletion page, bundled into the app (decision Q10:
readable offline, no public links, each page starts with C1's "Draft" line).

- Source: `phase/c1-compliance` @ `e78a01a` (`web/app-docs/`), as the Lead asked. The commit and each
  file's git blob SHA and SHA-256 are pinned in `src/modules/legal/generated/legalDocs.ts`.
- Regenerate after C1 changes: `node scripts/build-legal.mjs --from <folder with the three files>`, then
  update `SOURCE.commit` in the script.
- `npm run check:legal` (part of `npm run verify`) fails if the generated file was edited by hand, or if
  `web/app-docs/` exists in this checkout (after C1 merges) and differs from the pinned copies.
- Rendering: a safe Markdown subset (headings, paragraphs, lists, notes, bold, links) to plain `<Text>`;
  links between the three pages stay in the app, any other link becomes plain text; C1's `{{PLACEHOLDERS}}`
  show as "(to be added)" until C1 fills them.
