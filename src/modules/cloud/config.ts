/**
 * Firebase configuration from public Expo variables (EXPO_PUBLIC_*; they
 * ship inside the app and are NOT secret). Validated with zod.
 *
 * Decision (Nov 1, 2026): P2b runs against the local emulators only, with
 * project id demo-studynotes. A real project can be dropped in later by
 * changing these variables; nothing else changes.
 *
 * Safety rules (stricter option, rule 1):
 * - An emulator host is accepted ONLY with a demo-* project id, so a build
 *   can never send a real project's traffic to a LAN machine, and a demo
 *   project can never talk to production.
 * - Without an emulator host, a demo-* project is refused (there is no
 *   real backend behind it).
 * - Anything invalid -> cloud features are off (the app stays local-only).
 */
import * as z from 'zod';

const host = z.string().regex(/^(localhost|(\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*)$/);
const port = z.coerce.number().int().min(1).max(65535);

export const cloudConfigSchema = z
  .object({
    projectId: z.string().regex(/^[a-z0-9-]{4,40}$/),
    apiKey: z.string().min(1).max(100),
    appId: z.string().max(100).optional(),
    authDomain: z.string().max(200).optional(),
    storageBucket: z.string().max(200).optional(),
    emulator: z
      .object({ host, authPort: port, firestorePort: port, storagePort: port })
      .nullable(),
  })
  .refine((c) => (c.emulator !== null) === c.projectId.startsWith('demo-'), {
    message: 'Emulators need a demo-* project id, and demo-* projects need the emulators.',
  });

export type CloudConfig = z.infer<typeof cloudConfigSchema>;

export interface CloudEnv {
  EXPO_PUBLIC_FIREBASE_PROJECT_ID?: string;
  EXPO_PUBLIC_FIREBASE_API_KEY?: string;
  EXPO_PUBLIC_FIREBASE_APP_ID?: string;
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
  EXPO_PUBLIC_FIREBASE_EMULATOR_HOST?: string;
  EXPO_PUBLIC_FIREBASE_AUTH_PORT?: string;
  EXPO_PUBLIC_FIREBASE_FIRESTORE_PORT?: string;
  EXPO_PUBLIC_FIREBASE_STORAGE_PORT?: string;
}

/** Reads the config; returns null (cloud off) when it's missing or invalid. Never throws. */
export function readCloudConfig(env: CloudEnv): CloudConfig | null {
  const projectId = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (!projectId) return null;
  const emuHost = env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST?.trim();
  const r = cloudConfigSchema.safeParse({
    projectId,
    // The emulators accept any key; a demo project never has a real one.
    apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim() || (projectId.startsWith('demo-') ? 'demo-api-key' : ''),
    appId: env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim() || undefined,
    authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || undefined,
    storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || (projectId.startsWith('demo-') ? `${projectId}.appspot.com` : undefined),
    emulator: emuHost
      ? {
          host: emuHost,
          authPort: env.EXPO_PUBLIC_FIREBASE_AUTH_PORT ?? 9099,
          firestorePort: env.EXPO_PUBLIC_FIREBASE_FIRESTORE_PORT ?? 8080,
          storagePort: env.EXPO_PUBLIC_FIREBASE_STORAGE_PORT ?? 9199,
        }
      : null,
  });
  return r.success ? r.data : null;
}

/**
 * The env object for this build. Expo inlines `process.env.EXPO_PUBLIC_*`
 * at bundle time only for these exact property reads, so they are listed
 * one by one (no dynamic access).
 */
export function buildEnv(): CloudEnv {
  return {
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
    EXPO_PUBLIC_FIREBASE_AUTH_PORT: process.env.EXPO_PUBLIC_FIREBASE_AUTH_PORT,
    EXPO_PUBLIC_FIREBASE_FIRESTORE_PORT: process.env.EXPO_PUBLIC_FIREBASE_FIRESTORE_PORT,
    EXPO_PUBLIC_FIREBASE_STORAGE_PORT: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_PORT,
  };
}
