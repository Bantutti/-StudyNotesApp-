/**
 * NoteDoc + StylePack -> DOCX bytes (docx library, pure JS).
 *
 * Mapping (Word has no CSS, so the look is approximated):
 *   h1/h2/h3      -> paragraphs in the header font and accent colour
 *   highlight     -> run shading with the composited highlighter colour
 *   callout       -> paragraphs shaded with the pack's soft colour
 *   definition    -> "DEFINITION" label + term + body inside a border
 *   lists         -> Word numbering (bullet / decimal), nested by level
 *   hr            -> paragraph with an accent bottom border
 *   paper colour  -> document background (dark packs)
 *   fonts         -> embedded TTF faces when bundled (OFL allows embedding)
 */
import {
  AlignmentType,
  BorderStyle,
  CharacterSet,
  Document,
  ExternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';

import { base64ToBytes, safeHref, type DocNode, type Mark } from '@/core';
import { highlighterColor, type FontFaceData, type StylePack } from '@/modules/stylepacks';

import { PAPER_POINTS, type ExportInput } from './types';

const hexNoHash = (hex: string): string => hex.replace('#', '').toUpperCase();
const BODY_HALF_POINTS: Record<StylePack['fonts']['bodySize'], number> = { s: 22, m: 23, l: 26 };
const TWIPS_PER_POINT = 20;

interface Ctx {
  pack: StylePack;
  body: number;
}

type RunStyle = Omit<IRunOptions, 'text'>;

function runsFor(nodes: readonly DocNode[] | undefined, ctx: Ctx, base: RunStyle = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') out.push(new TextRun({ ...base, text: '', break: 1 }));
    if (n.type !== 'text') continue;
    const style = applyMarks(n.marks, ctx, base);
    const link = n.marks?.find((m): m is Extract<Mark, { type: 'link' }> => m.type === 'link');
    const href = link ? safeHref(link.attrs.href) : null;
    const run = new TextRun({ ...style, text: n.text });
    out.push(href ? new ExternalHyperlink({ link: href, children: [run] }) : run);
  }
  return out;
}

function applyMarks(marks: readonly Mark[] | undefined, ctx: Ctx, base: RunStyle): RunStyle {
  const s: { -readonly [K in keyof RunStyle]: RunStyle[K] } = { ...base };
  for (const m of marks ?? []) {
    if (m.type === 'bold') s.bold = true;
    if (m.type === 'italic') s.italics = true;
    if (m.type === 'underline') s.underline = {};
    if (m.type === 'strike') s.strike = true;
    if (m.type === 'link') {
      s.color = hexNoHash(ctx.pack.palette.accent2);
      s.underline = {};
    }
    if (m.type === 'highlight') {
      const idx = Number(m.attrs.key.slice(1));
      s.shading = { type: ShadingType.CLEAR, color: 'auto', fill: hexNoHash(highlighterColor(ctx.pack, idx)) };
    }
  }
  return s;
}

function border(color: string, style: IBorderOptions['style'], size = 8): IParagraphOptions['border'] {
  const b: IBorderOptions = { style, size, color: hexNoHash(color), space: 6 };
  return { top: b, bottom: b, left: b, right: b };
}

type Block = Paragraph | Table;

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;

/** Word table cells must hold at least one paragraph. */
const cellChildren = (blocks: Block[]): Block[] => (blocks.length ? blocks : [new Paragraph({ children: [] })]);

function blockParagraphs(nodes: readonly DocNode[], ctx: Ctx, extra: Partial<IParagraphOptions> = {}, level = 0): Block[] {
  const out: Block[] = [];
  const { pack } = ctx;
  const headerFont = pack.fonts.header;
  const accent = hexNoHash(pack.palette.accent);

  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph':
        out.push(new Paragraph({ ...extra, children: runsFor(n.content, ctx) }));
        break;
      case 'heading': {
        const scale = n.attrs.level === 1 ? pack.fonts.headerScale : n.attrs.level === 2 ? 1.35 : 1.15;
        out.push(
          new Paragraph({
            ...extra,
            keepNext: true,
            spacing: { before: 120, after: 60 },
            children: runsFor(n.content, ctx, {
              font: headerFont,
              size: Math.round(ctx.body * scale),
              color: n.attrs.level === 1 && pack.header.style === 'bold-block' ? hexNoHash(pack.palette.ink) : accent,
              bold: pack.fonts.headerWeight >= 600,
              italics: pack.fonts.headerItalic,
              allCaps: pack.fonts.headerCase === 'upper',
              smallCaps: pack.fonts.headerCase === 'smallcaps',
              shading:
                n.attrs.level === 1 && pack.header.style === 'highlight-swipe'
                  ? { type: ShadingType.CLEAR, color: 'auto', fill: hexNoHash(highlighterColor(pack, 0)) }
                  : undefined,
            }),
          }),
        );
        break;
      }
      case 'bulletList':
      case 'orderedList':
        for (const item of n.content) {
          if (item.type !== 'listItem') continue;
          item.content.forEach((child, i) => {
            if (child.type === 'paragraph') {
              out.push(
                new Paragraph({
                  ...extra,
                  children: runsFor(child.content, ctx),
                  numbering:
                    i === 0
                      ? { reference: n.type === 'bulletList' ? 'pk-bullet' : 'pk-number', level: Math.min(level, 2) }
                      : undefined,
                  indent: i === 0 ? undefined : { left: 720 * (level + 1) },
                }),
              );
            } else {
              out.push(...blockParagraphs([child], ctx, extra, level + 1));
            }
          });
        }
        break;
      case 'callout': {
        const shade = { type: ShadingType.CLEAR, color: 'auto', fill: hexNoHash(pack.palette.soft) } as const;
        out.push(...blockParagraphs(n.content, ctx, { ...extra, shading: shade, border: border(pack.palette.soft, BorderStyle.SINGLE, 4) }, level));
        break;
      }
      case 'definition': {
        const style = pack.blocks.definition === 'dashed-box' ? BorderStyle.DASHED : pack.blocks.definition === 'framed' ? BorderStyle.DOUBLE : BorderStyle.SINGLE;
        const box = { ...extra, border: border(pack.palette.accent, style, 12) };
        out.push(
          new Paragraph({
            ...box,
            spacing: { before: 120 },
            children: [new TextRun({ text: 'DEFINITION', bold: true, size: Math.round(ctx.body * 0.62), color: accent, characterSpacing: 40 })],
          }),
          new Paragraph({
            ...box,
            children: [new TextRun({ text: n.attrs.term, font: headerFont, size: Math.round(ctx.body * 1.45), bold: pack.fonts.headerWeight >= 600, italics: pack.fonts.headerItalic })],
          }),
          ...blockParagraphs(n.content, ctx, box, level),
        );
        break;
      }
      case 'horizontalRule':
        out.push(
          new Paragraph({
            ...extra,
            border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 1 } },
            children: [],
          }),
        );
        break;
      case 'blockquote': {
        const side = { style: BorderStyle.SINGLE, size: 18, color: hexNoHash(pack.palette.accent2), space: 8 };
        out.push(...blockParagraphs(n.content, ctx, { ...extra, border: { left: side }, indent: { left: 360 } }, level));
        break;
      }
      case 'summary': {
        const shade = { type: ShadingType.CLEAR, color: 'auto', fill: hexNoHash(pack.palette.soft) } as const;
        const box = { ...extra, shading: shade, border: border(pack.palette.accent, BorderStyle.SINGLE, 8) };
        out.push(
          new Paragraph({
            ...box,
            spacing: { before: 120 },
            children: [new TextRun({ text: 'SUMMARY', bold: true, size: Math.round(ctx.body * 0.62), color: accent, characterSpacing: 40 })],
          }),
          ...blockParagraphs(n.content, ctx, box, level),
        );
        break;
      }
      case 'qa': {
        const box = { ...extra, border: border(pack.palette.accent2, BorderStyle.DASHED, 8) };
        for (const part of n.content) {
          if (part.type === 'qaQuestion') {
            out.push(
              new Paragraph({
                ...box,
                spacing: { before: 120 },
                children: [new TextRun({ text: 'Q  ', bold: true, color: accent, font: headerFont }), ...runsFor(part.content, ctx, { bold: true })],
              }),
            );
          } else if (part.type === 'qaAnswer') {
            out.push(
              new Paragraph({ ...box, children: [new TextRun({ text: 'A', bold: true, color: hexNoHash(pack.palette.accent2), font: headerFont })] }),
              ...blockParagraphs(part.content, ctx, box, level),
            );
          }
        }
        break;
      }
      case 'columns': {
        // Plan section 16: Cornell and two-column layouts become a borderless two-cell table.
        const cornell = n.attrs?.layout === 'cornell';
        const widths = cornell ? [30, 70] : [50, 50];
        const divider = { style: BorderStyle.SINGLE, size: 8, color: hexNoHash(pack.palette.accent2) };
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: n.content.map(
                  (col, i) =>
                    new TableCell({
                      width: { size: widths[i] ?? 50, type: WidthType.PERCENTAGE },
                      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: cornell && i === 0 ? divider : NO_BORDER },
                      children: cellChildren(blockParagraphs('content' in col ? col.content ?? [] : [], ctx, {}, 0)),
                    }),
                ),
              }),
            ],
          }),
        );
        break;
      }
      case 'table': {
        const line = { style: BorderStyle.SINGLE, size: 6, color: hexNoHash(pack.palette.accent2) };
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: n.content.map(
              (row) =>
                new TableRow({
                  children: ('content' in row ? row.content ?? [] : []).map(
                    (cell) =>
                      new TableCell({
                        borders: { top: line, bottom: line, left: line, right: line },
                        shading:
                          cell.type === 'tableHeader'
                            ? { type: ShadingType.CLEAR, color: 'auto', fill: hexNoHash(pack.palette.soft) }
                            : undefined,
                        children: cellChildren(blockParagraphs('content' in cell ? cell.content ?? [] : [], ctx, {}, 0)),
                      }),
                  ),
                }),
            ),
          }),
        );
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function embeddedFonts(faces: readonly FontFaceData[]) {
  const byFamily = new Map<string, Partial<Record<'regular' | 'bold' | 'italic', Uint8Array>>>();
  for (const f of faces) {
    const entry = byFamily.get(f.family) ?? {};
    const slot = f.style === 'italic' ? 'italic' : f.weight >= 700 ? 'bold' : 'regular';
    entry[slot] = base64ToBytes(f.base64);
    byFamily.set(f.family, entry);
  }
  const out = [];
  for (const [name, e] of byFamily) {
    if (!e.regular) continue;
    // docx types say Buffer, but the library accepts any ArrayBufferView.
    out.push({
      name,
      data: e.regular as unknown as Buffer,
      bold: e.bold as unknown as Buffer | undefined,
      italic: e.italic as unknown as Buffer | undefined,
      characterSet: CharacterSet.ANSI,
    });
  }
  return out;
}

export async function buildDocx(input: ExportInput): Promise<Uint8Array> {
  const { pack, doc } = input;
  const ctx: Ctx = { pack, body: BODY_HALF_POINTS[pack.fonts.bodySize] };
  const page = PAPER_POINTS[input.paper];
  const accent = hexNoHash(pack.palette.accent);
  const document = new Document({
    title: input.title.slice(0, 200),
    creator: 'Study Notes',
    background: { color: hexNoHash(pack.paper.color) },
    fonts: embeddedFonts(input.faces),
    styles: {
      default: {
        document: {
          run: { font: pack.fonts.body, size: ctx.body, color: hexNoHash(pack.palette.ink) },
          paragraph: { spacing: { line: Math.round(pack.paper.lineGap * 0.75 * TWIPS_PER_POINT), lineRule: 'exact' } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'pk-bullet',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ['•', '◦', '▪'][level] as string,
            alignment: AlignmentType.LEFT,
            style: { run: { color: accent }, paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
        {
          reference: 'pk-number',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { run: { color: accent, bold: true }, paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: page.width * TWIPS_PER_POINT, height: page.height * TWIPS_PER_POINT },
            margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
          },
        },
        children: blockParagraphs(doc.content, ctx),
      },
    ],
  });
  const buf = await Packer.toArrayBuffer(document);
  return new Uint8Array(buf);
}
