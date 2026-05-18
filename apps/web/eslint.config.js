import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

const bannedImports = {
  paths: [
    { name: 'antd', message: 'Banned. Use components/ui/ primitives.' },
    { name: 'shadcn', message: 'Banned. Use hand-rolled primitives.' },
    { name: 'redux', message: 'Banned. Use TanStack Query plus Context.' },
    { name: '@reduxjs/toolkit', message: 'Banned.' },
    { name: 'zustand', message: 'Banned.' },
    { name: 'jotai', message: 'Banned.' },
    { name: 'recoil', message: 'Banned.' },
    { name: 'react-hook-form', message: 'Banned. Use useState plus Zod safeParse.' },
    { name: 'formik', message: 'Banned.' },
    { name: 'dayjs', message: 'Banned. Use native Intl.' },
    { name: 'date-fns', message: 'Banned.' },
    { name: 'moment', message: 'Banned.' },
    { name: 'lodash', message: 'Banned. Use native ES2022.' },
    { name: 'axios', message: 'Banned. Use lib/apiClient.ts.' },
    { name: 'uuid', message: 'Banned. Use crypto.randomUUID().' },
    { name: 'next', message: 'Banned. SPA only.' },
    { name: 'gatsby', message: 'Banned. SPA only.' },
  ],
  patterns: [
    { group: ['@ant-design/*'], message: 'Banned.' },
    { group: ['@radix-ui/*'], message: 'Banned.' },
    { group: ['@remix-run/*'], message: 'Banned. SPA only.' },
  ],
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src/lib/database.types.ts'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: { react: { version: '18.3' } },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-restricted-imports': ['error', bannedImports],
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{cjs,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
