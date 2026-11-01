# editor

**Purpose:** the TipTap rich-text editor running inside a hardened WebView, controlled through a
validated message bridge.

**Public interface**
- `<EditorView ref logger pack faces getDoc onReady onChange onMetric onBridgeError />` with handle methods
  `load(doc)`, `setPack(pack)`, `setFonts(faces)`, `command(name, arg?)`, `requestDoc()`, `ping()`.
- **Fonts go one face per `setFonts` message** (first replaces, the rest `append: true`; the page keeps at
  most 12, `editor-web/src/fonts.ts`): Pastel Highlight's Gaegu faces are ~4 M chars each.
- **Every `ready`** (first start and after a WebView restart) `EditorView` sends `pack`, `faces` and
  `getDoc()` (the screen passes the newest document, `session.readyDoc`). Android render-process loss
  remounts the WebView; iOS content-process loss reloads it; pending requests fail with `timeout`.
- **`requestDoc()` never resolves with a stand-in.** If the live document fails validation the page
  answers `{ type: 'error', code, reqId }` (`editor-web/src/replies.ts`) and the promise rejects
  (`validation_failed` or `too_large`); `onBridgeError` still fires for the banner.
- Protocol: `toWebSchema`, `toNativeSchema`, `decode`, `encode`, `COMMANDS`, `MAX_BRIDGE_CHARS`.
- Hardening: `HARDENED_WEBVIEW_PROPS`, `allowNavigation(url)`.
- Build info: `EDITOR_CSP`, `EDITOR_SCRIPT_SHA256`, `EDITOR_SCRIPT_BYTES`.

**Inside the WebView** (`editor-web/src`): `main.ts` (bridge client), `createEditor.ts` (TipTap
config), `extensions.ts` (BlockId, PackHeading, Callout, Definition, PackHighlight), `commands.ts`,
`sanitize.ts` (paste cleanup), `zodConfig.ts` (jitless), `template.html` (CSP placeholder).

**How to extend**
- New command: add it to `COMMANDS` in `protocol.ts`, map it in `editor-web/src/commands.ts`, add a
  toolbar button. Commands carry no HTML.
- After any change in `editor-web/`: `npm run build:editor` (regenerates the page and CSP hash).
  `npm run verify` fails if the generated file is stale.
- Never add `unsafe-eval`, remote scripts, network access, or a message type that carries HTML/JS.

## Links open outside the app (P1)

Apple counts browsing inside an app as "unrestricted web access", which can raise the age rating
to 16+ (C1 compliance requirement, Nov 1 2026). So a link in a note never loads in the editor
WebView:

1. **Blocked in the page.** The CSP has no network (`default-src 'none'`), `onShouldStartLoadWithRequest`
   allows only the local document, new windows are off, and the page cancels the click on any `<a>`
   (`linkFromEvent` in `editor-web/src/createEditor.ts`). Middle-clicks are cancelled too.
2. **Handed to native.** The page posts `{ v: 1, type: 'openLink', href }` (href at most 2,000 chars,
   http, https or mailto only). `EditorView` passes it to its `onOpenLink` prop.
3. **Opened by the OS.** `createLinkOpener(expoLinkPorts)` re-validates the URL (`safeHref`, no
   whitespace or control characters), shows a native "Open link?" dialog with the real host (a
   `user:pass@` prefix is stripped from the display, a classic disguise), and only then calls
   `Linking.openURL`, which leaves the app for the system browser or mail app. One dialog at a time.

Tests: `src/modules/editor/__tests__/links.test.ts` (opener, bridge message, navigation blocked) and
`editor-web/__tests__/editor-web.test.ts` (click is cancelled and reported; plain clicks are not).

## Document schema v2 (P1)

New blocks: `blockquote`, `summary`, `qa` (`qaQuestion` + `qaAnswer`), `columns` (layout `even` or
`cornell`, exactly two `column`s, no nested columns) and simple tables (`table` > `tableRow` >
`tableHeader | tableCell`, no merged cells, at most 12 columns and 200 rows). Every block may carry
`audioAnchor` (P2a's shape, used from P4). The editor keeps anchors in the JSON but never reads them
from pasted HTML, and a split doesn't copy them. `checkDocStructure()` enforces the nesting rules for
documents from storage, sync and AI; the TipTap content expressions (M5) must match them.

## Editor action hook (P1 M7, for P3b)

`src/modules/editor/actions.ts` defines `EditorAction` and `createEditorActionRegistry()`. Services
holds the registry (`services.editorActions`), pre-loaded with Beautify Lite. Every action runs through
`runEditorAction(action, { store, ids, host }, noteId)` in composition:

1. `host.getDocument()` gives the current document (the editor flushes unsaved edits first).
2. `action.run(ctx)` returns `{ doc, message }` or `null` (cancelled, nothing to change). The context
   has the note id, subject, title, pack, the document, the selection's block ids (null = whole note,
   live selection arrives with M5) and the id generator.
3. The result is validated (`prepareDocForSave`: schema, structure, non-null unique ids, cloud caps).
   Invalid output is rejected and nothing is saved.
4. Unsaved host edits are stored, a version with the action's reason (`before_beautify`, `before_ai`)
   is saved, then the new document, and `host.showDocument()` displays it.
5. The returned `undo()` restores the exact previous document (same block ids); the screen shows it in
   the Undo snackbar.

**P3b:** register through composition, e.g. in services setup:

```ts
services.editorActions.register({
  id: 'ai', label: 'AI', icon: 'sparkles-outline',
  placement: 'sparkle', reason: 'before_ai',
  isAvailable: (ctx) => true,          // optional; false hides the button for this note
  run: async (ctx) => /* consent, key wizard, diff preview */ null,
});
```

Show your consent, key wizard and diff preview inside `run()`, and resolve with the accepted document or
`null`. Don't touch storage or the WebView directly. Placements: `toolbar` (Beautify), `sparkle` (the
keyboard toolbar's AI slot), `menu` (reserved).

**Sparkle slot (M5):** `EditorToolbar` always renders a slot (`testID="editor-sparkle-slot"`) right after
the block menu. Every action with placement `sparkle` appears there; with none registered the slot is
empty and takes no space (`display: 'none'`). The toolbar reads the registry through
`useEditorActions(registry, placement, ctx)` (`src/screens/editorActionHooks.ts`), which subscribes to it
(`registry.subscribe`/`revision`), so an action registered while a note is open appears at once, and
unregistering removes it. `isAvailable(ctx)` gets the open note (id, subject, title, pack, `selection:
null`); a check that throws hides the action. Presses go through `useEditorActionRunner`, which calls
`runEditorAction` (one action at a time, the button shows "…" while it runs) and reports the outcome to
the screen (Undo snackbar, or "Nothing to change here", or the error message).
Tests: `src/screens/__tests__/editorToolbarSparkle.test.tsx` renders the toolbar with `test-renderer`.

## The live editor (P1 M5)

**Note screen** (`src/app/note/[id].tsx`): title, mode switch Type · Draw (P4b placeholder) · Style,
History and Info (word count, outline with jump), add template, delete with Undo, focus mode, and the
keyboard toolbar (`src/screens/EditorToolbar.tsx`): Aa (H1, H2, H3, Text, B, I, U, S, link), highlight
(the pack's highlighters with their meanings), lists and quotes, + block (picker), block menu (move up
and down, duplicate, turn into, delete), the **P3b sparkle slot** (actions with placement `sparkle`),
Beautify, undo and redo, hide keyboard. Table controls appear inside tables.

**Saving:** `createNoteSession` (composition) wraps `createAutosave`: 1 s after typing stops, at least
every 5 s while typing, flushed when the app goes to the background, before actions and Style, History
or Template, and on leaving the note (then the "When you left" version). `session.flush()` and
`session.leave()` first pull the editor's **live** document (`requestDoc`, 1.5 s limit), because the page
sends changes only 400 ms after typing stops and never mid-composition; a failed pull keeps the last
good document. A leave in progress finishes its save even if the screen unmounts. Before each save the
"every 10 minutes" version rule runs. A failed save keeps the text and retries with the next change.

**Editor page (`editor-web/`):**
- New nodes (`blocks.ts`): blockquote, summary, Q&A, two columns (even or Cornell), simple tables
  (`@tiptap/extension-table` 3.32.2, no merged cells, max 12 columns). Content expressions mirror
  `checkDocStructure` exactly (list items and boxes hold simple blocks only, cells hold paragraphs).
- `sanitize.ts`: pasted tables stay tables (table tags allowed with no attributes, except a valid
  `data-block-id` on `<table>`).
- `normalize.ts`: before every send, ragged pasted tables are padded and oversized ones become lines;
  then the document is validated with the app's schema. An invalid document is never sent (the screen
  shows a banner) instead of being silently dropped.
- `loadDoc()`: loading a note resets undo history (Undo right after opening could otherwise blank it).
- Slash menu and + block picker (`menu.ts`), rendered inside the page with pack-styled previews,
  built with `createElement`/`textContent` only.
- Typing shortcuts (`shortcuts.ts`): `# `, `- `, `1. `, `> `, `---` (StarterKit), `==text==`
  (highlight), `Term :: meaning` + Enter (definition box), Enter in a Q&A question moves to the answer.

**Block ids (`blockIdPlugin.ts`, decision Q6 = A), tested in `editor-web/__tests__/blockIds.test.ts`:**

| Edit | Result |
|---|---|
| Enter in the middle of a line | first half keeps the id, second half gets a new one |
| Enter at the start of a line (P0 bug) | an empty line is inserted above; the text keeps its id |
| Enter at the start of a list item | a new item above; the item and its text keep their ids |
| Turn into (heading, paragraph, `# ` input rule) | same id (restored at the same position when the text matches) |
| Wrap in list, callout | the line keeps its id; the wrapper gets a new one |
| Paste a copy above its original (P0 bug) | the original keeps the id; the copy gets a fresh one |
| Paste from another note | fresh ids |
| Cut + paste within the note (a move) | ids kept (cut ids remembered 10 minutes) |
| Duplicate block | the original keeps; the copy gets fresh ids |
| Move up / down | ids kept |
| Undo / redo | ids restored by history |
| Delete | the id is gone (never moved onto another block) |
| A keyboard splits the block itself (no Enter shortcut) | same as Enter: the id stays with the text, the empty line gets a new one |
| Cut + paste of a table | stays a table, keeps its id |

**IME and keyboards (UNVERIFIED on real phones):** conservative settings: no custom key handling while
`view.composing`, the id pass waits for `compositionend`, documents aren't sent mid-composition, menus are
driven by editor state (not key events), spellcheck and autocorrect stay on. **Developer menu > Typing
diagnostics** (`/dev/typing`) logs keyboard and composition events as metadata only (types, input types,
lengths, flags, cursor offsets; printable keys become "char"; the bridge schema rejects any text field
and single-character keys), with Copy log for Rey's phone test.

**Bridge additions:** native to web `requestSelection`, `scrollToBlock`, `setDiagnostics`, commands for
the new blocks, tables and block menu; web to native `state` (toolbar), `selection`, `diag`.

## Ink on the page (P4b)

The bridge also carries finished ink: `inkAdd`, `inkRemove`, `inkClear`,
`setInkFeed`, `requestInkLayout`, plus Draw mode's `inkScroll`, `inkFling`
and `inkZoom`, to the page; and `inkLayout`, `inkAck` back. P4b also adds the
**sketch** block (`sketch` and `sketchTaller` commands, a slash-menu item and
the `pk-sketch` frame).
The page draws ready-made, schema-checked SVG paths in two layers outside
ProseMirror's DOM (`editor-web/src/ink.ts`). The format, security rules and
layout feed are documented in [ink.md](./ink.md), "Showing ink on the editor
page".

