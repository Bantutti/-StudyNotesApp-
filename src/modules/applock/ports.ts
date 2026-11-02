/** Device authentication and screen privacy (expo-local-authentication, expo-screen-capture). */
export interface DeviceAuthPort {
  /** true when the phone has a screen lock (PIN, pattern, password or biometrics). */
  canLock(): Promise<boolean>;
  /** Shows the system prompt; true when the person unlocked. */
  authenticate(prompt: string): Promise<boolean>;
}

export interface ScreenPrivacyPort {
  /** Android: FLAG_SECURE (no screenshots, blank in Recent apps). iOS: blur in the app switcher. */
  protect(on: boolean): Promise<void>;
}
