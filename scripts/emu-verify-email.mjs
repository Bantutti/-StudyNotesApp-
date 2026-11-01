#!/usr/bin/env node
/**
 * Emulator only: "clicks" the verification link the Auth emulator would
 * have emailed to an address (the emulator sends no real email).
 *   npm run emu:verify -- student@example.com
 * Refuses anything but a local emulator of a demo-* project.
 */
const email = process.argv[2];
const host = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const project = process.env.EMU_PROJECT ?? 'demo-studynotes';
if (!email || !project.startsWith('demo-')) {
  console.error('usage: npm run emu:verify -- <email>   (demo-* projects only)');
  process.exit(2);
}
const r = await fetch(`http://${host}/emulator/v1/projects/${project}/oobCodes`);
const { oobCodes = [] } = await r.json();
const links = oobCodes.filter((c) => c.email === email.trim().toLowerCase() && c.requestType === 'VERIFY_EMAIL');
for (const l of links) await fetch(l.oobLink);
console.log(links.length ? `Verified (${links.length} link${links.length > 1 ? 's' : ''} opened). In the app, tap "I opened the link".` : 'No verification email found for that address. Tap "Send the email again" in the app first.');
