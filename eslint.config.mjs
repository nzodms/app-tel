// eslint-config-next 16 ships native flat configs, so no FlatCompat shim is needed.
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescriptConfig from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      '.phonelab-data/**',
      'next-env.d.ts',
      // Template sources are *project* code compiled for previews, not app code:
      // they import `@phonelab/app`, which only resolves inside the preview runtime.
      'templates/**',
      'src/generated/**',
    ],
  },
  ...coreWebVitals,
  ...typescriptConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
