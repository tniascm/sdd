import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'node_modules/',
      'coverage/',
      'dist/',
      'build/',
      'data/',
      '**/*.min.js',
      'vibe-prototype/',
      '.specify/',
      '.claude/',
    ],
  },
  tseslint.configs.recommended,
  {
    // Verifier decision (2026-11-01): acceptance/contract tests read untyped JSON response bodies,
    // so `any` is allowed in test code only. Production code under src/ keeps the rule.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
