# export

**Purpose:** turn a note into PDF, DOCX or a print job that matches the screen.

**Public interface**
- `Exporter { format; run(input) }` with `createPdfExporter(print, files)`,
  `createDocxExporter(files)`, `createPrintExporter(print)`.
- `renderExportHtml({ doc, pack, faces, title })`, `buildDocx(input)`, `EXPORT_CSP`, `PAPER_POINTS`
  (A4, Letter), `MIME`, `exportFileName()`.
- Ports: `PrintPort`, `FileWriterPort`, `SharePort`; Expo adapters `expoPrint`, `expoFiles`,
  `expoShare`, `clearExports()`.

**How it keeps fidelity:** the HTML uses the same `packCss()` as the editor, embeds the pack's
bundled fonts as `@font-face` data, forces background printing, and fills every page with the paper
colour. DOCX approximates: header font and colour, highlight shading (composited colour), bordered
definitions, shaded callouts, Word numbering, document background, embedded fonts.

**How to extend**
- New format (for example Markdown or a server renderer): implement `Exporter`, wire it in
  `src/composition/services.ts`, add tests with fake ports.
- New node type: render it in both `html.ts` and `docx.ts`, escaping all text.
