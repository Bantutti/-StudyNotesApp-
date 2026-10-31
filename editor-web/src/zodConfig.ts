/**
 * Must be the first import of main.ts. zod's JIT compiles validators with
 * `new Function`; the page CSP forbids that (no 'unsafe-eval'), so we turn
 * the JIT off and zod never attempts dynamic code in the WebView.
 */
import * as z from 'zod';

z.config({ jitless: true });
