/**
 * InkFilesPort on expo-file-system (SDK 58 object API), rooted in the app's
 * private document directory (Paths.document: app-private, excluded from
 * other apps; Android backups are off since P1).
 *
 * writeAtomic(): write "<name>.tmp" in the same folder, then move it over the
 * target with overwrite. A crash leaves either the old file or a complete
 * .tmp; read() promotes a leftover .tmp when the target is missing.
 *
 * Paths are app-made (ink ids validated by the service), never user input;
 * safeSegments() re-checks them anyway (defence in depth).
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { InkFilesPort } from './ports';

const SEGMENT = /^[A-Za-z0-9_-]{1,64}(\.[a-z]{1,5})?$/;

function safeSegments(relPath: string): string[] {
  const parts = relPath.split('/');
  if (parts.length === 0 || parts.some((p) => !SEGMENT.test(p))) throw new Error('ink_bad_path');
  return parts;
}

function fileAt(relPath: string): { dir: Directory; file: File; tmp: File } {
  const parts = safeSegments(relPath);
  const name = parts[parts.length - 1] as string;
  const dir = new Directory(Paths.document, ...parts.slice(0, -1));
  return { dir, file: new File(dir, name), tmp: new File(dir, `${name.replace(/\.[a-z]+$/, '')}.tmp`) };
}

export const expoInkFiles: InkFilesPort = {
  async read(relPath) {
    const { file, tmp } = fileAt(relPath);
    if (!file.exists && tmp.exists) await tmp.move(file, { overwrite: true });
    return file.exists ? file.text() : null;
  },
  async writeAtomic(relPath, text) {
    const { dir, file, tmp } = fileAt(relPath);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    await tmp.write(text);
    await tmp.move(file, { overwrite: true });
  },
  async remove(relPath) {
    const { file, tmp } = fileAt(relPath);
    if (file.exists) file.delete();
    if (tmp.exists) tmp.delete();
  },
  async list(relDir) {
    const dir = new Directory(Paths.document, ...safeSegments(relDir));
    if (!dir.exists) return [];
    return dir.list().filter((e) => e instanceof File).map((f) => f.name);
  },
};
