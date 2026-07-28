import { build, type Loader, type Message, type Plugin } from 'esbuild';
import { contentHash } from '../core/crypto';
import type { Diagnostic } from '../db/schema';

/**
 * Layer B of the preview: compiles a project's working tree into a single script.
 *
 * Important security property: esbuild **parses and transforms** the user's code,
 * it never executes it. Nothing from a project runs in the PhoneLab process — the
 * output string is handed to a sandboxed iframe, which is the only place user code
 * ever runs. See docs/ARCHITECTURE.md ("Two-layer preview").
 *
 * The runtime shell (React/preact + `@phonelab/app`) is *external* here: it is
 * already in the browser as `/preview/runtime.js`, and the banner below wires
 * `require()` to its module registry.
 */

export interface VirtualFile {
  path: string;
  content: string;
}

export interface BundleResult {
  ok: boolean;
  code: string;
  /** Stable hash of the output; the studio reloads iframes only when it changes. */
  hash: string;
  diagnostics: Diagnostic[];
  bytes: number;
  durationMs: number;
}

/** Specifiers a browser preview may import from outside its own files. */
const RUNTIME_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'preact',
  'preact/hooks',
  'preact/compat',
  '@phonelab/app',
]);

const NAMESPACE = 'phonelab-vfs';

const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json', '.css'];
const INDEX_EXTENSIONS = ['/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

const LOADERS: Record<string, Loader> = {
  tsx: 'tsx',
  ts: 'ts',
  jsx: 'jsx',
  js: 'jsx',
  mjs: 'jsx',
  json: 'json',
  css: 'text',
};

const BANNER =
  'globalThis.__PHONELAB_APP__=(function(){"use strict";' +
  'var module={exports:{}},exports=module.exports;' +
  'var require=globalThis.__PHONELAB_REQUIRE__;';

const FOOTER = 'return module.exports;})();';

export async function bundleProject(
  files: readonly VirtualFile[],
  entry: string,
): Promise<BundleResult> {
  const startedAt = Date.now();
  const table = new Map<string, string>();
  for (const file of files) table.set(normalise(file.path), file.content);

  const entryPath = resolveWithin(table, normalise(entry));
  if (!entryPath) {
    return {
      ok: false,
      code: '',
      hash: '',
      bytes: 0,
      durationMs: Date.now() - startedAt,
      diagnostics: [
        {
          severity: 'error',
          message: `Entry file "${entry}" does not exist in this project.`,
          file: entry,
          line: null,
          column: null,
          source: 'esbuild',
        },
      ],
    };
  }

  const plugin: Plugin = {
    name: 'phonelab-vfs',
    setup(pluginBuild) {
      // Everything that is not a project file is provided by the runtime shell.
      pluginBuild.onResolve({ filter: /.*/ }, (args) => {
        if (RUNTIME_MODULES.has(args.path)) return { path: args.path, external: true };

        // Bare specifier that is not part of the runtime: fail with a clear message
        // instead of silently producing a broken bundle.
        const isRelative = args.path.startsWith('./') || args.path.startsWith('../');
        const isAbsoluteProject = args.path.startsWith('/');
        if (!isRelative && !isAbsoluteProject && args.kind !== 'entry-point') {
          return {
            errors: [
              {
                text:
                  `Cannot import "${args.path}": browser previews have no npm install step. ` +
                  'Available: react, react-dom, @phonelab/app, and files in this project.',
              },
            ],
          };
        }

        const base = args.importer ? dirname(args.importer) : '';
        const joined = isAbsoluteProject
          ? normalise(args.path)
          : normalise(base ? `${base}/${args.path}` : args.path);
        const resolved = resolveWithin(table, joined);
        if (!resolved) {
          return {
            errors: [{ text: `File not found: ${args.path}` }],
          };
        }
        return { path: resolved, namespace: NAMESPACE };
      });

      pluginBuild.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
        const contents = table.get(args.path);
        if (contents === undefined) {
          return { errors: [{ text: `File not found: ${args.path}` }] };
        }
        return { contents, loader: loaderFor(args.path), resolveDir: dirname(args.path) };
      });
    },
  };

  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'browser',
      target: ['es2022'],
      jsx: 'automatic',
      jsxImportSource: 'react',
      // Emits jsxDEV(..., { fileName, lineNumber, columnNumber }), which the runtime
      // turns into `data-pl-src` on every DOM node — that is what makes
      // click-in-the-phone -> jump-to-code work without touching user code.
      jsxDev: true,
      minify: false,
      sourcemap: false,
      legalComments: 'none',
      logLevel: 'silent',
      banner: { js: BANNER },
      footer: { js: FOOTER },
      define: { 'process.env.NODE_ENV': '"development"' },
      plugins: [plugin],
      // Keep esbuild from touching the real filesystem for module resolution.
      absWorkingDir: process.cwd(),
      metafile: false,
    });

    const code = stripNamespace(result.outputFiles?.[0]?.text ?? '');
    return {
      ok: true,
      code,
      hash: contentHash(code),
      bytes: Buffer.byteLength(code, 'utf8'),
      durationMs: Date.now() - startedAt,
      diagnostics: result.warnings.map((warning) => toDiagnostic(warning, 'warning')),
    };
  } catch (error) {
    const messages = (error as { errors?: Message[]; warnings?: Message[] }).errors;
    const diagnostics: Diagnostic[] = Array.isArray(messages)
      ? messages.map((message) => toDiagnostic(message, 'error'))
      : [
          {
            severity: 'error',
            message: error instanceof Error ? error.message : String(error),
            file: null,
            line: null,
            column: null,
            source: 'esbuild',
          },
        ];
    return {
      ok: false,
      code: '',
      hash: '',
      bytes: 0,
      durationMs: Date.now() - startedAt,
      diagnostics,
    };
  }
}

function toDiagnostic(message: Message, severity: 'error' | 'warning'): Diagnostic {
  return {
    severity,
    message: message.text,
    file: message.location ? stripNamespace(message.location.file) : null,
    line: message.location?.line ?? null,
    column: message.location?.column ?? null,
    source: 'esbuild',
  };
}

/**
 * esbuild labels virtual modules `<namespace>:<path>`. That prefix leaks into the
 * `fileName` of every jsxDEV call and into diagnostics, so strip it: the studio,
 * the inspector and the comment anchors all speak plain project paths.
 */
function stripNamespace(input: string): string {
  return input.split(`${NAMESPACE}:`).join('');
}

function loaderFor(path: string): Loader {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return LOADERS[ext] ?? 'text';
}

/** Collapse `.`/`..`, strip leading slashes. Project paths are always POSIX. */
export function normalise(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** Tries the candidate plus the usual extension/index permutations. */
function resolveWithin(table: Map<string, string>, candidate: string): string | null {
  for (const extension of EXTENSIONS) {
    const attempt = `${candidate}${extension}`;
    if (table.has(attempt)) return attempt;
  }
  for (const extension of INDEX_EXTENSIONS) {
    const attempt = `${candidate}${extension}`;
    if (table.has(attempt)) return attempt;
  }
  return null;
}
