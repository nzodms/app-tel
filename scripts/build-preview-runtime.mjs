// Builds layer A of the preview: the runtime shell (React via preact/compat + the
// @phonelab/app SDK + the postMessage bridge).
//
// The output is emitted as a TypeScript module rather than a public asset, because
// the preview frame runs sandboxed on an *opaque* origin: it cannot fetch a script
// from our origin, and we do not want it to be able to. Inlining the runtime into
// the host document keeps the frame's CSP at `script-src 'unsafe-inline' blob:` and
// `connect-src 'none'` — it needs no network access at all.
//
// Building ahead of time also means the per-request compile only handles the user's
// own files, and the deployed server never needs node_modules to build a preview.

import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outFile = path.join(root, 'src', 'generated', 'preview-runtime.ts');

await mkdir(path.dirname(outFile), { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'src', 'preview', 'runtime', 'index.ts')],
  write: false,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
  metafile: true,
});

if (result.errors.length > 0) process.exit(1);

const source = result.outputFiles?.[0]?.text ?? '';
if (source === '') {
  console.error('[phonelab] preview runtime build produced no output');
  process.exit(1);
}

const header = `/* eslint-disable */
// GENERATED FILE — do not edit.
// Source: src/preview/runtime/**  •  Regenerate with: npm run gen
//
// The preview runtime shell, inlined into the sandboxed host document. It is a
// string rather than a served asset because the preview frame has an opaque origin
// and must not need network access.

export const PREVIEW_RUNTIME_SOURCE = ${JSON.stringify(source)};
`;

await writeFile(outFile, header, 'utf8');
console.log(
  `[phonelab] preview runtime → src/generated/preview-runtime.ts (${(source.length / 1024).toFixed(1)} kB)`,
);
