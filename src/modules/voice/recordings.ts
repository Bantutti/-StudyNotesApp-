/**
 * Private recording storage: <documents>/recordings/rec-<timestamp>.m4a
 * File names are app-generated. Deletion only works inside this folder.
 */
import { Directory, File, Paths } from 'expo-file-system';

export interface RecordingFile {
  uri: string;
  name: string;
  size: number;
}

const NAME = /^rec-\d{8}T\d{6}\.m4a$/;

const recordingsDir = () => new Directory(Paths.document, 'recordings');

export function recordingName(now: Date = new Date()): string {
  return `rec-${now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')}.m4a`;
}

/** Moves a just-finished recording from the recorder's location into our folder. */
export function keepRecording(sourceUri: string, now: Date = new Date()): RecordingFile {
  const dir = recordingsDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const src = new File(sourceUri);
  const name = recordingName(now);
  const dest = new File(dir, name);
  src.move(dest);
  return { uri: dest.uri, name, size: dest.size ?? 0 };
}

export function listRecordings(): RecordingFile[] {
  const dir = recordingsDir();
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((e): e is File => e instanceof File && NAME.test(e.name))
    .map((f) => ({ uri: f.uri, name: f.name, size: f.size ?? 0 }))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

export function deleteRecording(name: string): void {
  if (!NAME.test(name)) throw new Error('unsafe_name');
  const f = new File(recordingsDir(), name);
  if (f.exists) f.delete();
}

export function fileSizeOf(uri: string): number | null {
  try {
    const f = new File(uri);
    return f.exists ? (f.size ?? null) : null;
  } catch {
    return null;
  }
}
