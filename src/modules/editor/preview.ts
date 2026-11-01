/**
 * Read-only page preview HTML: the same renderer as PDF export, scaled down.
 * Used for the "Pick your look" cards and (M8) version previews.
 */
import type { NoteDoc } from '@/core';
import { renderExportHtml } from '@/modules/export';
import type { FontFaceData, StylePack } from '@/modules/stylepacks';

export function previewHtml(doc: NoteDoc, pack: StylePack, faces: readonly FontFaceData[], zoom = 1): string {
  const z = Math.min(1, Math.max(0.3, zoom));
  const html = renderExportHtml({ doc, pack, faces, title: 'Preview' });
  // Static CSS only (the page CSP allows inline styles, no scripts, no network).
  return html.replace('</head>', `<style>html{zoom:${z.toFixed(2)}}.pk{min-height:0}</style></head>`);
}
