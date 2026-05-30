module.exports = {
  root: true,

  env: {
    browser: true,
    es2022: true,
  },

  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },

  plugins: [
    '@typescript-eslint',
    'react',
    'react-hooks',
    'react-refresh',
    'prettier',
  ],

  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',       // React 17+ — no need to import React in scope
    'plugin:react-hooks/recommended',
    'prettier',                        // disables ESLint rules that conflict with Prettier
  ],

  settings: {
    react: { version: 'detect' },
  },

  rules: {
    // ── Prettier ─────────────────────────────────────────────────────────
    'prettier/prettier': 'warn',

    // ── TypeScript ────────────────────────────────────────────────────────
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],

    // ── React ─────────────────────────────────────────────────────────────
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    'react/prop-types': 'off',           // TypeScript handles this
    'react/display-name': 'off',

    // ── General quality ───────────────────────────────────────────────────
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'prefer-const': 'error',
  },

  ignorePatterns: ['dist/', 'node_modules/', '*.config.ts', '*.config.js'],
}
