/**
 * NoteDoc + StylePack -> standalone HTML for PDF and print.
 *
 * Safety: every text node and attribute is escaped; only http(s)/mailto
 * links survive; the page carries a CSP that blocks scripts and network,
 * so even a bug here cannot run code or fetch anything during printing.
 */
import { escapeHtml, safeHref, type DocNode, type Mark, type NoteDoc } from '@/core';
import { cornerSvg, doodleSvg, fontFaceCss, packAttrs, packCss } from '@/modules/stylepacks';

import type { ExportInput } from './types';

export const EXPORT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; base-uri 'none'; form-action 'none'";

function renderMarks(text: string, marks: readonly Mark[] | undefined): string {
  let out = escapeHtml(text);
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        out = `<strong>${out}</strong>`;
        break;
      case 'italic':
        out = `<em>${out}</em>`;
        break;
      case 'underline':
        out = `<u>${out}</u>`;
        break;
      case 'strike':
        out = `<s>${out}</s>`;
        break;
      case 'highlight':
        out = `<mark data-k="${m.attrs.key}">${out}</mark>`;
        break;
      case 'link': {
        const href = safeHref(m.attrs.href);
        if (href) out = `<a href="${escapeHtml(href)}">${out}</a>`;
        break;
      }
    }
  }
  return out;
}

export function renderNodes(nodes: readonly DocNode[] | undefined, doodle = ''): string {
  if (!nodes) return '';
  return nodes.map((n) => renderNode(n, doodle)).join('');
}

function renderNode(n: DocNode, doodle: string): string {
  switch (n.type) {
    case 'text':
      return renderMarks(n.text, n.marks);
    case 'hardBreak':
      return '<br>';
    case 'paragraph':
      return `<p>${renderNodes(n.content)}</p>`;
    case 'heading': {
      const inner = renderNodes(n.content);
      if (n.attrs.level === 1) return `<h1 class="pk-h1"><span class="t">${inner}</span>${doodle}</h1>`;
      return `<h${n.attrs.level}>${inner}</h${n.attrs.level}>`;
    }
    case 'bulletList':
      return `<ul>${renderNodes(n.content)}</ul>`;
    case 'orderedList': {
      const start = n.attrs?.start && n.attrs.start !== 1 ? ` start="${n.attrs.start}"` : '';
      return `<ol${start}>${renderNodes(n.content)}</ol>`;
    }
    case 'listItem':
      return `<li>${renderNodes(n.content)}</li>`;
    case 'callout':
      return `<div class="pk-call">${renderNodes(n.content)}</div>`;
    case 'definition':
      return `<div class="pk-def" data-term="${escapeHtml(n.attrs.term)}">${renderNodes(n.content)}</div>`;
    case 'horizontalRule':
      return '<hr>';
  }
}

/** Extra CSS for paged media: full-bleed paper on every page. */
const PRINT_CSS = `
@page{margin:0}
html,body{margin:0;padding:0;background:var(--paper)}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pk{min-height:100vh;box-sizing:border-box;padding-top:calc(var(--gap)*2);padding-bottom:calc(var(--gap)*2)}
.pk-title-meta{font-size:.78em;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
`;

export function renderExportHtml(input: Omit<ExportInput, 'paper'>): string {
  const { doc, pack, faces, title } = input;
  const attrs = Object.entries(packAttrs(pack))
    .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
    .join(' ');
  const firstH1 = doc.content.findIndex((n) => n.type === 'heading' && n.attrs.level === 1);
  const body = doc.content
    .map((n, i) => renderNode(n, i === firstH1 ? doodleSvg(pack) : ''))
    .join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${fontFaceCss(faces)}
${packCss(pack)}
html,body{--paper:${pack.paper.color}}
${PRINT_CSS}</style></head>
<body><div class="pk" ${attrs}>${cornerSvg(pack)}${body}</div></body></html>`;
}

/** Re-exported for tests and the editor theme. */
export type { DocNode, NoteDoc };
