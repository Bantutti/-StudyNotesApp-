/** Platform ports the exporters depend on (Expo adapters in ./expoAdapters). */
export interface PrintPort {
  printToFile(html: string, width: number, height: number): Promise<{ uri: string }>;
  print(html: string, width: number, height: number): Promise<void>;
}

export interface FileWriterPort {
  /** Writes bytes to the app's private export folder; returns the file URI. */
  writeBytes(fileName: string, bytes: Uint8Array): Promise<{ uri: string; size: number }>;
  sizeOf(uri: string): number | null;
}

export interface SharePort {
  share(uri: string, mimeType: string, uti: string): Promise<void>;
}
