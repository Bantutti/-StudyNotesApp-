import type { NoteDoc } from '@/core';
import type { FontFaceData, StylePack } from '@/modules/stylepacks';

export type PaperSize = 'A4' | 'Letter';

/** Page sizes in CSS points (1/72 in), as expo-print expects. */
export const PAPER_POINTS: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 595, height: 842 },
  Letter: { width: 612, height: 792 },
};

export interface ExportInput {
  doc: NoteDoc;
  pack: StylePack;
  faces: readonly FontFaceData[];
  title: string;
  paper: PaperSize;
}

export type ExportFormat = 'pdf' | 'docx' | 'print';

export interface ExportOutput {
  format: ExportFormat;
  /** Local file URI in the app sandbox (absent for print). */
  uri?: string;
  bytes?: number;
  ms: number;
}

/** Swappable exporter adapter (expo-print, docx, a future server renderer...). */
export interface Exporter {
  readonly format: ExportFormat;
  run(input: ExportInput): Promise<ExportOutput>;
}
