import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { FileWriterPort, PrintPort, SharePort } from './ports';

/** All exports live in the app's private cache under exports/. */
const exportDir = () => new Directory(Paths.cache, 'exports');

export const expoPrint: PrintPort = {
  async printToFile(html, width, height) {
    const r = await Print.printToFileAsync({ html, width, height });
    return { uri: r.uri };
  },
  async print(html, width, height) {
    await Print.printAsync({ html, width, height });
  },
};

export const expoFiles: FileWriterPort = {
  async writeBytes(fileName, bytes) {
    if (!/^[a-z0-9-]+\.(pdf|docx)$/.test(fileName)) throw new Error('unsafe_file_name');
    const dir = exportDir();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, fileName);
    if (file.exists) file.delete();
    await file.write(bytes);
    return { uri: file.uri, size: file.size ?? bytes.length };
  },
  sizeOf(uri) {
    try {
      const f = new File(uri);
      return f.exists ? (f.size ?? null) : null;
    } catch {
      return null;
    }
  },
};

export const expoShare: SharePort = {
  async share(uri, mimeType, uti) {
    if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
    await Sharing.shareAsync(uri, { mimeType, UTI: uti, dialogTitle: 'Share export' });
  },
};

/** Deletes old exports so shared files do not pile up in the cache. */
export function clearExports(): void {
  const dir = exportDir();
  if (dir.exists) dir.delete();
}
