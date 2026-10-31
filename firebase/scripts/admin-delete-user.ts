/**
 * admin-delete-user.ts — operator tool for WEB account-deletion requests
 * (Google Play requires a way to request deletion without the app).
 *
 * Rey runs this on his own computer after verifying a request. It deletes the
 * same things as the in-app path (docs/backend/ACCOUNT_DELETION.md §A.4):
 * Storage files, every owned doc in every collection, the profile, the Auth user.
 *
 * SAFETY:
 *   - Dry run by default: prints counts only. Deleting needs --confirm <uid>.
 *   - Credentials: Application Default Credentials only
 *     (`gcloud auth application-default login`). No key files in the repo.
 *   - Emulator guard: with emulator env vars set, only demo-* projects are
 *     allowed; without them, demo-* projects are refused. This prevents a
 *     "test" command from hitting production and vice versa.
 *   - Prints uids and counts only, never note content or emails.
 *
 * USAGE (Node 24 runs .ts directly by stripping types):
 *   node scripts/admin-delete-user.ts --project <id> --email <address>            (dry run)
 *   node scripts/admin-delete-user.ts --project <id> --uid <uid> --confirm <uid>  (delete)
 *   optional: --bucket <name>   (default <project>.firebasestorage.app)
 *
 * Self-contained on purpose (no local imports), so `node` can run it without
 * a build step. ADMIN_COLLECTIONS is checked against COLLECTION_NAMES by tests.
 */
import { pathToFileURL } from 'node:url';
import { initializeApp, applicationDefault, deleteApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/** Must equal COLLECTION_NAMES in src/schemas/collections.ts (asserted in tests). */
export const ADMIN_COLLECTIONS = ['reviewLogs', 'cards', 'recordings', 'notes', 'folders', 'subjects', 'assets', 'stylePacks', 'templates'] as const;

export interface AdminArgs {
  project: string;
  uid?: string;
  email?: string;
  confirm?: string;
  bucket?: string;
}

/** Minimal flag parser: --key value pairs only; unknown flags are an error. */
export function parseArgs(argv: string[]): AdminArgs {
  const allowed = new Set(['project', 'uid', 'email', 'confirm', 'bucket']);
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? '';
    const value = argv[i + 1];
    const key = flag.replace(/^--/, '');
    if (!flag.startsWith('--') || !allowed.has(key) || value === undefined || value.startsWith('--')) {
      throw new Error(`Bad argument near "${flag}". See the usage notes at the top of this file.`);
    }
    out[key] = value;
  }
  if (!out.project) throw new Error('--project is required');
  if (!out.uid && !out.email) throw new Error('Give --uid or --email');
  return out as unknown as AdminArgs;
}

/** Refuses dangerous project/emulator combinations (see SAFETY above). */
export function checkEnvironment(project: string, env: NodeJS.ProcessEnv): void {
  const usingEmulators = Boolean(env.FIRESTORE_EMULATOR_HOST ?? env.FIREBASE_AUTH_EMULATOR_HOST ?? env.FIREBASE_STORAGE_EMULATOR_HOST);
  const isDemo = project.startsWith('demo-');
  if (usingEmulators && !isDemo) throw new Error('Emulator variables are set but the project is not demo-*. Refusing.');
  if (!usingEmulators && isDemo) throw new Error('demo-* projects only exist on the emulators. Refusing.');
}

export interface AdminReport {
  uid: string;
  dryRun: boolean;
  files: number;
  docs: Record<string, number>;
  profile: boolean;
  authUser: boolean;
}

export async function run(args: AdminArgs, env: NodeJS.ProcessEnv = process.env): Promise<AdminReport> {
  checkEnvironment(args.project, env);
  const usingEmulators = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const bucketName = args.bucket ?? (usingEmulators ? `${args.project}.appspot.com` : `${args.project}.firebasestorage.app`);

  // On the emulators no credential is needed; on a real project use ADC only.
  const app: App = initializeApp(
    usingEmulators ? { projectId: args.project } : { projectId: args.project, credential: applicationDefault() },
    `admin-delete-${Date.now()}`,
  );
  try {
    const auth = getAuth(app);
    const db = getFirestore(app);
    const bucket = getStorage(app).bucket(bucketName);

    // Resolve the uid (email lookups never print the email back).
    const uid = args.uid ?? (await auth.getUserByEmail(args.email ?? '')).uid;
    const dryRun = args.confirm !== uid;
    if (args.confirm !== undefined && dryRun) throw new Error('--confirm must equal the target uid exactly. Nothing was deleted.');

    const report: AdminReport = { uid, dryRun, files: 0, docs: {}, profile: false, authUser: false };

    // 1. Storage: everything under users/{uid}/.
    const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
    report.files = files.length;
    if (!dryRun) await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));

    // 2. Firestore: every owned doc, collection by collection (Admin SDK bypasses rules).
    for (const name of ADMIN_COLLECTIONS) {
      const snap = await db.collection(name).where('owner', '==', uid).get();
      report.docs[name] = snap.size;
      if (!dryRun && !snap.empty) {
        const writer = db.bulkWriter();
        for (const d of snap.docs) void writer.delete(d.ref);
        await writer.close();
      }
    }

    // 3. Profile, then 4. Auth user.
    const profileRef = db.collection('users').doc(uid);
    report.profile = (await profileRef.get()).exists;
    if (!dryRun && report.profile) await profileRef.delete();

    try {
      await auth.getUser(uid);
      report.authUser = true;
    } catch {
      report.authUser = false;
    }
    if (!dryRun && report.authUser) await auth.deleteUser(uid);

    return report;
  } finally {
    await deleteApp(app);
  }
}

/** CLI entry: prints a content-free summary. */
async function main(): Promise<void> {
  try {
    const report = await run(parseArgs(process.argv.slice(2)));
    const total = Object.values(report.docs).reduce((a, b) => a + b, 0);
    console.log(report.dryRun ? 'DRY RUN (nothing deleted). Re-run with --confirm <uid> to delete.' : 'DELETED.');
    console.log(`uid: ${report.uid}`);
    console.log(`storage files: ${report.files}`);
    for (const [name, n] of Object.entries(report.docs)) console.log(`  ${name}: ${n}`);
    console.log(`docs total: ${total}, profile: ${report.profile ? 'yes' : 'no'}, auth user: ${report.authUser ? 'yes' : 'no'}`);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

// Run only when executed directly (tests import this file without running it).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
