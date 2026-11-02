/**
 * Compile files from `lib/` and import them as real ES modules, so a check
 * exercises the shipped source rather than a copy of it.
 *
 * Shared by the `verify:*` scripts because two things here are easy to get
 * wrong once each:
 *
 * 1. ⚠️ **The output has to live inside the package.** `lib/invoice-pdf.ts`
 *    imports `jspdf`; from a directory under /tmp, Node cannot walk up to this
 *    package's node_modules and the import dies with ERR_MODULE_NOT_FOUND -
 *    which in `verify-invoice-pdf` killed the one step that actually renders.
 * 2. ⚠️ **Relative specifiers need an extension.** Next.js bundles
 *    `./pdf-font`, so the source rightly carries none, and tsc does not rewrite
 *    specifiers under `--moduleResolution bundler`. Plain Node ESM then cannot
 *    resolve them. Adding the extension here is what the bundler would do; the
 *    alternative is extensions in the source that exist only to satisfy these
 *    scripts.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {string[]} files  paths relative to the package root, e.g. 'lib/x.ts'
 * @param {string} dirName  scratch directory name, gitignored
 * @returns {{ dir: string, load: (name: string) => Promise<any>, cleanup: () => void }}
 */
export function compileLib(files, dirName = '.verify-tmp') {
  const dir = join(process.cwd(), dirName);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Stops Node reparsing the emitted files and warning about it, so that any
  // warning a check does print is a real one.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');

  execFileSync(
    'npx',
    ['tsc', ...files, '--outDir', dir, '--module', 'esnext', '--target', 'es2022',
     '--moduleResolution', 'bundler', '--skipLibCheck'],
    { stdio: 'inherit' }
  );

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const path = join(dir, file);
    const src = readFileSync(path, 'utf8');
    // Only relative specifiers, and only ones with no extension already.
    const fixed = src.replace(
      /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*?)\2/g,
      (whole, head, q, spec) => (/\.[a-z]+$/i.test(spec) ? whole : `${head}${q}${spec}.js${q}`)
    );
    if (fixed !== src) writeFileSync(path, fixed);
  }

  return {
    dir,
    load: name => import(pathToFileURL(join(dir, name)).href),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
