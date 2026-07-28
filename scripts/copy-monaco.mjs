// Copies Monaco's AMD bundle out of node_modules into public/monaco.
//
// @monaco-editor/react loads Monaco from a CDN by default. PhoneLab serves it
// from its own origin instead: no third-party requests, and the strict CSP does
// not need a CDN allowance.

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const target = path.join(root, 'public', 'monaco', 'vs');

if (!existsSync(source)) {
  console.error('[phonelab] monaco-editor is not installed — run npm install first.');
  process.exit(1);
}

// Skip the copy when it is already in place and non-empty (keeps dev restarts fast).
if (existsSync(path.join(target, 'loader.js'))) {
  const info = await stat(path.join(target, 'loader.js'));
  if (info.size > 0) {
    console.log('[phonelab] monaco assets already present');
    process.exit(0);
  }
}

await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
console.log('[phonelab] monaco → public/monaco/vs');
