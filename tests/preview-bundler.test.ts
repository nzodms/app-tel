import { describe, expect, it } from 'vitest';
import { bundleProject, normalise } from '@/server/preview/bundler';

const APP = `
import React from 'react';
import { useDevice } from '@phonelab/app';
import { Badge } from './ui/Badge';

export default function App() {
  const device = useDevice();
  return (
    <div className="screen">
      <h1>Hello {device.role}</h1>
      <Badge label="ok" />
    </div>
  );
}
`;

const BADGE = `
export function Badge({ label }: { label: string }) {
  return <span className="badge">{label}</span>;
}
`;

describe('preview bundler', () => {
  it('compiles a multi-file TSX project into one script', async () => {
    const result = await bundleProject(
      [
        { path: 'src/App.tsx', content: APP },
        { path: 'src/ui/Badge.tsx', content: BADGE },
      ],
      'src/App.tsx',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.code).toContain('globalThis.__PHONELAB_APP__');
    expect(result.code).toContain('globalThis.__PHONELAB_REQUIRE__');
    // Runtime modules stay external, resolved by the shell's registry.
    expect(result.code).toContain('require("@phonelab/app")');
    expect(result.code).toContain('require("react/jsx-dev-runtime")');
    // The project's own file was inlined, not required.
    expect(result.code).not.toContain('require("./ui/Badge")');
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('stamps JSX with the project-relative source path', async () => {
    const result = await bundleProject(
      [
        { path: 'src/App.tsx', content: APP },
        { path: 'src/ui/Badge.tsx', content: BADGE },
      ],
      'src/App.tsx',
    );

    // This is the contract the runtime relies on to produce `data-pl-src`,
    // which in turn powers click-to-code and comment anchoring.
    expect(result.code).toContain('fileName: "src/App.tsx"');
    expect(result.code).toContain('fileName: "src/ui/Badge.tsx"');
    expect(result.code).toMatch(/lineNumber: \d+/);
  });

  it('reports a readable diagnostic for a syntax error', async () => {
    const result = await bundleProject(
      [{ path: 'src/App.tsx', content: 'export default function App() { return <div>' }],
      'src/App.tsx',
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.diagnostics[0]?.file).toBe('src/App.tsx');
    expect(result.diagnostics[0]?.line).toBeTypeOf('number');
  });

  it('refuses unknown bare imports with actionable guidance', async () => {
    const result = await bundleProject(
      // The binding has to be *used*, otherwise TypeScript's import elision drops
      // the import before resolution ever happens.
      [{ path: 'src/App.tsx', content: "import lodash from 'lodash';\nexport default () => lodash.noop;" }],
      'src/App.tsx',
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('no npm install step');
  });

  it('resolves directory and extensionless imports', async () => {
    const result = await bundleProject(
      [
        { path: 'src/App.tsx', content: "import { v } from './data';\nexport default () => v;" },
        { path: 'src/data/index.ts', content: 'export const v = 42;' },
      ],
      'src/App.tsx',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('42');
  });

  it('fails clearly when the entry file is missing', async () => {
    const result = await bundleProject([{ path: 'src/Other.tsx', content: 'export default 1;' }], 'src/App.tsx');
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('does not exist');
  });

  it('normalises project paths', () => {
    expect(normalise('/src/./a/../b.tsx')).toBe('src/b.tsx');
    expect(normalise('src//deep///file.ts')).toBe('src/deep/file.ts');
  });
});
