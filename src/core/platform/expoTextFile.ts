import { Directory, File, Paths } from 'expo-file-system';

import type { TextFilePort } from '../results/store';

/**
 * TextFilePort backed by the app's private document directory.
 * `segments` are fixed app-defined names, never user input.
 */
export function expoTextFile(...segments: string[]): TextFilePort {
  const dirs = segments.slice(0, -1);
  const name = segments[segments.length - 1] ?? 'data.txt';
  const dir = new Directory(Paths.document, ...dirs);
  const file = new File(dir, name);
  return {
    async read() {
      return file.exists ? file.text() : null;
    },
    async write(content: string) {
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      await file.write(content);
    },
  };
}
