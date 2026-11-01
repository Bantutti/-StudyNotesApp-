/**
 * Review L4: editor-web (bundled into the WebView) may import app code only
 * from src/core/document, src/modules/editor/protocol and
 * src/modules/stylepacks/web (docs/ARCHITECTURE.md, module rule 6).
 * Runs the real ESLint config on probe files.
 */
import { join } from 'node:path';

import { ESLint } from 'eslint';

const root = join(__dirname, '..', '..');

async function restricted(code: string, file = 'editor-web/src/probe.ts'): Promise<string[]> {
  // Jest can't load the config file through ESLint's dynamic import; pass the same config object.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require('../../eslint.config.js') as ESLint.Options['overrideConfig'];
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config });
  const [r] = await eslint.lintText(code, { filePath: join(root, file) });
  return (r?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe('editor-web import boundary', () => {
  jest.setTimeout(60_000);

  it('allows the three shared, dependency-free places', async () => {
    const ok = [
      "import { BLOCK_ID } from '../../src/core/document/schema';",
      "import { validateNoteDoc } from '../../src/core/document/parse';",
      "import { SAMPLE_NOTE } from '../../src/core/document';",
      "import { encode } from '../../src/modules/editor/protocol';",
      "import { packCss } from '../../src/modules/stylepacks/web';",
      "import { normalizeDoc } from './normalize';",
    ];
    expect(await restricted(`${ok.join('\n')}\nexport const used = [BLOCK_ID, validateNoteDoc, SAMPLE_NOTE, encode, packCss, normalizeDoc];\n`)).toEqual([]);
    // tests import editor-web's own src with "../src/..."
    expect(await restricted("import { runCommand } from '../src/commands';\nexport const u = runCommand;\n", 'editor-web/__tests__/probe.test.ts')).toEqual([]);
  });

  it('rejects anything else from the app (native code must not reach the page bundle)', async () => {
    const bad = [
      "import { openStore } from '../../src/modules/store';",
      "import { t } from '../../src/core/strings';",
      "import { EditorView } from '../../src/modules/editor/EditorView';",
      "import { createPackRegistry } from '../../src/modules/stylepacks';",
      "import { AppError } from '@/core';",
    ];
    const msgs = await restricted(`${bad.join('\n')}\nexport const u = [openStore, t, EditorView, createPackRegistry, AppError];\n`);
    expect(msgs).toHaveLength(bad.length);
  });
});
