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
