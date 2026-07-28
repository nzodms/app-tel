import { badRequest } from '../core/errors';
import { LIMITS } from '../core/limits';

/** Project paths are POSIX, relative, and free of traversal. */
export function normalizeProjectPath(input: string): string {
  const raw = input.trim().replace(/\\/g, '/');
  if (raw === '') throw badRequest('A file path is required.');
  if (raw.length > LIMITS.maxPathLength) {
    throw badRequest(`Paths must be ${LIMITS.maxPathLength} characters or fewer.`);
  }

  const parts: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      throw badRequest(`"${input}" is not allowed: paths cannot climb above the project root.`);
    }
    if (segment.includes('\0')) throw badRequest('Paths cannot contain null bytes.');
    parts.push(segment);
  }

  if (parts.length === 0) throw badRequest(`"${input}" is not a valid file path.`);
  const normalized = parts.join('/');
  if (!/^[A-Za-z0-9._\-/@[\]()+ ]+$/.test(normalized)) {
    throw badRequest(
      `"${input}" contains characters that are not allowed in a project path.`,
    );
  }
  return normalized;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  svg: 'xml',
  txt: 'plaintext',
};

export function languageForPath(path: string): string {
  const index = path.lastIndexOf('.');
  if (index === -1) return 'plaintext';
  return LANGUAGE_BY_EXTENSION[path.slice(index + 1).toLowerCase()] ?? 'plaintext';
}

export function fileName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

export function directoryOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}
