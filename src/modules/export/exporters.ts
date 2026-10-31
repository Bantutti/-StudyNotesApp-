import { renderExportHtml } from './html';
import { buildDocx } from './docx';
import type { FileWriterPort, PrintPort } from './ports';
import { PAPER_POINTS, type Exporter } from './types';

/** Safe, app-generated file name (no user text reaches the file system). */
export function exportFileName(ext: 'pdf' | 'docx', now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  return `note-${stamp}.${ext}`;
}

export function createPdfExporter(print: PrintPort, files: Pick<FileWriterPort, 'sizeOf'>, clock = Date.now): Exporter {
  return {
    format: 'pdf',
    async run(input) {
      const t0 = clock();
      const page = PAPER_POINTS[input.paper];
      const { uri } = await print.printToFile(renderExportHtml(input), page.width, page.height);
      return { format: 'pdf', uri, bytes: files.sizeOf(uri) ?? undefined, ms: clock() - t0 };
    },
  };
}

export function createPrintExporter(print: PrintPort, clock = Date.now): Exporter {
  return {
    format: 'print',
    async run(input) {
      const t0 = clock();
      const page = PAPER_POINTS[input.paper];
      await print.print(renderExportHtml(input), page.width, page.height);
      return { format: 'print', ms: clock() - t0 };
    },
  };
}

export function createDocxExporter(files: FileWriterPort, clock = Date.now): Exporter {
  return {
    format: 'docx',
    async run(input) {
      const t0 = clock();
      const bytes = await buildDocx(input);
      const { uri, size } = await files.writeBytes(exportFileName('docx'), bytes);
      return { format: 'docx', uri, bytes: size, ms: clock() - t0 };
    },
  };
}

export const MIME = {
  pdf: { mime: 'application/pdf', uti: 'com.adobe.pdf' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    uti: 'org.openxmlformats.wordprocessingml.document',
  },
} as const;
