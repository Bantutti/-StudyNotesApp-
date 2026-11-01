/**
 * Ports the AI screens need from the platform. Composition passes the Expo
 * adapters; tests pass fakes.
 */

/** expo-clipboard (getStringAsync / setStringAsync). */
export interface ClipboardPort {
  getString(): Promise<string>;
  setString(s: string): Promise<void>;
}

export interface AiScreenPorts {
  /**
   * Opens a FIXED provider page (key page, privacy, terms, limits) outside
   * the app, through P1's link opener (it confirms first and never opens
   * pages inside the app: Apple age-rating rule).
   */
  openLink(url: string): void;
  clipboard?: ClipboardPort;
}
