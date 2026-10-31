# editor

**Purpose:** the TipTap rich-text editor running inside a hardened WebView, controlled through a
validated message bridge.

**Public interface**
- `<EditorView ref logger onReady onChange onMetric onBridgeError />` with handle methods
  `load(doc)`, `setPack(pack)`, `setFonts(faces)`, `command(name, arg?)`, `requestDoc()`, `ping()`.
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
