// Turns the real files under templates/ into a TypeScript module the server can
// import without touching the filesystem at runtime (which keeps serverless
// deploys simple).
//
// Templates are authored as normal .tsx/.ts/.css files so they are readable,
// lintable-by-eye and diffable — not as escaped string literals.
//
// Run via `npm run gen` (also wired into predev / prebuild / pretest).

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const templatesDir = path.join(root, 'templates');
const outFile = path.join(root, 'src', 'generated', 'templates.ts');

const IGNORED = new Set(['node_modules', '.DS_Store']);

async function collect(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORED.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collect(absolute, relative)));
    } else {
      files.push({ path: relative, content: await readFile(absolute, 'utf8') });
    }
  }
  return files;
}

const dirs = (await readdir(templatesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !IGNORED.has(entry.name))
  .map((entry) => entry.name)
  .sort();

const bundles = {};
for (const name of dirs) {
  bundles[name] = await collect(path.join(templatesDir, name));
}

const header = `/* eslint-disable */
// GENERATED FILE — do not edit.
// Source: templates/**  •  Regenerate with: npm run gen
//
// Template sources are real files in templates/; this module inlines them so the
// server can create projects without filesystem access.

export interface TemplateFileSource {
  path: string;
  content: string;
}

export const TEMPLATE_SOURCES: Record<string, TemplateFileSource[]> = `;

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${header}${JSON.stringify(bundles, null, 2)};\n`, 'utf8');

const total = Object.values(bundles).reduce((sum, files) => sum + files.length, 0);
console.log(
  `[phonelab] templates → src/generated/templates.ts (${dirs.length} bundles, ${total} files)`,
);
